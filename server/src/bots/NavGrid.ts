// A walking map for server-side bots, built from the level's boxes.
//
// This is not physics: the server still has no collision engine. It's a 2D
// grid (one cell per 0.5 m) storing the height of the floor at each spot, the
// way a top-down map shows terrain. A bot can step between neighbouring cells
// if the floor rises by at most CLIMB (a hop onto a crate or low wall) and
// can drop down any reasonable height. Tall walls and pillars are simply too
// high to step onto, so paths go around them. Ramps have floors that rise a
// little per cell, so bots walk up them like anyone else.

import { segmentHitsBox } from "../../../shared/src/levels/geometry.ts";
import type { Box, Level } from "../../../shared/src/levels/types.ts";

const CELL = 0.5; // meters
const CLIMB = 1.0; // the most a bot will hop up between cells (jump height ~1.2)
const DROP = 3.0; // the most a bot will drop down between cells

type Vec2 = [number, number]; // x, z

// Shortcuts besides walking (bots use them; monsters and bosses don't): up
// and down a ladder, launched by a jump pad onto the ledge it serves, or
// through a teleporter. A waypoint reached by one carries its kind (and the
// floor height there).
export type LinkKind = "ladder" | "pad" | "teleport";
export type Waypoint = Vec2 & { link?: LinkKind; y?: number };
type Link = { to: number; kind: LinkKind };

// Rotate a vector by euler angles the way three.js does (order XYZ:
// matrix = Rx * Ry * Rz, so Rz applies first).
function rotate(v: [number, number, number], rot: [number, number, number]): [number, number, number] {
  let [x, y, z] = v;
  const [rx, ry, rz] = rot;
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  return [x, y, z];
}

// Height of a box's top surface at (x, z), or null if (x, z) isn't over it.
function topAt(box: Box, x: number, z: number): number | null {
  const [w, h, d] = box.size;
  const [cx, cy, cz] = box.pos;
  if (!box.rot) {
    // Thinner than a cell (a fence, a parapet): count it as a cell thick, so
    // no row of cell centers can slip past it.
    const hw = Math.max(w / 2, CELL * 0.51);
    const hd = Math.max(d / 2, CELL * 0.51);
    if (Math.abs(x - cx) > hw || Math.abs(z - cz) > hd) return null;
    return cy + h / 2;
  }
  // Rotated box (a ramp): intersect a vertical line with the top face's plane.
  const n = rotate([0, 1, 0], box.rot);
  if (n[1] < 0.3) return null; // too steep to stand on
  const c = rotate([0, h / 2, 0], box.rot);
  const p = [cx + c[0], cy + c[1], cz + c[2]];
  const y = p[1] - (n[0] * (x - p[0]) + n[2] * (z - p[2])) / n[1];
  // Is that point within the face? Undo the rotation to check in box space.
  const inv: [number, number, number] = [-box.rot[0], -box.rot[1], -box.rot[2]];
  // Inverse of XYZ order is ZYX with negated angles: apply Rx^-1, Ry^-1, Rz^-1.
  let [lx, ly, lz] = [x - cx, y - cy, z - cz];
  [ly, lz] = [ly * Math.cos(inv[0]) - lz * Math.sin(inv[0]), ly * Math.sin(inv[0]) + lz * Math.cos(inv[0])];
  [lx, lz] = [lx * Math.cos(inv[1]) + lz * Math.sin(inv[1]), -lx * Math.sin(inv[1]) + lz * Math.cos(inv[1])];
  [lx, ly] = [lx * Math.cos(inv[2]) - ly * Math.sin(inv[2]), lx * Math.sin(inv[2]) + ly * Math.cos(inv[2])];
  if (Math.abs(lx) > w / 2 + 1e-6 || Math.abs(lz) > d / 2 + 1e-6) return null;
  return y;
}

export class NavGrid {
  private minX: number;
  private minZ: number;
  private cols: number;
  private rows: number;
  private floor: Float32Array; // NaN = nothing to stand on
  private walkable: Uint8Array; // reachable on foot from the level's spawn
  private walkableCells: number[] = [];
  // Temporary obstacles (a wizard's wall or pillar): cells they cover are
  // closed until they're gone.
  private closed: Uint8Array;
  private obstacles = new Map<number, number[]>();
  private links = new Map<number, Link[]>();

  constructor(level: Level) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const b of level.boxes) {
      const r = Math.hypot(b.size[0], b.size[2]) / 2;
      minX = Math.min(minX, b.pos[0] - r);
      maxX = Math.max(maxX, b.pos[0] + r);
      minZ = Math.min(minZ, b.pos[2] - r);
      maxZ = Math.max(maxZ, b.pos[2] + r);
    }
    this.minX = minX;
    this.minZ = minZ;
    this.cols = Math.ceil((maxX - minX) / CELL);
    this.rows = Math.ceil((maxZ - minZ) / CELL);
    this.floor = new Float32Array(this.cols * this.rows).fill(NaN);
    this.walkable = new Uint8Array(this.cols * this.rows);
    this.closed = new Uint8Array(this.cols * this.rows);

    // Floor = the highest surface over each cell's center. Box by box, only
    // over the cells a box could cover (its footprint, generously), which is
    // much faster than testing every box at every cell.
    for (const b of level.boxes) {
      if (b.overhead) continue; // bridges and arches: bots walk under them
      const reach = b.rot ? Math.hypot(b.size[0], b.size[1], b.size[2]) / 2 : 0;
      const hx = b.rot ? reach : b.size[0] / 2;
      const hz = b.rot ? reach : b.size[2] / 2;
      const c0 = Math.max(0, Math.floor((b.pos[0] - hx - this.minX) / CELL));
      const c1 = Math.min(this.cols - 1, Math.floor((b.pos[0] + hx - this.minX) / CELL));
      const r0 = Math.max(0, Math.floor((b.pos[2] - hz - this.minZ) / CELL));
      const r1 = Math.min(this.rows - 1, Math.floor((b.pos[2] + hz - this.minZ) / CELL));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const i = r * this.cols + c;
          const [x, z] = this.center(i);
          const top = topAt(b, x, z);
          if (top !== null && !(top <= this.floor[i])) this.floor[i] = top;
        }
      }
    }

    // Lava and void pits: nothing to stand on, with a margin.
    for (const pit of level.pits ?? []) {
      const hx = pit.size[0] / 2 + 0.6;
      const hz = pit.size[1] / 2 + 0.6;
      for (let i = 0; i < this.floor.length; i++) {
        const [x, z] = this.center(i);
        // (A bridge over it is still fine to walk on.)
        if (Math.abs(x - pit.pos[0]) < hx && Math.abs(z - pit.pos[2]) < hz && !(this.floor[i] > pit.pos[1] + 0.15)) this.floor[i] = NaN;
      }
    }

    // Keep a body's width from walls: a cell next to a much higher one (a
    // wall face) is off limits.
    const nearWall = new Uint8Array(this.cols * this.rows);
    for (let i = 0; i < this.floor.length; i++) {
      for (const j of this.neighbors(i)) {
        if (this.floor[j] - this.floor[i] > CLIMB) nearWall[i] = 1;
      }
    }

    this.buildLinks(level, nearWall);

    // Walkable = reachable from the spawn (flood fill: on foot, or by a
    // ladder, jump pad or teleporter), so goals are never on top of walls
    // or pillars nobody can get to.
    const start = this.cellAt(level.spawn[0], level.spawn[2]);
    const queue = start >= 0 ? [start] : [];
    if (start >= 0) this.walkable[start] = 1;
    while (queue.length) {
      const i = queue.pop()!;
      for (const j of this.neighbors(i)) {
        if (!this.walkable[j] && !nearWall[j] && this.canStep(i, j)) {
          this.walkable[j] = 1;
          queue.push(j);
        }
      }
      for (const l of this.links.get(i) ?? []) {
        if (!this.walkable[l.to]) {
          this.walkable[l.to] = 1;
          queue.push(l.to);
        }
      }
    }
    for (let i = 0; i < this.walkable.length; i++) if (this.walkable[i]) this.walkableCells.push(i);
  }

  // A standable cell near (x, z) at about height y (within a few cells; not
  // hugging a wall), or -1.
  private standAt(x: number, z: number, y: number, nearWall: Uint8Array): number {
    let best = -1;
    let bestD = Infinity;
    const c0 = Math.floor((x - this.minX) / CELL);
    const r0 = Math.floor((z - this.minZ) / CELL);
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -4; dc <= 4; dc++) {
        const c = c0 + dc;
        const r = r0 + dr;
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
        const i = r * this.cols + c;
        if (nearWall[i] || Number.isNaN(this.floor[i]) || Math.abs(this.floor[i] - y) > 0.7) continue;
        const d = dr * dr + dc * dc;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    return best;
  }

  private addLink(from: number, to: number, kind: LinkKind): void {
    if (from < 0 || to < 0 || from === to) return;
    const list = this.links.get(from) ?? [];
    list.push({ to, kind });
    this.links.set(from, list);
  }

  private buildLinks(level: Level, nearWall: Uint8Array): void {
    // Ladders: both ways, between the foot and the top.
    for (const l of level.ladders ?? []) {
      const fx = -Math.sin(l.yaw); // toward the wall
      const fz = -Math.cos(l.yaw);
      const foot = this.standAt(l.pos[0] - fx * 0.8, l.pos[2] - fz * 0.8, l.pos[1], nearWall);
      const top = this.standAt(l.pos[0] + fx * 0.9, l.pos[2] + fz * 0.9, l.pos[1] + l.height, nearWall);
      this.addLink(foot, top, "ladder");
      this.addLink(top, foot, "ladder");
    }
    // Jump pads: up onto the nearest ledge the launch can reach.
    for (const pad of level.jumpPads ?? []) {
      const from = this.standAt(pad.pos[0], pad.pos[2], pad.pos[1], nearWall);
      if (from < 0) continue;
      const apex = (pad.power * pad.power) / 40; // m: v^2 / 2g with g = 20
      const base = this.floor[from];
      let best = -1;
      let bestD = Infinity;
      const [px, pz] = this.center(from);
      for (let dr = -10; dr <= 10; dr++) {
        for (let dc = -10; dc <= 10; dc++) {
          const i = this.cellAt(px + dc * CELL, pz + dr * CELL);
          if (i < 0 || nearWall[i] || Number.isNaN(this.floor[i])) continue;
          const rise = this.floor[i] - base;
          const d = Math.hypot(dc, dr) * CELL;
          if (rise < CLIMB + 0.2 || rise > apex - 0.3 || d > 5) continue;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
      this.addLink(from, best, "pad");
    }
    // Teleporters: from the pad to where it puts you.
    for (const t of level.teleporters ?? []) {
      const from = this.standAt(t.pos[0], t.pos[2], t.pos[1], nearWall);
      const to = this.standAt(t.to[0], t.to[2], t.to[1] - 1, nearWall);
      this.addLink(from, to, "teleport");
    }
  }

  private center(i: number): Vec2 {
    const r = Math.floor(i / this.cols);
    const c = i % this.cols;
    return [this.minX + (c + 0.5) * CELL, this.minZ + (r + 0.5) * CELL];
  }

  private cellAt(x: number, z: number): number {
    const c = Math.floor((x - this.minX) / CELL);
    const r = Math.floor((z - this.minZ) / CELL);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  private *neighbors(i: number): Generator<number> {
    const r = Math.floor(i / this.cols);
    const c = i % this.cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= 0 && cc >= 0 && rr < this.rows && cc < this.cols) yield rr * this.cols + cc;
      }
    }
  }

  private canStep(from: number, to: number): boolean {
    const a = this.floor[from];
    const b = this.floor[to];
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    return b - a <= CLIMB && a - b <= DROP;
  }

  // Close the cells a box stands on (with a body's width around it).
  addObstacle(id: number, box: Box): void {
    const r = Math.hypot(box.size[0], box.size[2]) / 2 + 1;
    const cells: number[] = [];
    for (let x = box.pos[0] - r; x <= box.pos[0] + r; x += CELL) {
      for (let z = box.pos[2] - r; z <= box.pos[2] + r; z += CELL) {
        const i = this.cellAt(x, z);
        if (i < 0 || cells.includes(i)) continue;
        const [cx, cz] = this.center(i);
        const floor = this.floor[i];
        if (Number.isNaN(floor)) continue;
        // Would a body standing here touch the box?
        if (segmentHitsBox([cx, floor + 0.2, cz], [cx, floor + 1.7, cz], box, 0.4) === null) continue;
        cells.push(i);
        this.closed[i]++;
      }
    }
    this.obstacles.set(id, cells);
  }

  removeObstacle(id: number): void {
    for (const i of this.obstacles.get(id) ?? []) this.closed[i]--;
    this.obstacles.delete(id);
  }

  clearObstacles(): void {
    this.closed.fill(0);
    this.obstacles.clear();
  }

  private open(i: number): boolean {
    return this.walkable[i] === 1 && this.closed[i] === 0;
  }

  get walkableCount(): number {
    return this.walkableCells.length;
  }

  // Floor height at a point (NaN if there's nothing there).
  floorAt(x: number, z: number): number {
    const i = this.cellAt(x, z);
    return i < 0 ? NaN : this.floor[i];
  }

  // Can you stand here and walk from here to the rest of the level?
  isWalkable(x: number, z: number): boolean {
    const i = this.cellAt(x, z);
    return i >= 0 && this.open(i);
  }

  randomSpot(): Vec2 {
    return this.center(this.walkableCells[Math.floor(Math.random() * this.walkableCells.length)]);
  }

  // The nearest walkable cell to (x, z), searching outward a few meters.
  private nearestWalkable(x: number, z: number): number {
    const i = this.cellAt(x, z);
    if (i >= 0 && this.open(i)) return i;
    let best = -1;
    let bestD = Infinity;
    const reach = Math.ceil(4 / CELL);
    const c0 = Math.floor((x - this.minX) / CELL);
    const r0 = Math.floor((z - this.minZ) / CELL);
    for (let r = r0 - reach; r <= r0 + reach; r++) {
      for (let c = c0 - reach; c <= c0 + reach; c++) {
        if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) continue;
        const j = r * this.cols + c;
        if (!this.open(j)) continue;
        const d = (r - r0) ** 2 + (c - c0) ** 2;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
    }
    return best;
  }

  // A* search over the grid. Returns waypoints (cell centers, simplified to
  // straight runs), or null if there's no way there.
  // useLinks: false for monsters and bosses (they walk everywhere).
  findPath(from: Vec2, to: Vec2, useLinks = true): Waypoint[] | null {
    const start = this.nearestWalkable(from[0], from[1]);
    const goal = this.nearestWalkable(to[0], to[1]);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [this.center(goal)];

    const [gx, gz] = this.center(goal);
    const heuristic = (i: number) => {
      const [x, z] = this.center(i);
      return Math.hypot(x - gx, z - gz);
    };
    const cost = new Map<number, number>([[start, 0]]);
    const cameFrom = new Map<number, number>();
    const via = new Map<number, LinkKind>(); // reached by a link (not a step)
    const open = new MinHeap();
    open.push(start, heuristic(start));
    const closed = new Set<number>();

    while (open.size) {
      const i = open.pop();
      if (i === goal) break;
      if (closed.has(i)) continue;
      closed.add(i);
      const [ix, iz] = this.center(i);
      for (const j of this.neighbors(i)) {
        if (!this.open(j) || closed.has(j) || !this.canStep(i, j)) continue;
        const [jx, jz] = this.center(j);
        const g = cost.get(i)! + Math.hypot(jx - ix, jz - iz) + Math.max(0, this.floor[j] - this.floor[i]);
        if (g < (cost.get(j) ?? Infinity)) {
          cost.set(j, g);
          cameFrom.set(j, i);
          via.delete(j);
          open.push(j, g + heuristic(j));
        }
      }
      if (!useLinks) continue;
      for (const l of this.links.get(i) ?? []) {
        const j = l.to;
        if (!this.open(j) || closed.has(j)) continue;
        const [jx, jz] = this.center(j);
        const g = cost.get(i)! + (l.kind === "teleport" ? 2 : Math.hypot(jx - ix, jz - iz) + 2);
        if (g < (cost.get(j) ?? Infinity)) {
          cost.set(j, g);
          cameFrom.set(j, i);
          via.set(j, l.kind);
          open.push(j, g + heuristic(j));
        }
      }
    }
    if (!cameFrom.has(goal)) return null;

    const cells: number[] = [goal];
    while (cells[cells.length - 1] !== start) cells.push(cameFrom.get(cells[cells.length - 1])!);
    cells.reverse();
    // Simplify each stretch between links; a waypoint reached by a link says so.
    const out: Waypoint[] = [];
    let segStart = 0;
    for (let k = 1; k <= cells.length; k++) {
      if (k < cells.length && !via.has(cells[k])) continue;
      const seg = cells.slice(segStart, k);
      if (segStart > 0) {
        const wp = this.center(seg[0]) as Waypoint;
        wp.link = via.get(seg[0]);
        wp.y = this.floor[seg[0]];
        out.push(wp);
      }
      if (seg.length > 1) out.push(...this.simplify(seg));
      segStart = k;
    }
    return out;
  }

  // Drop waypoints that a straight walk can skip (same floor height along
  // the way), so bots don't zig-zag cell to cell.
  private simplify(cells: number[]): Vec2[] {
    const out: Vec2[] = [];
    let anchor = 0;
    for (let k = 2; k < cells.length; k++) {
      if (!this.straightWalk(cells[anchor], cells[k])) {
        out.push(this.center(cells[k - 1]));
        anchor = k - 1;
      }
    }
    out.push(this.center(cells[cells.length - 1]));
    return out;
  }

  // Can you walk straight from a to b on one floor level (no gaps, pits or walls)?
  clearLine(a: Vec2, b: Vec2): boolean {
    const i = this.cellAt(a[0], a[1]);
    const j = this.cellAt(b[0], b[1]);
    return i >= 0 && j >= 0 && this.open(i) && this.straightWalk(i, j);
  }

  private straightWalk(a: number, b: number): boolean {
    const [ax, az] = this.center(a);
    const [bx, bz] = this.center(b);
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL / 4)); // fine enough not to skip a cell's corner
    const base = this.floor[a];
    for (let s = 1; s <= steps; s++) {
      const i = this.cellAt(ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps);
      if (i < 0 || !this.open(i) || Math.abs(this.floor[i] - base) > 0.3) return false;
    }
    return true;
  }
}

// A small binary heap for A*'s open list (lowest score first).
class MinHeap {
  private items: { id: number; score: number }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(id: number, score: number): void {
    const a = this.items;
    a.push({ id, score });
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent].score <= a[i].score) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }

  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].score < a[m].score) m = l;
        if (r < a.length && a[r].score < a[m].score) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top.id;
  }
}

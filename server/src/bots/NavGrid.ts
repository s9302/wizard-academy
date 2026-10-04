// A walking map for server-side bots, built from the level's boxes.
//
// This is not physics: the server still has no collision engine. It's a 2D
// grid (one cell per 0.5 m) storing the height of the floor at each spot, the
// way a top-down map shows terrain. A bot can step between neighbouring cells
// if the floor rises by at most CLIMB (a hop onto a crate or low wall) and
// can drop down any reasonable height. Tall walls and pillars are simply too
// high to step onto, so paths go around them. Ramps have floors that rise a
// little per cell, so bots walk up them like anyone else.

import type { Box, Level } from "../../../shared/src/levels/types.ts";

const CELL = 0.5; // meters
const CLIMB = 1.0; // the most a bot will hop up between cells (jump height ~1.2)
const DROP = 3.0; // the most a bot will drop down between cells

type Vec2 = [number, number]; // x, z

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
    if (Math.abs(x - cx) > w / 2 || Math.abs(z - cz) > d / 2) return null;
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

    // Floor = the highest surface over each cell's center.
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const [x, z] = this.center(r * this.cols + c);
        let best = NaN;
        for (const b of level.boxes) {
          if (b.overhead) continue; // bridges and arches: bots walk under them
          const top = topAt(b, x, z);
          if (top !== null && !(top <= best)) best = top;
        }
        this.floor[r * this.cols + c] = best;
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

    // Walkable = reachable on foot from the spawn (flood fill), so goals are
    // never on top of walls or pillars.
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
    }
    for (let i = 0; i < this.walkable.length; i++) if (this.walkable[i]) this.walkableCells.push(i);
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

  get walkableCount(): number {
    return this.walkableCells.length;
  }

  // Floor height at a point (NaN if there's nothing there).
  floorAt(x: number, z: number): number {
    const i = this.cellAt(x, z);
    return i < 0 ? NaN : this.floor[i];
  }

  randomSpot(): Vec2 {
    return this.center(this.walkableCells[Math.floor(Math.random() * this.walkableCells.length)]);
  }

  // The nearest walkable cell to (x, z), searching outward a few meters.
  private nearestWalkable(x: number, z: number): number {
    const i = this.cellAt(x, z);
    if (i >= 0 && this.walkable[i]) return i;
    let best = -1;
    let bestD = Infinity;
    const reach = Math.ceil(4 / CELL);
    const c0 = Math.floor((x - this.minX) / CELL);
    const r0 = Math.floor((z - this.minZ) / CELL);
    for (let r = r0 - reach; r <= r0 + reach; r++) {
      for (let c = c0 - reach; c <= c0 + reach; c++) {
        if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) continue;
        const j = r * this.cols + c;
        if (!this.walkable[j]) continue;
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
  findPath(from: Vec2, to: Vec2): Vec2[] | null {
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
        if (!this.walkable[j] || closed.has(j) || !this.canStep(i, j)) continue;
        const [jx, jz] = this.center(j);
        const g = cost.get(i)! + Math.hypot(jx - ix, jz - iz) + Math.max(0, this.floor[j] - this.floor[i]);
        if (g < (cost.get(j) ?? Infinity)) {
          cost.set(j, g);
          cameFrom.set(j, i);
          open.push(j, g + heuristic(j));
        }
      }
    }
    if (!cameFrom.has(goal)) return null;

    const cells: number[] = [goal];
    while (cells[cells.length - 1] !== start) cells.push(cameFrom.get(cells[cells.length - 1])!);
    cells.reverse();
    return this.simplify(cells);
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

  private straightWalk(a: number, b: number): boolean {
    const [ax, az] = this.center(a);
    const [bx, bz] = this.center(b);
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL / 2));
    const base = this.floor[a];
    for (let s = 1; s <= steps; s++) {
      const i = this.cellAt(ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps);
      if (i < 0 || !this.walkable[i] || Math.abs(this.floor[i] - base) > 0.3) return false;
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

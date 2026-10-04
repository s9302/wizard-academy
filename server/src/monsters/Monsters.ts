// Monsters in the battle royale. The room says how many it wants (the Esc
// panel's Monsters + / -); this keeps that many alive, walks them toward
// whoever is closest using the bots' walking map, and makes them attack.
//
// Game-dev note on fairness: a monster's attack has a wind-up. It starts the
// swing (the client shows it rearing back), and only if you're still in
// reach when the wind-up ends does it land. Backing off or jumping away
// in time dodges it.

import { MAX_MONSTERS, MONSTER_ID_BASE, MONSTER_KINDS, type MonsterKind, MONSTERS, type MonsterState } from "../../../shared/src/monsters.ts";
import type { Vec3 } from "../../../shared/src/protocol.ts";
import { followPath, type Vec2 } from "../bots/followPath.ts";
import type { NavGrid } from "../bots/NavGrid.ts";

export type Prey = { id: number; p: Vec3 };

export type MonsterHost = {
  grid(): NavGrid;
  prey(): Prey[]; // who monsters may hunt right now
  everyone(): Vec3[]; // where all players are (monsters don't appear right next to anyone)
  hurt(targetId: number, amount: number, from: Vec3, kind: MonsterKind): void;
};

type Monster = {
  id: number;
  kind: MonsterKind;
  p: Vec3;
  ry: number;
  hp: number;
  path: Vec2[];
  goal: Vec2 | null;
  replanAt: number;
  target: number | null;
  nextAttack: number;
  windupUntil: number; // 0 = not winding up
  windupTarget: number | null;
  // Thrown (a shockwave, a tornado): moving at v until then, helpless.
  push: { v: Vec3; until: number } | null;
};

const SPAWN_CLEARANCE = 12; // meters from any player
const RESPAWN_MS = 6000;
const REPLAN_MS = 700;
const BROADCAST_MS = 100;
const ORDER: MonsterKind[] = ["slime", "wolf", "slime", "golem", "wolf", "slime", "wolf", "golem"];

let nextId = MONSTER_ID_BASE;

export class Monsters {
  private host: MonsterHost;
  private monsters = new Map<number, Monster>();
  private wanted = 0;
  private spawnAt = 0;
  private spawned = 0;
  private lastBroadcast = 0;
  private sentEmpty = true;

  constructor(host: MonsterHost) {
    this.host = host;
  }

  get count(): number {
    return this.wanted;
  }

  // Add or remove one from the wanted number. Returns the new count.
  adjust(action: "add" | "remove"): number {
    this.wanted = Math.max(0, Math.min(MAX_MONSTERS, this.wanted + (action === "add" ? 1 : -1)));
    if (action === "add") this.spawnAt = 0; // right away
    else this.trim();
    return this.wanted;
  }

  // Too many alive (the count went down): the furthest from anyone go first.
  private trim(): void {
    while (this.monsters.size > this.wanted) {
      const last = [...this.monsters.keys()].pop()!;
      this.monsters.delete(last);
    }
  }

  // Nobody left to play with.
  clearAll(): void {
    this.wanted = 0;
    this.monsters.clear();
  }

  // A new arena: everyone starts over somewhere new.
  reset(): void {
    this.monsters.clear();
    this.spawnAt = 0;
  }

  list(): MonsterState[] {
    return [...this.monsters.values()].map((m) => ({
      id: m.id,
      kind: m.kind,
      p: m.p,
      ry: Math.round(m.ry * 100) / 100,
      hp: m.hp,
      attacking: m.windupUntil > 0,
    }));
  }

  // For hit tests: id, center, radius.
  bodies(): { id: number; p: Vec3; radius: number; height: number }[] {
    return [...this.monsters.values()].map((m) => ({ id: m.id, p: m.p, radius: MONSTERS[m.kind].radius, height: MONSTERS[m.kind].height }));
  }

  has(id: number): boolean {
    return this.monsters.has(id);
  }

  kindOf(id: number): MonsterKind | null {
    return this.monsters.get(id)?.kind ?? null;
  }

  // Damage one. Returns its kind if that finished it off, else null.
  damage(id: number, amount: number): MonsterKind | null {
    const m = this.monsters.get(id);
    if (!m) return null;
    m.hp = Math.max(0, m.hp - amount);
    if (m.hp > 0) return null;
    this.monsters.delete(id);
    if (this.spawnAt < Date.now()) this.spawnAt = Date.now() + RESPAWN_MS;
    return m.kind;
  }

  // One tick. Returns a "monsters" update when it's time to send one.
  step(now: number, dt: number): MonsterState[] | null {
    if (this.monsters.size < this.wanted && now >= this.spawnAt) {
      this.spawn();
      this.spawnAt = now + 400; // the rest follow one by one
    }
    const prey = this.host.prey();
    for (const m of this.monsters.values()) {
      if (m.push) this.fly(m, now, dt);
      else this.think(m, prey, now, dt);
    }
    this.separate();
    if (now - this.lastBroadcast < BROADCAST_MS) return null;
    if (!this.monsters.size && this.sentEmpty) return null;
    this.lastBroadcast = now;
    this.sentEmpty = this.monsters.size === 0;
    return this.list();
  }

  // Bring in n monsters of one kind around a spot, on top of the wanted
  // count (the Storm Tyrant's summons). Killed ones don't come back.
  summon(kind: MonsterKind, near: Vec3, n: number): void {
    const grid = this.host.grid();
    const def = MONSTERS[kind];
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 12; tries++) {
        const a = Math.random() * Math.PI * 2;
        const r = 3 + Math.random() * 4;
        const x = near[0] + Math.cos(a) * r;
        const z = near[2] + Math.sin(a) * r;
        if (!grid.isWalkable(x, z)) continue;
        this.add(kind, [x, grid.floorAt(x, z) + def.height, z]);
        break;
      }
    }
  }

  // How many of one kind are alive.
  countOf(kind: MonsterKind): number {
    return [...this.monsters.values()].filter((m) => m.kind === kind).length;
  }

  private add(kind: MonsterKind, p: Vec3): void {
    const m: Monster = {
      id: nextId++,
      kind,
      p,
      ry: Math.random() * Math.PI * 2,
      hp: MONSTERS[kind].hp,
      path: [],
      goal: null,
      replanAt: 0,
      target: null,
      nextAttack: 0,
      windupUntil: 0,
      windupTarget: null,
      push: null,
    };
    this.monsters.set(m.id, m);
  }

  // Throw a monster: velocity v (m/s, y up) for `seconds`. It can't act
  // meanwhile, and walls and edges stop it sideways.
  shove(id: number, v: Vec3, seconds: number): void {
    const m = this.monsters.get(id);
    if (!m) return;
    m.push = { v: [...v], until: Date.now() + seconds * 1000 };
    m.windupUntil = 0;
    m.windupTarget = null;
    m.path = [];
  }

  private spawn(): void {
    const grid = this.host.grid();
    if (!grid.walkableCount) return;
    const people = this.host.everyone();
    let spot: Vec2 = grid.randomSpot();
    for (let i = 0; i < 25; i++) {
      const s = grid.randomSpot();
      if (people.every((p) => Math.hypot(p[0] - s[0], p[2] - s[1]) > SPAWN_CLEARANCE)) {
        spot = s;
        break;
      }
    }
    const kind = ORDER[this.spawned++ % ORDER.length] ?? MONSTER_KINDS[0];
    const def = MONSTERS[kind];
    const floor = grid.floorAt(spot[0], spot[1]);
    this.add(kind, [spot[0], (Number.isNaN(floor) ? 0 : floor) + def.height, spot[1]]);
  }

  private think(m: Monster, prey: Prey[], now: number, dt: number): void {
    const def = MONSTERS[m.kind];
    // Finishing an attack.
    if (m.windupUntil) {
      if (now < m.windupUntil) return; // rooted while it swings
      m.windupUntil = 0;
      const t = prey.find((p) => p.id === m.windupTarget);
      if (t && this.inReach(m, t.p, 0.5)) this.host.hurt(t.id, def.damage, m.p, m.kind);
      m.windupTarget = null;
      m.nextAttack = now + def.cooldownMs;
      return;
    }
    // Who's closest (and close enough to notice)?
    let best: Prey | null = null;
    let bestD = def.sight;
    for (const p of prey) {
      const d = Math.hypot(p.p[0] - m.p[0], p.p[2] - m.p[2]);
      if (d < bestD && Math.abs(p.p[1] - m.p[1]) < 7) {
        best = p;
        bestD = d;
      }
    }
    m.target = best?.id ?? null;
    if (best) {
      m.ry = Math.atan2(-(best.p[0] - m.p[0]), -(best.p[2] - m.p[2]));
      if (this.inReach(m, best.p, 0) && now >= m.nextAttack) {
        m.windupUntil = now + def.windupMs;
        m.windupTarget = best.id;
        return;
      }
      const goal: Vec2 = [best.p[0], best.p[2]];
      if (now >= m.replanAt || !m.goal || Math.hypot(goal[0] - m.goal[0], goal[1] - m.goal[1]) > 2) this.plan(m, goal, now);
      this.walk(m, def.speed, dt, true);
    } else {
      // Nobody around: amble somewhere.
      if (!m.path.length || now >= m.replanAt) this.plan(m, this.host.grid().randomSpot(), now + 5000);
      this.walk(m, def.speed * 0.45, dt, false);
    }
  }

  // Being thrown: move with the push, fall with gravity, land on the floor.
  private fly(m: Monster, now: number, dt: number): void {
    const push = m.push!;
    const grid = this.host.grid();
    const def = MONSTERS[m.kind];
    const nx = m.p[0] + push.v[0] * dt;
    const nz = m.p[2] + push.v[2] * dt;
    const ok = grid.isWalkable(nx, nz);
    push.v[1] -= 20 * dt;
    const floor = grid.floorAt(ok ? nx : m.p[0], ok ? nz : m.p[2]);
    const ground = (Number.isNaN(floor) ? m.p[1] - def.height : floor) + def.height;
    const y = Math.max(ground, m.p[1] + push.v[1] * dt);
    m.p = ok ? [nx, y, nz] : [m.p[0], y, m.p[2]];
    if (now >= push.until && y <= ground + 0.01) m.push = null;
  }

  private inReach(m: Monster, p: Vec3, slack: number): boolean {
    const def = MONSTERS[m.kind];
    const flat = Math.hypot(p[0] - m.p[0], p[2] - m.p[2]);
    return flat <= def.reach + slack && Math.abs(p[1] - m.p[1]) < def.height + 1.4;
  }

  private plan(m: Monster, goal: Vec2, now: number): void {
    m.goal = goal;
    m.path = this.host.grid().findPath([m.p[0], m.p[2]], goal) ?? [];
    m.replanAt = now + REPLAN_MS * (0.8 + Math.random() * 0.4);
  }

  // Follow the path; the last stretch stops short of whoever it's chasing.
  private walk(m: Monster, speed: number, dt: number, chasing: boolean): void {
    const def = MONSTERS[m.kind];
    const moved = followPath(this.host.grid(), m.p, m.path, speed, dt, chasing ? def.reach * 0.7 : 0, def.height);
    m.p = moved.p;
    if (!chasing && moved.dir) m.ry = Math.atan2(-moved.dir[0], -moved.dir[1]);
  }

  // Monsters push each other apart a little, so a pack doesn't stack up.
  private separate(): void {
    const list = [...this.monsters.values()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const min = MONSTERS[a.kind].radius + MONSTERS[b.kind].radius;
        const dx = b.p[0] - a.p[0];
        const dz = b.p[2] - a.p[2];
        const d = Math.hypot(dx, dz);
        if (d >= min || d < 1e-3) continue;
        const push = (min - d) / 2;
        a.p = [a.p[0] - (dx / d) * push, a.p[1], a.p[2] - (dz / d) * push];
        b.p = [b.p[0] + (dx / d) * push, b.p[1], b.p[2] + (dz / d) * push];
      }
    }
  }
}

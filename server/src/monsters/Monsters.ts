// Monsters in the battle royale. The room says how many it wants (the Esc
// panel's Monsters + / -); this keeps that many alive, walks them toward
// whoever is closest using the bots' walking map, and makes them attack.
//
// Game-dev note on fairness: a monster's attack has a wind-up. It starts the
// swing (the client shows it rearing back), and only if you're still in
// reach when the wind-up ends does it land. Backing off or jumping away
// in time dodges it.

import { MAX_MONSTERS, MONSTER_ID_BASE, MONSTER_KINDS, type MonsterKind, MONSTERS, type MonsterState, rideHeight } from "../../../shared/src/monsters.ts";
import type { Vec3 } from "../../../shared/src/protocol.ts";
import { followPath, type Vec2 } from "../bots/followPath.ts";
import type { NavGrid } from "../bots/NavGrid.ts";

export type Prey = { id: number; p: Vec3 };

export type MonsterHost = {
  grid(): NavGrid;
  prey(): Prey[]; // who monsters may hunt right now
  everyone(): Vec3[]; // where all players are (monsters don't appear right next to anyone)
  // A monster's hit on a player; owner: the Druid whose beast it is (credit).
  hurt(targetId: number, amount: number, from: Vec3, kind: MonsterKind, owner?: number): void;
  // Druid's beasts: is this player on the owner's side (they leave them be)?
  friendly?(owner: number, playerId: number): boolean;
  // Ranged monsters: can it see from a to b, and throw its spell (at `power` times its damage).
  canSee?(a: Vec3, b: Vec3): boolean;
  shoot?(monsterId: number, from: Vec3, to: Vec3, power: number): void;
  // A monster's hit on another monster (beasts and wild ones fight).
  hurtMonster?(targetId: number, amount: number, owner?: number): void;
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
  owner?: number; // a Druid's beast: whose
  until?: number; // ...and when it goes back to the wild
  managed?: boolean; // let in from the Esc panel (counts toward `wanted`, comes back when killed)
  max?: number; // tougher than usual (Horde waves): its full health
  dmgMul?: number; // ...and how much harder it hits
  // Thrown (a shockwave, a tornado): moving at v until then, helpless.
  push: { v: Vec3; until: number } | null;
  // In a pit or a black hole: walks at a crawl until then.
  slowUntil?: number;
};

const SPAWN_CLEARANCE = 12; // meters from any player
const RESPAWN_MS = 6000;
const REPLAN_MS = 700;
const BROADCAST_MS = 100;
const ORDER: MonsterKind[] = ["slime", "skeleton", "imp", "zombie", "wolf", "witch", "golem", "skeleton", "slime", "dragon"];

let nextId = MONSTER_ID_BASE;

export class Monsters {
  private host: MonsterHost;
  private monsters = new Map<number, Monster>();
  // What players let in from the arena's Esc panel, one entry per monster:
  // a kind, or null for "a mix" (the ORDER below). Killed ones come back.
  private wanted: (MonsterKind | null)[] = [];
  private spawnAt = 0;
  private spawned = 0;
  private lastBroadcast = 0;
  private sentEmpty = true;

  constructor(host: MonsterHost) {
    this.host = host;
  }

  get count(): number {
    return this.wanted.length;
  }

  // Let one more in (of a kind, or a mix), or send the last one let in away.
  // Returns the new count.
  adjust(action: "add" | "remove", kind: MonsterKind | "mixed" = "mixed"): number {
    if (action === "add") {
      if (this.wanted.length < MAX_MONSTERS) this.wanted.push(kind === "mixed" ? null : kind);
      this.spawnAt = 0; // right away
    } else if (this.wanted.length) {
      const gone = this.wanted.pop()!;
      // One of that kind leaves (the newest), if there are more than wanted now.
      const managed = [...this.monsters.values()].filter((m) => m.managed);
      if (managed.length > this.wanted.length) {
        const pick = managed.filter((m) => gone === null || m.kind === gone).at(-1) ?? managed.at(-1)!;
        this.monsters.delete(pick.id);
      }
    }
    return this.wanted.length;
  }

  // The next kind to bring in: a chosen kind that's short, else the mix.
  private nextKind(): MonsterKind {
    const alive = new Map<MonsterKind, number>();
    for (const m of this.monsters.values()) if (m.managed) alive.set(m.kind, (alive.get(m.kind) ?? 0) + 1);
    const want = new Map<MonsterKind, number>();
    for (const k of this.wanted) if (k) want.set(k, (want.get(k) ?? 0) + 1);
    for (const [k, n] of want) if ((alive.get(k) ?? 0) < n) return k;
    return ORDER[this.spawned++ % ORDER.length] ?? MONSTER_KINDS[0];
  }

  private get managedCount(): number {
    let n = 0;
    for (const m of this.monsters.values()) if (m.managed) n++;
    return n;
  }

  // Nobody left to play with.
  clearAll(): void {
    this.wanted = [];
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
      owner: m.owner,
      max: m.max,
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
    if (this.managedCount < this.wanted.length && now >= this.spawnAt) {
      this.spawn();
      this.spawnAt = now + 400; // the rest follow one by one
    }
    const prey = this.host.prey();
    for (const [id, m] of this.monsters) if (m.until !== undefined && now >= m.until) this.monsters.delete(id);
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
  summon(kind: MonsterKind, near: Vec3, n: number, tough?: { hp: number; damage: number }): void {
    const grid = this.host.grid();
    const def = MONSTERS[kind];
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 12; tries++) {
        const a = Math.random() * Math.PI * 2;
        const r = 3 + Math.random() * 4;
        const x = near[0] + Math.cos(a) * r;
        const z = near[2] + Math.sin(a) * r;
        if (!grid.isWalkable(x, z)) continue;
        const m = this.monsters.get(this.add(kind, [x, grid.floorAt(x, z) + rideHeight(def), z]))!;
        if (tough) {
          m.hp = m.max = Math.round(def.hp * tough.hp);
          m.dmgMul = tough.damage;
        }
        break;
      }
    }
  }

  // A Druid calls a beast: it fights for them until `until`.
  callBeast(kind: MonsterKind, near: Vec3, owner: number, until: number): void {
    const grid = this.host.grid();
    for (let tries = 0; tries < 16; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.5 + Math.random() * 2.5;
      const x = near[0] + Math.cos(a) * r;
      const z = near[2] + Math.sin(a) * r;
      if (!grid.isWalkable(x, z)) continue;
      const id = this.add(kind, [x, grid.floorAt(x, z) + rideHeight(MONSTERS[kind]), z]);
      const m = this.monsters.get(id)!;
      m.owner = owner;
      m.until = until;
      return;
    }
  }

  ownerOf(id: number): number | undefined {
    return this.monsters.get(id)?.owner;
  }

  // How many beasts a Druid has out.
  beastsOf(owner: number): number {
    return [...this.monsters.values()].filter((m) => m.owner === owner).length;
  }

  // A Druid left: their beasts go with them.
  dismiss(owner: number): void {
    for (const [id, m] of this.monsters) if (m.owner === owner) this.monsters.delete(id);
  }

  // How many wild ones (not a Druid's) are alive.
  get wildCount(): number {
    return [...this.monsters.values()].filter((m) => m.owner === undefined).length;
  }

  // How many wild ones of one kind are alive (a Druid's beasts don't count).
  countOf(kind: MonsterKind): number {
    return [...this.monsters.values()].filter((m) => m.kind === kind && m.owner === undefined).length;
  }

  private add(kind: MonsterKind, p: Vec3): number {
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
    return m.id;
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
    const kind = this.nextKind();
    const def = MONSTERS[kind];
    const floor = grid.floorAt(spot[0], spot[1]);
    const id = this.add(kind, [spot[0], (Number.isNaN(floor) ? 0 : floor) + rideHeight(def), spot[1]]);
    this.monsters.get(id)!.managed = true;
  }

  private think(m: Monster, allPrey: Prey[], now: number, dt: number): void {
    const def = MONSTERS[m.kind];
    // Whom this one hunts: a wild monster, players and beasts; a beast, its
    // owner's enemies and any monster not on its side.
    const prey: Prey[] = [];
    for (const p of allPrey) {
      if (m.owner !== undefined && (p.id === m.owner || this.host.friendly?.(m.owner, p.id))) continue;
      prey.push(p);
    }
    for (const o of this.monsters.values()) {
      if (o === m) continue;
      const hostile = m.owner === undefined ? o.owner !== undefined : o.owner === undefined || (o.owner !== m.owner && !this.host.friendly?.(m.owner, o.owner));
      if (hostile) prey.push({ id: o.id, p: o.p });
    }
    // Finishing an attack.
    if (m.windupUntil) {
      if (now < m.windupUntil) return; // rooted while it swings
      m.windupUntil = 0;
      const t = prey.find((p) => p.id === m.windupTarget);
      if (t && def.ranged) {
        // Throw it where they are now (they had the windup to move).
        if (this.inReach(m, t.p, 2)) this.host.shoot?.(m.id, [m.p[0], m.p[1] + 0.3, m.p[2]], t.p, m.dmgMul ?? 1);
      } else if (t && this.inReach(m, t.p, 0.5)) {
        const damage = Math.round(def.damage * (m.dmgMul ?? 1));
        if (this.monsters.has(t.id)) this.host.hurtMonster?.(t.id, damage, m.owner);
        else this.host.hurt(t.id, damage, m.p, m.kind, m.owner);
      }
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
      const ranged = def.ranged;
      const see = !ranged || (this.host.canSee?.([m.p[0], m.p[1] + 0.3, m.p[2]], best.p) ?? true);
      if (this.inReach(m, best.p, 0) && see && now >= m.nextAttack) {
        m.windupUntil = now + def.windupMs;
        m.windupTarget = best.id;
        return;
      }
      if (ranged && see && bestD <= ranged.range) {
        // In range with a clear shot: keep your distance, else hold still.
        if (bestD < ranged.keep) {
          const away = Math.atan2(m.p[0] - best.p[0], m.p[2] - best.p[2]);
          const goal: Vec2 = [m.p[0] + Math.sin(away) * 4, m.p[2] + Math.cos(away) * 4];
          if (this.host.grid().isWalkable(goal[0], goal[1]) && (now >= m.replanAt || !m.path.length)) this.plan(m, goal, now);
          this.walk(m, def.speed, dt, false);
        }
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

  // Dragged toward a spot (a pit, a black hole) at `speed` m/s for this
  // tick, slowed while it lasts. It keeps fighting; walls and edges stop it.
  drag(id: number, to: Vec3, speed: number, dt: number): void {
    const m = this.monsters.get(id);
    if (!m || m.push) return;
    m.slowUntil = Date.now() + 500;
    const dx = to[0] - m.p[0];
    const dz = to[2] - m.p[2];
    const dist = Math.hypot(dx, dz);
    if (dist < 0.6) return;
    const step = Math.min(speed * dt, dist - 0.5);
    const grid = this.host.grid();
    // Straight in, or sliding along whatever's in the way.
    const tries: [number, number][] = [[(dx / dist) * step, (dz / dist) * step], [Math.sign(dx) * step, 0], [0, Math.sign(dz) * step]];
    const ok = tries.find(([sx, sz]) => grid.isWalkable(m.p[0] + sx, m.p[2] + sz));
    if (!ok) return;
    const nx = m.p[0] + ok[0];
    const nz = m.p[2] + ok[1];
    const floor = grid.floorAt(nx, nz);
    m.p = [nx, Number.isNaN(floor) ? m.p[1] : floor + rideHeight(MONSTERS[m.kind]), nz];
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
    const ground = (Number.isNaN(floor) ? m.p[1] - rideHeight(def) : floor) + rideHeight(def);
    const y = Math.max(ground, m.p[1] + push.v[1] * dt);
    m.p = ok ? [nx, y, nz] : [m.p[0], y, m.p[2]];
    if (now >= push.until && y <= ground + 0.01) m.push = null;
  }

  private inReach(m: Monster, p: Vec3, slack: number): boolean {
    const def = MONSTERS[m.kind];
    const flat = Math.hypot(p[0] - m.p[0], p[2] - m.p[2]);
    return flat <= def.reach + slack && Math.abs(p[1] - m.p[1]) < (def.ranged ? 8 : def.height + 1.4);
  }

  private plan(m: Monster, goal: Vec2, now: number): void {
    m.goal = goal;
    m.path = this.host.grid().findPath([m.p[0], m.p[2]], goal, false) ?? [];
    m.replanAt = now + REPLAN_MS * (0.8 + Math.random() * 0.4);
  }

  // Follow the path; the last stretch stops short of whoever it's chasing.
  private walk(m: Monster, speed: number, dt: number, chasing: boolean): void {
    const def = MONSTERS[m.kind];
    if (m.slowUntil !== undefined && Date.now() < m.slowUntil) speed *= 0.4;
    // (A ranged one comes right in: it stops on its own once it has a clear shot.)
    const stop = chasing ? (def.ranged ? 1.5 : def.reach * 0.7) : 0;
    const moved = followPath(this.host.grid(), m.p, m.path, speed, dt, stop, rideHeight(def));
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

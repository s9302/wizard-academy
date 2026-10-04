// A trial's boss. ParkourRoom owns one per boss level and calls step()
// every tick. The boss wakes when someone with a run in progress walks into
// its arena, picks its attacks on a rhythm (faster below half health), and
// goes back to sleep (healed) if everyone leaves or falls.
//
// Everything a player can be hit by is dodgeable: rocks and orbs fly in
// straight lines, shockwaves can be jumped, and lightning is marked on the
// floor before it lands.

import {
  BOSS_HEARTS,
  type BossKind,
  type BossShot,
  bossShotAt,
  BOSSES,
  PLAYER_BOLT_COOLDOWN_MS,
  PLAYER_BOLT_DAMAGE,
  SHOT_RANGE,
  STRIKE_DELAY_MS,
  STRIKE_RADIUS,
  WAVE_HEIGHT,
  WAVE_RANGE,
  WAVE_SPEED,
  WAVE_WIDTH,
} from "../../../shared/src/bosses.ts";
import { SPELLS } from "../../../shared/src/combat.ts";
import { segmentHitsLevel, segmentHitsPlayer } from "../../../shared/src/levels/geometry.ts";
import { inZone, type Box, type Zone } from "../../../shared/src/levels/types.ts";
import type { ServerMsg, Vec3 } from "../../../shared/src/protocol.ts";

export type BossFighter = { id: number; p: Vec3 };

export type BossHost = {
  fighters(): BossFighter[]; // runners inside the arena
  hurt(id: number, by: string): void; // take a heart
  defeated(ids: number[]): void; // these were there when it fell
  broadcast(msg: ServerMsg): void;
  boxes(): Box[];
};

// Testing only: BOSS_HP_SCALE=0.05 makes bosses quick to beat.
const HP_SCALE = Math.min(1, Math.max(0.01, Number(process.env.BOSS_HP_SCALE || 1)));
const RESPAWN_MS = 12_000;
const STATE_MS = 100;

type Bolt = { id: number; caster: number; o: Vec3; d: Vec3; t: number; p: Vec3 };
type Wave = { o: Vec3; start: number; hit: Set<number> };
type Strike = { p: Vec3; at: number };

let nextShotId = 1;
let nextBoltId = 5_000_000; // apart from the battle royale's spell ids

export class Boss {
  readonly kind: BossKind;
  private host: BossHost;
  private arena: Zone;
  private home: Vec3; // where it stands (its center)
  private p: Vec3;
  private ry = Math.PI; // asleep, it faces the arena's entrance (+z in both trials)
  private hp: number;
  private max: number;
  private state: "sleep" | "fight" | "dead" = "sleep";
  private respawnAt = 0;
  private nextAttack = 0;
  private windupUntil = 0;
  private windupAttack: (() => void) | null = null;
  private shots = new Map<number, BossShot>();
  private bolts = new Map<number, Bolt>();
  private waves: Wave[] = [];
  private strikes: Strike[] = [];
  private nextCast = new Map<number, number>();
  private lastState = 0;
  private orbit = 0;

  constructor(kind: BossKind, arena: Zone, home: Vec3, host: BossHost) {
    this.kind = kind;
    this.arena = arena;
    this.home = home;
    this.p = [...home];
    this.host = host;
    this.max = this.hp = Math.round(BOSSES[kind].hp * HP_SCALE);
  }

  inArena(p: Vec3): boolean {
    return inZone(p, this.arena);
  }

  get alive(): boolean {
    return this.state !== "dead";
  }

  // The current state, for someone who just arrived.
  stateMsg(): ServerMsg {
    return { t: "boss", kind: this.kind, p: this.p, ry: this.ry, hp: this.hp, max: this.max, state: this.state, windup: this.windupUntil > 0 };
  }

  // A wizard in the arena casts at it (left click).
  cast(id: number, from: Vec3, o: Vec3, d: Vec3, seq: number, now: number): void {
    if (this.state !== "fight" || now < (this.nextCast.get(id) ?? 0)) return;
    this.nextCast.set(id, now + PLAYER_BOLT_COOLDOWN_MS * 0.85);
    // Cast from the wizard's eyes (the client's guess is trusted only if close).
    const eye: Vec3 = [from[0], from[1] + 0.7, from[2]];
    const start = Math.hypot(o[0] - eye[0], o[1] - eye[1], o[2] - eye[2]) < 1.5 ? o : eye;
    const bolt: Bolt = { id: nextBoltId++, caster: id, o: start, d, t: 0, p: start };
    this.bolts.set(bolt.id, bolt);
    this.host.broadcast({ t: "spell", id: bolt.id, caster: id, seq, k: 0, spell: "bolt", o: start, d, time: now });
  }

  step(now: number, dt: number): void {
    const fighters = this.host.fighters();
    if (this.state === "dead") {
      if (now >= this.respawnAt && fighters.length === 0) this.reset();
    } else if (this.state === "sleep") {
      if (fighters.length) this.wake(fighters.length, now);
    } else if (!fighters.length) {
      this.reset(); // everyone left or fell: it heals and waits
    } else {
      this.think(fighters, now, dt);
    }
    this.stepBolts(dt, now);
    this.stepShots(fighters, now);
    this.stepWaves(fighters, now);
    this.stepStrikes(fighters, now);
    if (now - this.lastState >= STATE_MS && (this.state === "fight" || now - this.lastState >= 1000)) {
      this.lastState = now;
      this.host.broadcast(this.stateMsg());
    }
  }

  private reset(): void {
    this.state = "sleep";
    this.hp = this.max;
    this.p = [...this.home];
    this.ry = Math.PI;
    this.windupUntil = 0;
    this.windupAttack = null;
    this.shots.clear();
    this.waves = [];
    this.strikes = [];
    this.host.broadcast(this.stateMsg());
  }

  private wake(count: number, now: number): void {
    this.max = this.hp = Math.round(BOSSES[this.kind].hp * HP_SCALE * (1 + 0.6 * (count - 1)));
    this.state = "fight";
    this.nextAttack = now + 1800;
    this.host.broadcast({ t: "announce", text: `${BOSSES[this.kind].name} awakens!` });
  }

  private think(fighters: { id: number; p: Vec3 }[], now: number, dt: number): void {
    const def = BOSSES[this.kind];
    // Face (and, for the golem, lumber toward) the nearest wizard.
    let near = fighters[0];
    for (const f of fighters) if (dist(f.p, this.p) < dist(near.p, this.p)) near = f;
    this.ry = Math.atan2(-(near.p[0] - this.p[0]), -(near.p[2] - this.p[2]));
    if (this.windupUntil) {
      if (now >= this.windupUntil) {
        this.windupUntil = 0;
        this.windupAttack?.();
        this.windupAttack = null;
      }
      return;
    }
    const floor = this.arena.min[1];
    if (this.kind === "golem") {
      const d = dist(near.p, this.p);
      if (d > 4) {
        const k = Math.min(1, (def.speed * dt) / d);
        this.p = this.clamp([this.p[0] + (near.p[0] - this.p[0]) * k, floor + def.height, this.p[2] + (near.p[2] - this.p[2]) * k]);
      }
    } else {
      // The wraith circles the middle of its arena, bobbing.
      this.orbit += dt * 0.35;
      const cx = (this.arena.min[0] + this.arena.max[0]) / 2;
      const cz = (this.arena.min[2] + this.arena.max[2]) / 2;
      const r = Math.min(this.arena.max[0] - this.arena.min[0], this.arena.max[2] - this.arena.min[2]) * 0.3;
      this.p = [cx + Math.cos(this.orbit) * r, floor + def.height + Math.sin(now / 600) * 0.4, cz + Math.sin(this.orbit) * r];
    }
    if (now < this.nextAttack) return;
    const angry = this.hp < this.max / 2;
    this.nextAttack = now + (angry ? 1700 : 2500);
    const roll = Math.random();
    if (this.kind === "golem") {
      if (roll < 0.55) this.throwRocks(fighters, now, angry ? 4 : 3);
      else this.windup(900, () => this.slam(now + 900));
    } else {
      if (roll < 0.4) this.orbs(near, now, angry ? 7 : 5);
      else if (roll < 0.75) this.lightning(fighters, now, angry ? 2 : 1);
      else this.windup(800, () => this.slam(now + 800));
    }
  }

  private clamp(p: Vec3): Vec3 {
    const m = 2;
    return [
      Math.min(this.arena.max[0] - m, Math.max(this.arena.min[0] + m, p[0])),
      p[1],
      Math.min(this.arena.max[2] - m, Math.max(this.arena.min[2] + m, p[2])),
    ];
  }

  private windup(ms: number, then: () => void): void {
    this.windupUntil = Date.now() + ms;
    this.windupAttack = then;
    this.host.broadcast(this.stateMsg());
  }

  // ---- Attacks ----

  private shoot(o: Vec3, target: Vec3, speed: number, radius: number, kind: BossShot["kind"], now: number, spread = 0): void {
    let d = norm([target[0] - o[0], target[1] - o[1], target[2] - o[2]]);
    if (spread) {
      const a = Math.atan2(d[0], d[2]) + spread;
      const flat = Math.hypot(d[0], d[2]);
      d = [Math.sin(a) * flat, d[1], Math.cos(a) * flat];
    }
    const shot: BossShot = { id: nextShotId++, o, d, speed, radius, kind, time: now };
    this.shots.set(shot.id, shot);
    this.host.broadcast({ t: "bossShot", shot });
  }

  private throwRocks(fighters: { p: Vec3 }[], now: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const f = fighters[i % fighters.length];
      const o: Vec3 = [this.p[0], this.p[1] + 1.2, this.p[2]];
      this.shoot(o, [f.p[0], f.p[1], f.p[2]], 13, 0.55, "rock", now, (i - (n - 1) / 2) * 0.12);
    }
  }

  private orbs(target: { p: Vec3 }, now: number, n: number): void {
    for (let i = 0; i < n; i++) this.shoot([...this.p], target.p, 10, 0.45, "orb", now, (i - (n - 1) / 2) * 0.2);
  }

  private slam(now: number): void {
    const o: Vec3 = [this.p[0], this.arena.min[1], this.p[2]];
    this.waves.push({ o, start: now, hit: new Set() });
    this.host.broadcast({ t: "bossWave", o, time: now });
  }

  private lightning(fighters: { p: Vec3 }[], now: number, perFighter: number): void {
    for (const f of fighters) {
      for (let i = 0; i < perFighter; i++) {
        const jitter = i === 0 ? 0 : 3;
        const p: Vec3 = [f.p[0] + (Math.random() - 0.5) * jitter, this.arena.min[1], f.p[2] + (Math.random() - 0.5) * jitter];
        this.strikes.push({ p, at: now + STRIKE_DELAY_MS });
        this.host.broadcast({ t: "bossStrike", p, at: now + STRIKE_DELAY_MS });
      }
    }
  }

  // ---- Flying things ----

  private stepShots(fighters: BossFighter[], now: number): void {
    for (const s of [...this.shots.values()]) {
      const t = (now - s.time) / 1000;
      const prev = bossShotAt(s, Math.max(0, t - 0.06));
      const p = bossShotAt(s, t);
      const wall = segmentHitsLevel(prev, p, this.host.boxes(), 0.05);
      let hit: BossFighter | null = null;
      for (const f of fighters) if (segmentHitsPlayer(prev, p, f.p, s.radius) !== null) hit = f;
      if (hit) this.host.hurt(hit.id, s.kind === "rock" ? "a boulder" : "a storm orb");
      if (hit || wall !== null || t * s.speed > SHOT_RANGE) {
        this.shots.delete(s.id);
        this.host.broadcast({ t: "bossShotEnd", id: s.id, p });
      }
    }
  }

  private stepWaves(fighters: BossFighter[], now: number): void {
    this.waves = this.waves.filter((w) => {
      const r = ((now - w.start) / 1000) * WAVE_SPEED;
      if (r > WAVE_RANGE) return false;
      for (const f of fighters) {
        if (w.hit.has(f.id)) continue;
        const flat = Math.hypot(f.p[0] - w.o[0], f.p[2] - w.o[2]);
        const feet = f.p[1] - 0.9 - w.o[1];
        if (Math.abs(flat - r) < WAVE_WIDTH && feet < WAVE_HEIGHT) {
          w.hit.add(f.id);
          this.host.hurt(f.id, "the shockwave");
        }
      }
      return true;
    });
  }

  private stepStrikes(fighters: BossFighter[], now: number): void {
    this.strikes = this.strikes.filter((s) => {
      if (now < s.at) return true;
      for (const f of fighters) if (Math.hypot(f.p[0] - s.p[0], f.p[2] - s.p[2]) < STRIKE_RADIUS) this.host.hurt(f.id, "lightning");
      return false;
    });
  }

  // Wizards' bolts: walls stop them; the boss's body takes the damage.
  private stepBolts(dt: number, now: number): void {
    const def = SPELLS.bolt;
    const boss = BOSSES[this.kind];
    for (const b of [...this.bolts.values()]) {
      const t = Math.min(b.t + dt, def.range / def.speed);
      const to: Vec3 = [b.o[0] + b.d[0] * def.speed * t, b.o[1] + b.d[1] * def.speed * t, b.o[2] + b.d[2] * def.speed * t];
      const wall = segmentHitsLevel(b.p, to, this.host.boxes(), 0.05);
      const body = this.state === "fight" ? hitSphere(b.p, to, this.p, boss.radius + def.radius) : null;
      if (body !== null && (wall === null || body <= wall)) {
        const at = lerp(b.p, to, body);
        this.bolts.delete(b.id);
        this.host.broadcast({ t: "spellEnd", id: b.id, p: at, hit: -1 });
        this.damage(PLAYER_BOLT_DAMAGE, now);
        continue;
      }
      if (wall !== null || t >= def.range / def.speed - 1e-6) {
        this.bolts.delete(b.id);
        this.host.broadcast({ t: "spellEnd", id: b.id, p: wall !== null ? lerp(b.p, to, wall) : to, hit: null });
        continue;
      }
      b.p = to;
      b.t = t;
    }
  }

  private damage(amount: number, now: number): void {
    if (this.state !== "fight") return;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp > 0) return;
    this.state = "dead";
    this.respawnAt = now + RESPAWN_MS;
    this.shots.clear();
    this.waves = [];
    this.strikes = [];
    this.windupUntil = 0;
    this.host.broadcast(this.stateMsg());
    this.host.broadcast({ t: "announce", text: `${BOSSES[this.kind].name} has fallen!` });
    this.host.defeated(this.host.fighters().map((f) => f.id));
  }
}

export { BOSS_HEARTS };

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Where along a -> b (0..1) the segment first comes within r of c, or null.
function hitSphere(a: Vec3, b: Vec3, c: Vec3, r: number): number | null {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const f: Vec3 = [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
  const A = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const B = 2 * (f[0] * d[0] + f[1] * d[1] + f[2] * d[2]);
  const C = f[0] * f[0] + f[1] * f[1] + f[2] * f[2] - r * r;
  if (C <= 0) return 0;
  if (A < 1e-9) return null;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  return t >= 0 && t <= 1 ? t : null;
}

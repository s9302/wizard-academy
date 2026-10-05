// A boss. ParkourRoom owns one per boss trial (the golem, the wraith) and
// BossRoom owns Trial VII's Storm Tyrant; each calls step() every tick. The
// boss wakes when someone it may fight is in its arena, picks its attacks on
// a rhythm (faster as it's hurt), and goes back to sleep (healed) if
// everyone leaves or falls.
//
// Everything a player can be hit by is dodgeable: rocks and orbs fly in
// straight lines, shockwaves can be jumped, and lightning, meteors and the
// Tyrant's leaps are marked on the floor before they land.
//
// The Tyrant walks after the nearest fighter on the bots' walking map and
// has three phases (TYRANT.phase2 / phase3): it adds lightning, orb rings
// and wolves in phase 2, and meteor rain and more speed in phase 3.

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
  type StrikeKind,
  TYRANT,
  WAVE_HEIGHT,
  WAVE_RANGE,
  WAVE_SPEED,
  WAVE_WIDTH,
} from "../../../shared/src/bosses.ts";
import { SPELLS } from "../../../shared/src/combat.ts";
import { segmentHitsLevel, segmentHitsPlayer } from "../../../shared/src/levels/geometry.ts";
import { inZone, type Box, type Zone } from "../../../shared/src/levels/types.ts";
import type { ServerMsg, Vec3 } from "../../../shared/src/protocol.ts";
import type { MonsterKind } from "../../../shared/src/monsters.ts";
import { followPath, type Vec2 } from "../bots/followPath.ts";
import type { NavGrid } from "../bots/NavGrid.ts";

export type BossFighter = { id: number; p: Vec3 };

export type BossHost = {
  fighters(): BossFighter[]; // who it may fight (runners in the arena, or fighters still in the round)
  // A hit: a trial takes a heart (amount unused); BossRoom deals the damage.
  hurt(id: number, by: string, amount: number): void;
  defeated(ids: number[]): void; // these were there when it fell
  broadcast(msg: ServerMsg): void;
  boxes(): Box[];
  // The Tyrant only: its walking map, and calling in monsters.
  grid?(): NavGrid;
  summon?(kind: MonsterKind, near: Vec3, n: number): void;
  summoned?(): number; // how many of its monsters are still alive
};

// Testing only: BOSS_HP_SCALE=0.05 makes bosses quick to beat.
const HP_SCALE = Math.min(1, Math.max(0.01, Number(process.env.BOSS_HP_SCALE || 1)));
const RESPAWN_MS = 12_000;
const STATE_MS = 100;

type Bolt = { id: number; caster: number; o: Vec3; d: Vec3; t: number; p: Vec3 };
type Wave = { o: Vec3; start: number; hit: Set<number> };
type Strike = { p: Vec3; at: number; r: number; kind: StrikeKind };
// The Tyrant in the air: from -> to between start and end (server times).
type Leap = { from: Vec3; to: Vec3; start: number; end: number };

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
  // The Tyrant.
  private path: Vec2[] = [];
  private replanAt = 0;
  private leap: Leap | null = null;
  private phase = 1;
  private nextSummon = 0;

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

  get fighting(): boolean {
    return this.state === "fight";
  }

  get health(): { hp: number; max: number } {
    return { hp: this.hp, max: this.max };
  }

  // Its body, for the battle royale's hit tests (BossRoom): only while it fights.
  body(id: number): { id: number; p: Vec3; radius: number; height: number } | null {
    if (this.state !== "fight") return null;
    return { id, p: this.p, radius: BOSSES[this.kind].radius, height: BOSSES[this.kind].height };
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

  reset(): void {
    this.state = "sleep";
    this.hp = this.max;
    this.p = [...this.home];
    this.ry = this.kind === "tyrant" ? 0 : Math.PI;
    this.windupUntil = 0;
    this.windupAttack = null;
    this.leap = null;
    this.path = [];
    this.phase = 1;
    this.shots.clear();
    this.waves = [];
    this.strikes = [];
    this.host.broadcast(this.stateMsg());
  }

  private wake(count: number, now: number): void {
    this.max = this.hp = Math.round(BOSSES[this.kind].hp * HP_SCALE * (1 + 0.6 * (count - 1)));
    this.state = "fight";
    this.phase = 1;
    this.nextAttack = now + 1800;
    this.nextSummon = now + 8000;
    this.host.broadcast({ t: "announce", text: `${BOSSES[this.kind].name} awakens!` });
  }

  private think(fighters: { id: number; p: Vec3 }[], now: number, dt: number): void {
    if (this.kind === "tyrant") return this.thinkTyrant(fighters, now, dt);
    if (this.kind === "wyrm") return this.thinkWyrm(fighters, now, dt);
    if (this.kind === "lich") return this.thinkLich(fighters, now);
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

  // ---- The Storm Tyrant ----

  private thinkTyrant(fighters: BossFighter[], now: number, dt: number): void {
    const def = BOSSES.tyrant;
    // Phases: announced once each, and phase 2 starts with a summons.
    const frac = this.hp / this.max;
    const phase = frac < TYRANT.phase3 ? 3 : frac < TYRANT.phase2 ? 2 : 1;
    if (phase > this.phase) {
      this.phase = phase;
      this.host.broadcast({ t: "announce", text: phase === 2 ? "The Tyrant roars, and the storm answers!" : "The Tyrant is enraged!" });
      this.nextAttack = Math.min(this.nextAttack, now + 600);
      if (phase === 2) this.nextSummon = now;
    }

    // In the air: follow the arc; the landing is a marked strike (see leapAt).
    if (this.leap) {
      const k = Math.min(1, (now - this.leap.start) / (this.leap.end - this.leap.start));
      const { from, to } = this.leap;
      this.p = [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k + Math.sin(k * Math.PI) * 9, from[2] + (to[2] - from[2]) * k];
      if (k >= 1) {
        this.leap = null;
        this.slam(now);
        this.nextAttack = now + 900;
      }
      return;
    }

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

    // Walk toward the nearest fighter, stopping at arm's length.
    const grid = this.host.grid?.();
    if (grid && dist(near.p, this.p) > 4) {
      if (now >= this.replanAt || !this.path.length) {
        this.path = grid.findPath([this.p[0], this.p[2]], [near.p[0], near.p[2]], false) ?? [];
        this.replanAt = now + 600;
      }
      const speed = def.speed * (phase === 3 ? 1.3 : 1);
      this.p = followPath(grid, this.p, this.path, speed, dt, 3.5, def.height).p;
    }

    if (now < this.nextAttack) return;
    this.nextAttack = now + [0, 2600, 2100, 1600][phase];
    const far = fighters.reduce((a, b) => (dist(b.p, this.p) > dist(a.p, this.p) ? b : a));
    const close = dist(near.p, this.p) < 7;

    // Summons first when it's time (phase 2+, at most 4 wolves at once).
    if (phase >= 2 && now >= this.nextSummon && (this.host.summoned?.() ?? 0) < 4) {
      this.nextSummon = now + 20_000;
      this.windup(700, () => {
        this.host.summon?.("wolf", this.p, TYRANT.wolves);
        this.host.broadcast({ t: "announce", text: "The Tyrant calls the storm wolves!" });
      });
      return;
    }
    const options: [number, () => void][] = [
      [close ? 4 : 0.5, () => this.windup(900, () => this.slam(now + 900))],
      [3, () => this.throwRocks(fighters, now, phase === 1 ? 3 : 5)],
      [dist(far.p, this.p) > 10 ? 2.5 : 0.5, () => this.windup(500, () => this.leapAt(far.p, now + 500))],
    ];
    if (phase >= 2) {
      options.push([2, () => this.lightning(fighters, now, phase === 3 ? 2 : 1)]);
      options.push([2, () => this.windup(700, () => this.orbRing(now + 700, phase === 3 ? 2 : 1))]);
    }
    if (phase === 3) options.push([2.5, () => this.windup(800, () => this.meteors(fighters, now + 800))]);
    let roll = Math.random() * options.reduce((s, [w]) => s + w, 0);
    for (const [w, attack] of options) {
      roll -= w;
      if (roll <= 0) {
        attack();
        break;
      }
    }
  }

  // The floor under a point (the walking map's), or the arena's floor.
  private groundBelow(p: Vec3): number {
    const floor = this.host.grid?.().floorAt(p[0], p[2]);
    return floor === undefined || Number.isNaN(floor) ? this.arena.min[1] : floor;
  }

  // Phases from health: 1, then 2 below TYRANT.phase2, 3 below phase3
  // (announced once each, with the boss's own lines).
  private phaseCheck(now: number, lines: [string, string]): number {
    const frac = this.hp / this.max;
    const phase = frac < TYRANT.phase3 ? 3 : frac < TYRANT.phase2 ? 2 : 1;
    if (phase > this.phase) {
      this.phase = phase;
      this.host.broadcast({ t: "announce", text: lines[phase - 2] });
      this.nextAttack = Math.min(this.nextAttack, now + 600);
      if (phase === 2) this.nextSummon = now;
    }
    return phase;
  }

  private pick(options: [number, () => void][]): void {
    let roll = Math.random() * options.reduce((sum, [w]) => sum + w, 0);
    for (const [w, attack] of options) {
      roll -= w;
      if (roll <= 0) return attack();
    }
  }

  // ---- The Frost Wyrm (Trial VIII) ----
  // Circles high over the middle of its arena (out of a sword's reach),
  // breathing frost and dropping ice; now and then it swoops down at the
  // furthest fighter (a marked landing), stays down a few seconds (now it
  // can be hit up close), and takes off again.
  private grounded = 0;
  private thinkWyrm(fighters: BossFighter[], now: number, dt: number): void {
    const phase = this.phaseCheck(now, ["The Wyrm shrieks: the air turns to ice!", "The Wyrm is furious!"]);
    let near = fighters[0];
    for (const f of fighters) if (dist(f.p, this.p) < dist(near.p, this.p)) near = f;
    if (this.leap) {
      const k = Math.min(1, (now - this.leap.start) / (this.leap.end - this.leap.start));
      const { from, to } = this.leap;
      this.p = [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k + Math.sin(k * Math.PI) * 3, from[2] + (to[2] - from[2]) * k];
      if (k >= 1) {
        this.leap = null;
        this.slam(now);
        this.grounded = now + 3500;
      }
      return;
    }
    this.ry = Math.atan2(-(near.p[0] - this.p[0]), -(near.p[2] - this.p[2]));
    if (this.windupUntil) {
      if (now >= this.windupUntil) {
        this.windupUntil = 0;
        this.windupAttack?.();
        this.windupAttack = null;
      }
      return;
    }
    // Flying: circle the home point, high up (after a landing, rise back).
    if (now >= this.grounded) {
      this.orbit += dt * (phase === 3 ? 0.5 : 0.35);
      const r = 13;
      const want: Vec3 = [this.home[0] + Math.cos(this.orbit) * r, this.home[1] + 6 + Math.sin(now / 700) * 0.6, this.home[2] + Math.sin(this.orbit) * r];
      const k = Math.min(1, dt * 1.5);
      this.p = [this.p[0] + (want[0] - this.p[0]) * k, this.p[1] + (want[1] - this.p[1]) * k, this.p[2] + (want[2] - this.p[2]) * k];
    }
    if (now < this.nextAttack) return;
    this.nextAttack = now + [0, 2400, 1900, 1500][phase];
    const far = fighters.reduce((a, b) => (dist(b.p, this.p) > dist(a.p, this.p) ? b : a));
    const options: [number, () => void][] = [
      [3, () => this.windup(600, () => this.breath(near.p, now + 600, phase === 1 ? 7 : 11))],
      [2, () => this.iceSpikes(near.p, now)],
      [now >= this.grounded ? 2 : 0, () => this.windup(700, () => this.leapAt(far.p, now + 700))],
    ];
    if (phase >= 2) options.push([1.5, () => this.lightning(fighters, now, phase === 3 ? 2 : 1)]);
    if (phase === 3) options.push([2, () => this.windup(800, () => this.meteors(fighters, now + 800))]);
    this.pick(options);
  }

  // Frost breath: a fan of shards at someone.
  private breath(at: Vec3, now: number, n: number): void {
    for (let i = 0; i < n; i++) this.shoot([this.p[0], this.p[1] - 0.6, this.p[2]], at, 15, 0.4, "frost", now, (i - (n - 1) / 2) * 0.09);
  }

  // Ice spikes: a line of marked circles from under the wyrm toward someone.
  private iceSpikes(at: Vec3, now: number): void {
    const from: Vec3 = [this.p[0], 0, this.p[2]];
    const dx = at[0] - from[0];
    const dz = at[2] - from[2];
    const len = Math.hypot(dx, dz) || 1;
    for (let i = 1; i <= 7; i++) {
      const t = (i / 7) * Math.min(28, len + 6);
      const p: Vec3 = [from[0] + (dx / len) * t, 0, from[2] + (dz / len) * t];
      p[1] = this.groundBelow(p);
      this.strike(p, now + 900 + i * 140, 2.2, "ice");
    }
  }

  // ---- The Lich Sovereign (Trial IX) ----
  // Floats in place, then blinks somewhere else every few seconds; soul
  // bolts, death rings and curses; raises the dead from phase 2; a soul
  // storm when it's nearly beaten.
  private nextBlink = 0;
  private thinkLich(fighters: BossFighter[], now: number): void {
    const phase = this.phaseCheck(now, ["The Lich calls the dead from their graves!", "The Lich unleashes the soul storm!"]);
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
    // Blink to a new spot (a few meters from the fighters, never on them).
    const grid = this.host.grid?.();
    if (grid && now >= this.nextBlink) {
      this.nextBlink = now + (phase === 3 ? 4500 : 7000) + Math.random() * 2000;
      for (let i = 0; i < 12; i++) {
        const [x, z] = grid.randomSpot();
        const d = Math.min(...fighters.map((f) => Math.hypot(f.p[0] - x, f.p[2] - z)));
        if (d < 7 || d > 24) continue;
        this.p = [x, grid.floorAt(x, z) + BOSSES.lich.height, z];
        break;
      }
    }
    this.p = [this.p[0], this.p[1] + Math.sin(now / 500) * 0.01, this.p[2]];
    if (now < this.nextAttack) return;
    this.nextAttack = now + [0, 2300, 1800, 1400][phase];
    if (phase >= 2 && now >= this.nextSummon && (this.host.summoned?.() ?? 0) < 4) {
      this.nextSummon = now + 18_000;
      this.windup(700, () => {
        this.host.summon?.("wolf", this.p, 2);
        this.host.broadcast({ t: "announce", text: "The dead rise to serve the Lich!" });
      });
      return;
    }
    const options: [number, () => void][] = [
      [3, () => this.orbs(near, now, phase === 1 ? 3 : 5)],
      [2, () => this.windup(700, () => this.orbRing(now + 700, phase === 3 ? 2 : 1))],
      [2, () => this.lightning(fighters, now, phase === 1 ? 1 : 2)],
    ];
    if (phase === 3) options.push([2, () => this.windup(800, () => this.meteors(fighters, now + 800))]);
    this.pick(options);
  }

  // Jump to a spot: the landing circle is marked first, then it comes down there.
  private leapAt(target: Vec3, now: number): void {
    const grid = this.host.grid?.();
    // Land 3 m short of them (the circle still covers them), not on top of them.
    const away = Math.hypot(target[0] - this.p[0], target[2] - this.p[2]) || 1;
    const short = Math.min(3, away);
    let to: Vec3 = [target[0] - ((target[0] - this.p[0]) / away) * short, target[1], target[2] - ((target[2] - this.p[2]) / away) * short];
    if (grid && !grid.isWalkable(to[0], to[2])) to = [target[0], target[1], target[2]];
    if (grid) {
      const floor = grid.floorAt(to[0], to[2]);
      // Land on the floor, not on a platform (it walks back down otherwise).
      if (!grid.isWalkable(to[0], to[2]) || Number.isNaN(floor)) return this.slam(now);
      to = [to[0], floor + BOSSES[this.kind].height, to[2]];
    }
    const end = now + TYRANT.leapDelayMs;
    this.leap = { from: [...this.p], to, start: now, end };
    this.path = [];
    this.strike([to[0], to[1] - BOSSES[this.kind].height, to[2]], end, TYRANT.leapRadius, "leap");
  }

  // Storm orbs in every direction (two staggered rings when enraged).
  private orbRing(now: number, rings: number): void {
    for (let r = 0; r < rings; r++) {
      const n = 14;
      for (let i = 0; i < n; i++) {
        const a = ((i + r * 0.5) / n) * Math.PI * 2;
        const o: Vec3 = [this.p[0], this.p[1] - 1.2, this.p[2]];
        const shot: BossShot = { id: nextShotId++, o, d: [Math.sin(a), 0, Math.cos(a)], speed: 8 - r * 2, radius: 0.5, kind: "orb", time: now };
        this.shots.set(shot.id, shot);
        this.host.broadcast({ t: "bossShot", shot });
      }
    }
  }

  // Meteors: one on each fighter, and more scattered around the arena.
  private meteors(fighters: BossFighter[], now: number): void {
    const grid = this.host.grid?.();
    const spots: Vec3[] = fighters.map((f) => [f.p[0], f.p[1] - 0.9, f.p[2]]);
    for (let i = 0; i < 8 && grid; i++) {
      const [x, z] = grid.randomSpot();
      spots.push([x, grid.floorAt(x, z), z]);
    }
    spots.forEach((p, i) => this.strike(p, now + TYRANT.meteorDelayMs + i * 120, TYRANT.meteorRadius, "meteor"));
    this.host.broadcast({ t: "announce", text: "Meteors! Get out of the circles!" });
  }

  private strike(p: Vec3, at: number, r: number, kind: StrikeKind): void {
    this.strikes.push({ p, at, r, kind });
    this.host.broadcast(kind === "lightning" ? { t: "bossStrike", p, at } : { t: "bossStrike", p, at, r, kind });
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
    const big = this.kind === "tyrant" || this.kind === "wyrm" || this.kind === "lich";
    const o: Vec3 = [this.p[0], big ? this.groundBelow(this.p) : this.arena.min[1], this.p[2]];
    this.waves.push({ o, start: now, hit: new Set() });
    this.host.broadcast({ t: "bossWave", o, time: now });
  }

  private lightning(fighters: { p: Vec3 }[], now: number, perFighter: number): void {
    for (const f of fighters) {
      for (let i = 0; i < perFighter; i++) {
        const jitter = i === 0 ? 0 : 3;
        const y = this.kind === "golem" || this.kind === "wraith" ? this.arena.min[1] : f.p[1] - 0.9;
        const p: Vec3 = [f.p[0] + (Math.random() - 0.5) * jitter, y, f.p[2] + (Math.random() - 0.5) * jitter];
        this.strike(p, now + STRIKE_DELAY_MS, STRIKE_RADIUS, "lightning");
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
      if (hit) this.host.hurt(hit.id, { rock: "a boulder", orb: "a storm orb", frost: "the Wyrm's frost breath" }[s.kind], TYRANT.damage[s.kind]);
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
          this.host.hurt(f.id, "the shockwave", TYRANT.damage.slam);
        }
      }
      return true;
    });
  }

  private stepStrikes(fighters: BossFighter[], now: number): void {
    this.strikes = this.strikes.filter((s) => {
      if (now < s.at) return true;
      const by = s.kind === "leap" ? `the ${BOSSES[this.kind].name.replace(/^The /, "")}'s landing` : { lightning: "lightning", meteor: "a meteor", ice: "ice spikes" }[s.kind];
      for (const f of fighters) {
        // A fighter on something high (a platform) is safe from the Tyrant's landing.
        if (s.kind === "leap" && f.p[1] - s.p[1] > 2.5) continue;
        if (Math.hypot(f.p[0] - s.p[0], f.p[2] - s.p[2]) < s.r) this.host.hurt(f.id, by, TYRANT.damage[s.kind]);
      }
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
        this.hit(PLAYER_BOLT_DAMAGE, now);
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

  // Damage it (a trial's bolts, or anything in BossRoom). Returns true if that finished it.
  hit(amount: number, now = Date.now()): boolean {
    if (this.state !== "fight") return false;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp > 0) return false;
    this.state = "dead";
    this.respawnAt = now + RESPAWN_MS;
    this.shots.clear();
    this.waves = [];
    this.strikes = [];
    this.windupUntil = 0;
    this.host.broadcast(this.stateMsg());
    this.leap = null;
    this.host.broadcast({ t: "announce", text: `${BOSSES[this.kind].name} has fallen!` });
    this.host.defeated(this.host.fighters().map((f) => f.id));
    return true;
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

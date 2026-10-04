// The brain of a battle royale bot. Each tick it decides where to walk, which
// hand to hold, and whether to attack. Its attacks go through the same server
// checks as a player's (RoyaleRoom.attack / cast): same cooldowns, same
// charges, same flight. Bots take turns being Knights, Rogues and Wizards,
// and fight like them: Knights charge in with the sword (and raise the
// shield when hurt at range), Rogues keep their distance with the bow (and
// pull daggers up close), Wizards cast (and use the staff up close).
//
// In order of priority:
//  - Outside the safe circle (or the next one, once it's shrinking): head in.
//  - Someone in sight: strafe side to side at a comfortable range and cast
//    at them, aiming a little ahead of where they're running, with some
//    human-like error so a moving target can dodge.
//  - Hurt or out of fireballs, and a useful pickup nearby: go get it.
//  - Otherwise: hunt the nearest wizard.

import { type SpellId, SPELLS } from "../../../shared/src/combat.ts";
import { BOT_CLASSES, type ClassId, type Hand, moveSpeed, WEAPONS, weaponOf } from "../../../shared/src/classes.ts";
import type { PrimarySpell } from "../../../shared/src/unlocks.ts";
import { EYE_HEIGHT, RUN_SPEED, WALK_SPEED } from "../../../shared/src/constants.ts";
import { lineOfSight } from "../../../shared/src/levels/geometry.ts";
import type { Box } from "../../../shared/src/levels/types.ts";
import type { PickupInfo, Vec3 } from "../../../shared/src/protocol.ts";
import type { BotPeer } from "../Connection.ts";
import type { Player } from "../rooms/Room.ts";
import { BotWalker, flatDist, type Vec2 } from "./BotWalker.ts";
import type { NavGrid } from "./NavGrid.ts";

const FIGHT_SPEED = RUN_SPEED * 0.7;
const TRAVEL_SPEED = RUN_SPEED * 0.8;
const WANDER_SPEED = WALK_SPEED * 0.6;
const SIGHT_RANGE = 34;
const SIGHT_CHECK_MS = 250; // line-of-sight checks are the expensive part
const AIM_ERROR = 0.05; // radians, up to about 3 degrees either way
const LEAD = 0.6; // how much of a target's running a bot aims ahead for
const REACTION_MS: [number, number] = [250, 650]; // extra wait after each cooldown
const SPOT_MS: [number, number] = [600, 1100]; // "who's that?": before the first shot at someone new
const FIREBALL_RANGE = 20;
const SLOW_FACTOR = SPELLS.frost.slowFactor!;
const BOT_SPELLS: PrimarySpell[] = ["frost", "spark", "bolt"];


export type RoyaleView = {
  now: number;
  dt: number;
  me: Player;
  fighting: boolean; // in a live round, still in it
  practice: boolean;
  enemies: Player[]; // others who can be hit
  hp: number;
  maxHp: number;
  hand: Hand;
  fireballs: number;
  slowed: boolean; // hit by Frost Shard
  circles: { now: [number, number, number]; next: [number, number, number] } | null;
  pickups: PickupInfo[];
};

export type RoyaleAction = {
  p: Vec3;
  ry: number;
  cast: { spell: SpellId; d: Vec3 } | null; // a spell (Wizard's, or a Fireball)
  attack: Vec3 | null; // use the weapon in hand, in this direction
  hand: Hand | null; // switch to this hand
  ability: { slot: 0 | 1; d: Vec3 } | null; // E or R, aimed this way
};

const eye = (p: Vec3): Vec3 => [p[0], p[1] + EYE_HEIGHT, p[2]];

export class RoyaleBot extends BotWalker {
  private boxes: () => Box[]; // the level, plus any conjured walls

  setLevel(grid: NavGrid): void {
    this.setGrid(grid);
    this.target = null;
  }

  // A wall went up somewhere: plan again.
  replan(): void {
    this.path = [];
    this.replanAt = 0;
  }
  // Each bot has one left-click spell, like a player picks in the Spellbook.
  // Bots in a room take turns: Knight, Rogue, Wizard, Knight... and the
  // Wizards take turns with spells (Frost, Spark, Bolt). Six bots = two of
  // each class.
  cls: ClassId; // can be changed from the Esc panel (RoyaleRoom.setBot)
  readonly primary: PrimarySpell;
  private target: number | null = null; // player id in sight
  private sightCheckAt = 0;
  private nextCastAt = 0;
  private abilityAt = 0;
  private strafeSide = 1;
  private strafeFlipAt = 0;
  // Where each enemy was last tick, to guess where they're heading.
  private seen = new Map<number, { p: Vec3; time: number; v: Vec3 }>();

  constructor(peer: BotPeer, grid: NavGrid, boxes: () => Box[], index: number) {
    super(peer, grid);
    this.boxes = boxes;
    this.cls = BOT_CLASSES[index % BOT_CLASSES.length];
    this.primary = BOT_SPELLS[Math.floor(index / BOT_CLASSES.length) % BOT_SPELLS.length];
  }

  think(view: RoyaleView): RoyaleAction {
    const { me, now } = view;
    this.sync(me);
    this.track(view.enemies, now);

    if (!view.fighting) {
      this.target = null;
      this.wander(now);
      return { p: this.step(me.p, WANDER_SPEED, view.dt), ry: this.ry, cast: null, attack: null, hand: null, ability: null };
    }

    let speed = TRAVEL_SPEED;
    const target = this.pickTarget(view);
    const safe = this.safeGoal(view);

    if (safe) {
      // The storm comes first; still shoot on the way if someone's in sight.
      if (now >= this.replanAt || !this.path.length) this.planTo(safe, now, 1500);
    } else if (target) {
      speed = FIGHT_SPEED;
      this.strafe(me, target, now);
    } else {
      const pickup = this.wantedPickup(view);
      const nearest = view.enemies.reduce<Player | null>((a, b) => (!a || flatDist(me.p, b.p) < flatDist(me.p, a.p) ? b : a), null);
      if (pickup) {
        if (now >= this.replanAt || !this.path.length) this.planTo([pickup.p[0], pickup.p[2]], now, 1500);
      } else if (nearest) {
        if (now >= this.replanAt || !this.path.length) this.planTo([nearest.p[0], nearest.p[2]], now, 1500);
      } else {
        this.wander(now);
      }
    }

    speed *= moveSpeed(this.cls, view.hand) * (view.slowed ? SLOW_FACTOR : 1);
    const p = this.step(me.p, speed, view.dt);
    const action: RoyaleAction = { p, ry: this.ry, cast: null, attack: null, hand: null, ability: null };
    if (target) {
      action.ry = this.ry = Math.atan2(-(target.p[0] - p[0]), -(target.p[2] - p[2])); // face them while strafing
      const wanted = this.wantedHand(view, flatDist(p, target.p));
      if (wanted !== view.hand) action.hand = wanted;
      else this.fight(view, target, p, action);
    }
    return action;
  }

  // Abilities, when hurt: Wizards wall themselves off from someone at
  // range, Rogues shadow-step away from someone close, Knights fortify.
  // (The server checks cooldowns; a bot just tries every few seconds.)
  private useAbility(view: RoyaleView, target: Player, from: Vec3, action: RoyaleAction): boolean {
    if (view.now < this.abilityAt || view.hp > view.maxHp * 0.6) return false;
    const dist = flatDist(from, target.p);
    const [fx, fz] = [(target.p[0] - from[0]) / (dist || 1), (target.p[2] - from[2]) / (dist || 1)];
    if (this.cls === "wizard" && dist > 6) {
      // Aim at the ground about 4 m toward them: the wall goes up there.
      const pitch = Math.atan2(EYE_HEIGHT + 0.9, 4);
      action.ability = { slot: 0, d: [fx * Math.cos(pitch), -Math.sin(pitch), fz * Math.cos(pitch)] };
    } else if (this.cls === "rogue" && dist < 6) {
      action.ability = { slot: 0, d: [-fx, 0, -fz] };
    } else if (this.cls === "knight") {
      action.ability = { slot: 1, d: [fx, 0, fz] };
    } else if (this.cls === "cleric") {
      action.ability = { slot: 0, d: [fx, 0, fz] }; // Healing Light
    } else {
      return false;
    }
    this.abilityAt = view.now + 4000;
    return true;
  }

  // Which hand suits the moment.
  private wantedHand(view: RoyaleView, dist: number): Hand {
    if (this.cls === "knight") return dist > 7 && view.hp < view.maxHp * 0.6 ? "backup" : "main"; // shield up while closing in, when hurt
    if (this.cls === "rogue") return dist < 3.5 ? "backup" : "main"; // daggers
    return dist < 3 ? "backup" : "main"; // the Wizard's staff
  }

  // Attack with what's in hand (or throw a Fireball if it's a good moment).
  private fight(view: RoyaleView, target: Player, from: Vec3, action: RoyaleAction): void {
    if (this.useAbility(view, target, from, action)) return;
    if (view.now < this.nextCastAt) return;
    const dist = flatDist(from, target.p);
    if (view.fireballs > 0 && dist <= FIREBALL_RANGE && dist > 5) {
      action.cast = this.aim(view, target, from, "fireball");
      return;
    }
    const weapon = WEAPONS[weaponOf(this.cls, view.hand)];
    if (weapon.melee) {
      if (dist > weapon.melee.reach + 0.2) return;
      this.nextCastAt = view.now + weapon.melee.cooldownMs + REACTION_MS[0] + Math.random() * (REACTION_MS[1] - REACTION_MS[0]);
      const o = eye(from);
      const d: Vec3 = [target.p[0] - o[0], target.p[1] - o[1], target.p[2] - o[2]];
      const len = Math.hypot(...d) || 1;
      action.attack = [d[0] / len, d[1] / len, d[2] / len];
    } else if (weapon.kind === "projectile") {
      const shot = this.aim(view, target, from, "arrow");
      action.attack = shot?.d ?? null;
    } else {
      action.cast = this.aim(view, target, from, this.primary);
    }
  }

  // Remember positions to estimate each enemy's velocity.
  private track(enemies: Player[], now: number): void {
    for (const e of enemies) {
      const prev = this.seen.get(e.conn.id);
      let v: Vec3 = prev?.v ?? [0, 0, 0];
      if (prev && now > prev.time) {
        const dt = (now - prev.time) / 1000;
        v = [(e.p[0] - prev.p[0]) / dt, 0, (e.p[2] - prev.p[2]) / dt];
        if (Math.hypot(v[0], v[2]) > RUN_SPEED * 1.5) v = [0, 0, 0]; // a teleport, not running
      }
      this.seen.set(e.conn.id, { p: e.p, time: now, v });
    }
  }

  // The closest enemy we can actually see (rechecked a few times a second).
  private pickTarget(view: RoyaleView): Player | null {
    const { me, now } = view;
    const current = view.enemies.find((e) => e.conn.id === this.target) ?? null;
    if (now < this.sightCheckAt) return current;
    this.sightCheckAt = now + SIGHT_CHECK_MS * (0.8 + Math.random() * 0.4);
    const visible = view.enemies
      .filter((e) => flatDist(me.p, e.p) <= SIGHT_RANGE && lineOfSight(eye(me.p), eye(e.p), this.boxes()))
      .sort((a, b) => flatDist(me.p, a.p) - flatDist(me.p, b.p));
    const next = visible[0]?.conn.id ?? null;
    if (next !== null && next !== this.target) {
      // A new target: take a moment to react before the first shot.
      this.nextCastAt = Math.max(this.nextCastAt, now + SPOT_MS[0] + Math.random() * (SPOT_MS[1] - SPOT_MS[0]));
    }
    this.target = next;
    return visible[0] ?? null;
  }

  // Somewhere inside the safe circle, if we're not in it.
  private safeGoal(view: RoyaleView): Vec2 | null {
    const c = view.circles;
    if (!c) return null;
    const [x, , z] = view.me.p;
    const [nx, nz, nr] = c.now;
    const [tx, tz, tr] = c.next;
    const outsideNow = Math.hypot(x - nx, z - nz) > nr - 1;
    const outsideNext = Math.hypot(x - tx, z - tz) > Math.max(tr - 2, 0.5);
    if (!outsideNow && !(outsideNext && nr - tr < 25)) return null;
    // Aim for a point inside the next circle, on our side of its center.
    const toUs = Math.hypot(x - tx, z - tz) || 1;
    const k = Math.max(0, tr * 0.5) / toUs;
    return [tx + (x - tx) * k, tz + (z - tz) * k];
  }

  // Side to side across the line to the target, closing in if far, backing off if close.
  private strafe(me: Player, target: Player, now: number): void {
    if (now >= this.strafeFlipAt) {
      this.strafeSide = -this.strafeSide;
      this.strafeFlipAt = now + 900 + Math.random() * 1400;
      this.path = [];
    }
    if (this.path.length && now < this.replanAt) return;
    const dx = target.p[0] - me.p[0];
    const dz = target.p[2] - me.p[2];
    const d = Math.hypot(dx, dz) || 1;
    const [fx, fz] = [dx / d, dz / d];
    // How close to fight: Knights get in sword reach; Rogues stay far;
    // Spark Volley only reaches 20 m.
    const [far, near] =
      this.cls === "knight" || this.cls === "cleric" ? [1.8, 0] : this.cls === "rogue" ? [28, 14] : this.primary === "spark" ? [13, 6] : [22, 9];
    const forward = d > far ? Math.min(4, d) : d < near ? -3 : 0;
    const side = (this.cls === "knight" || this.cls === "cleric") && d < 4 ? 1.2 : 4; // melee classes circle tight
    const goal: Vec2 = [me.p[0] + fx * forward - fz * side * this.strafeSide, me.p[2] + fz * forward + fx * side * this.strafeSide];
    this.planTo(goal, now, 700);
  }

  private aim(view: RoyaleView, target: Player, from: Vec3, spell: SpellId): RoyaleAction["cast"] {
    const dist = flatDist(from, target.p);
    const def = SPELLS[spell];
    if (dist > def.range * 0.9) return null;
    this.nextCastAt = view.now + def.cooldownMs + REACTION_MS[0] + Math.random() * (REACTION_MS[1] - REACTION_MS[0]);

    // Lead the target: where they'll be when the spell arrives (roughly).
    const v = this.seen.get(target.conn.id)?.v ?? [0, 0, 0];
    const flight = dist / def.speed;
    // Fireballs aim at the feet: a miss still splashes.
    const aimY = spell === "fireball" ? target.p[1] - 0.6 : target.p[1] + 0.2;
    const aimAt: Vec3 = [target.p[0] + v[0] * flight * LEAD, aimY, target.p[2] + v[2] * flight * LEAD];
    const o = eye(from);
    let yaw = Math.atan2(aimAt[0] - o[0], aimAt[2] - o[2]) + (Math.random() * 2 - 1) * AIM_ERROR;
    const x = Math.hypot(aimAt[0] - o[0], aimAt[2] - o[2]);
    const y = aimAt[1] - o[1];
    let pitch = (def.gravity ? ballistic(def.speed, def.gravity, x, y) : Math.atan2(y, x)) + (Math.random() * 2 - 1) * AIM_ERROR * 0.5;
    if (!Number.isFinite(yaw)) yaw = 0;
    if (!Number.isFinite(pitch)) pitch = 0;
    const d: Vec3 = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    return { spell, d };
  }

  // A pickup worth a detour: healing when hurt, a tome when out of fireballs.
  private wantedPickup(view: RoyaleView): PickupInfo | null {
    const useful = view.pickups.filter(
      (p) => (p.kind === "potion" && view.hp < view.maxHp * 0.7) || (p.kind === "tome" && view.fireballs === 0) || p.kind === "ward",
    );
    const near = useful.filter((p) => flatDist(view.me.p, p.p) < 25);
    return near.sort((a, b) => flatDist(view.me.p, a.p) - flatDist(view.me.p, b.p))[0] ?? null;
  }
}

// The launch angle that lands an arcing shot (speed v, gravity g) x meters
// away and y meters up: the flatter of the two solutions. Out of reach: 45
// degrees, the farthest it can go.
function ballistic(v: number, g: number, x: number, y: number): number {
  const v2 = v * v;
  const root = v2 * v2 - g * (g * x * x + 2 * y * v2);
  if (root < 0 || x < 1e-3) return Math.PI / 4;
  return Math.atan((v2 - Math.sqrt(root)) / (g * x));
}

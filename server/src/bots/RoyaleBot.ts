// The brain of a battle royale bot. Each tick it decides where to walk and
// whether to cast. Its spells go through the same server checks as a
// player's (RoyaleRoom.cast): same cooldowns, same charges, same flight.
//
// In order of priority:
//  - Outside the safe circle (or the next one, once it's shrinking): head in.
//  - Someone in sight: strafe side to side at a comfortable range and cast
//    at them, aiming a little ahead of where they're running, with some
//    human-like error so a moving target can dodge.
//  - Hurt or out of fireballs, and a useful pickup nearby: go get it.
//  - Otherwise: hunt the nearest wizard.

import { MAX_HEALTH, type SpellId, SPELLS } from "../../../shared/src/combat.ts";
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

export type RoyaleView = {
  now: number;
  dt: number;
  me: Player;
  fighting: boolean; // in a live round, still in it
  practice: boolean;
  enemies: Player[]; // others who can be hit
  hp: number;
  fireballs: number;
  circles: { now: [number, number, number]; next: [number, number, number] } | null;
  pickups: PickupInfo[];
};

export type RoyaleAction = { p: Vec3; ry: number; cast: { spell: SpellId; d: Vec3 } | null };

const eye = (p: Vec3): Vec3 => [p[0], p[1] + EYE_HEIGHT, p[2]];

export class RoyaleBot extends BotWalker {
  private boxes: Box[];
  private target: number | null = null; // player id in sight
  private sightCheckAt = 0;
  private nextCastAt = 0;
  private strafeSide = 1;
  private strafeFlipAt = 0;
  // Where each enemy was last tick, to guess where they're heading.
  private seen = new Map<number, { p: Vec3; time: number; v: Vec3 }>();

  constructor(peer: BotPeer, grid: NavGrid, boxes: Box[]) {
    super(peer, grid);
    this.boxes = boxes;
  }

  think(view: RoyaleView): RoyaleAction {
    const { me, now } = view;
    this.sync(me);
    this.track(view.enemies, now);

    if (!view.fighting) {
      this.target = null;
      this.wander(now);
      return { p: this.step(me.p, WANDER_SPEED, view.dt), ry: this.ry, cast: null };
    }

    let speed = TRAVEL_SPEED;
    let cast: RoyaleAction["cast"] = null;
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

    const p = this.step(me.p, speed, view.dt);
    if (target) {
      cast = this.aim(view, target, p);
      this.ry = Math.atan2(-(target.p[0] - p[0]), -(target.p[2] - p[2])); // face them while strafing
    }
    return { p, ry: this.ry, cast };
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
      .filter((e) => flatDist(me.p, e.p) <= SIGHT_RANGE && lineOfSight(eye(me.p), eye(e.p), this.boxes))
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
    const forward = d > 22 ? 4 : d < 9 ? -3 : 0;
    const goal: Vec2 = [me.p[0] + fx * forward - fz * 4 * this.strafeSide, me.p[2] + fz * forward + fx * 4 * this.strafeSide];
    this.planTo(goal, now, 700);
  }

  private aim(view: RoyaleView, target: Player, from: Vec3): RoyaleAction["cast"] {
    if (view.now < this.nextCastAt) return null;
    const dist = flatDist(from, target.p);
    const spell: SpellId = view.fireballs > 0 && dist <= FIREBALL_RANGE ? "fireball" : "bolt";
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
    let pitch = Math.atan2(aimAt[1] - o[1], Math.hypot(aimAt[0] - o[0], aimAt[2] - o[2])) + (Math.random() * 2 - 1) * AIM_ERROR * 0.5;
    if (!Number.isFinite(yaw)) yaw = 0;
    if (!Number.isFinite(pitch)) pitch = 0;
    const d: Vec3 = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    return { spell, d };
  }

  // A pickup worth a detour: healing when hurt, a tome when out of fireballs.
  private wantedPickup(view: RoyaleView): PickupInfo | null {
    const useful = view.pickups.filter(
      (p) => (p.kind === "potion" && view.hp < MAX_HEALTH * 0.7) || (p.kind === "tome" && view.fireballs === 0) || p.kind === "ward",
    );
    const near = useful.filter((p) => flatDist(view.me.p, p.p) < 25);
    return near.sort((a, b) => flatDist(view.me.p, a.p) - flatDist(view.me.p, b.p))[0] ?? null;
  }
}

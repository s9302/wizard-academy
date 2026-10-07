// A ditchquid bot: it flies (no walking map needed: the pitch is open air),
// and plays one of a few simple roles each moment.
//
// - Carrying the ball: fly to a spot in front of one of the other team's
//   hoops, then throw at it (aiming a little high for the drop, and not
//   perfectly).
// - A teammate has it: fly ahead of them toward the hoops, jinxing anyone
//   chasing.
// - The other team has it: the keeper (one per team) guards its hoops;
//   everyone else chases the carrier and jinxes them.
// - Nobody has it: the two nearest go for it, the rest spread out.

import { DQ, type Hoop } from "../../../shared/src/ditchquid.ts";
import { BROOM_SPEED, EYE_HEIGHT } from "../../../shared/src/constants.ts";
import type { Vec3 } from "../../../shared/src/protocol.ts";
import type { BotPeer } from "../Connection.ts";

const SPEED = BROOM_SPEED * 0.85;
const ACCEL = 2.5; // how quickly it turns and gets up to speed (per second)
const THROW_FROM = 9; // meters in front of the hoop

export type DqView = {
  now: number;
  dt: number;
  me: { id: number; p: Vec3 };
  team: 0 | 1;
  keeper: boolean; // this bot guards its team's hoops when the other team has the ball
  slowed: boolean;
  playing: boolean;
  ball: { p: Vec3; carrier: number | null; free: boolean };
  players: { id: number; p: Vec3; v: Vec3; team: 0 | 1 }[]; // everyone else
  hoops: Hoop[];
  bounds: { x: number; z: number; top: number };
  canJinx: boolean;
};

export type DqAction = { p: Vec3; ry: number; throwDir?: Vec3; jinx?: { o: Vec3; d: Vec3 } };

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const norm = (v: Vec3): Vec3 => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

export class DitchquidBot {
  readonly peer: BotPeer;
  private vel: Vec3 = [0, 0, 0];
  private goalHoop: Hoop | null = null; // the hoop it's going for with the ball
  private thinkAt = 0; // reacts a few times a second, not every tick
  private aimError: Vec3 = [0, 0, 0];

  constructor(peer: BotPeer) {
    this.peer = peer;
  }

  think(v: DqView): DqAction {
    const { me, ball } = v;
    let target: Vec3 = me.p;
    let throwDir: Vec3 | undefined;
    let jinxAt: { p: Vec3; v: Vec3 } | null = null;
    const theirs = v.hoops.filter((h) => h.team !== v.team);
    const ours = v.hoops.filter((h) => h.team === v.team);
    const enemies = v.players.filter((p) => p.team !== v.team);
    const carrier = v.players.find((p) => p.id === ball.carrier);

    if (!v.playing) {
      target = [me.p[0], Math.max(me.p[1], 3), me.p[2]];
    } else if (ball.carrier === me.id) {
      // Pick a hoop (the one with fewest defenders near it) and go throw.
      if (!this.goalHoop || this.goalHoop.team === v.team) {
        const crowd = (h: Hoop) => enemies.filter((e) => len(sub(e.p, h.pos)) < 10).length + Math.random();
        this.goalHoop = [...theirs].sort((a, b) => crowd(a) - crowd(b))[0];
        this.aimError = [0, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6];
      }
      const h = this.goalHoop;
      const toward = Math.sign(-h.pos[0]); // from the hoop back into the pitch
      target = [h.pos[0] + toward * THROW_FROM, h.pos[1], h.pos[2]];
      if (len(sub(target, me.p)) < 3) {
        // Aim at the ring (plus a miss, sometimes), a little high for the drop.
        const eye: Vec3 = [me.p[0], me.p[1] + EYE_HEIGHT, me.p[2]];
        const aim: Vec3 = [h.pos[0], h.pos[1] + this.aimError[1], h.pos[2] + this.aimError[2]];
        const t = len(sub(aim, eye)) / DQ.ball.speed;
        aim[1] += 0.5 * DQ.ball.gravity * t * t;
        throwDir = norm(sub(aim, eye));
        this.goalHoop = null;
      }
    } else {
      this.goalHoop = null;
      if (carrier && carrier.team === v.team) {
        // Support: fly ahead of the carrier, jinx whoever's closest to them.
        const ahead = Math.sign(theirs[0].pos[0]);
        const side = me.id % 2 ? 6 : -6;
        target = [carrier.p[0] + ahead * 8, carrier.p[1], carrier.p[2] + side];
        const chaser = enemies.sort((a, b) => len(sub(a.p, carrier.p)) - len(sub(b.p, carrier.p)))[0];
        if (chaser && len(sub(chaser.p, carrier.p)) < 15) jinxAt = chaser;
      } else if (carrier) {
        if (v.keeper) {
          // Guard: between the carrier and the nearest of our hoops.
          const h = [...ours].sort((a, b) => len(sub(a.pos, carrier.p)) - len(sub(b.pos, carrier.p)))[0];
          const toward = Math.sign(-h.pos[0]);
          target = [h.pos[0] + toward * 3, h.pos[1], h.pos[2] + (carrier.p[2] - h.pos[2]) * 0.3];
        } else {
          target = carrier.p;
        }
        jinxAt = carrier;
      } else {
        // A loose ball: the two of us nearest go for it.
        const mine = len(sub(ball.p, me.p));
        const nearer = v.players.filter((p) => p.team === v.team && len(sub(ball.p, p.p)) < mine).length;
        if (nearer < 2 && ball.free) target = ball.p;
        else {
          const h = ours[1] ?? ours[0];
          target = v.keeper ? [h.pos[0] + Math.sign(-h.pos[0]) * 4, h.pos[1], h.pos[2]] : [ball.p[0] * 0.5, 8 + (me.id % 3) * 3, ((me.id % 5) - 2) * 6];
        }
        const near = enemies.find((e) => len(sub(e.p, ball.p)) < 6);
        if (near && mine < 25) jinxAt = near;
      }
    }

    // Fly: ease the velocity toward the target, keep inside the pitch.
    const speed = SPEED * (v.slowed ? DQ.jinx.slowFactor : 1);
    const to = sub(target, me.p);
    const dist = len(to);
    const want: Vec3 = dist > 0.5 ? norm(to).map((c) => c * Math.min(speed, dist * 2)) as Vec3 : [0, 0, 0];
    const k = Math.min(1, v.dt * ACCEL);
    this.vel = this.vel.map((c, i) => c + (want[i] - c) * k) as Vec3;
    const b = v.bounds;
    const p: Vec3 = [
      Math.max(-b.x, Math.min(b.x, me.p[0] + this.vel[0] * v.dt)),
      Math.max(1, Math.min(b.top, me.p[1] + this.vel[1] * v.dt)),
      Math.max(-b.z, Math.min(b.z, me.p[2] + this.vel[2] * v.dt)),
    ];
    const ry = Math.hypot(this.vel[0], this.vel[2]) > 0.5 ? Math.atan2(-this.vel[0], -this.vel[2]) : Math.atan2(-to[0], -to[2]);

    // A jinx now and then (every 1.5 to 4 s at most, and only when fairly
  // close: a bot that jinxed at every chance would freeze the game).
    let jinx: DqAction["jinx"];
    if (jinxAt && v.canJinx && v.now >= this.thinkAt) {
      this.thinkAt = v.now + 1500 + Math.random() * 2500;
      const eye: Vec3 = [p[0], p[1] + EYE_HEIGHT, p[2]];
      const t = len(sub(jinxAt.p, eye)) / DQ.jinx.speed;
      const lead: Vec3 = [jinxAt.p[0] + jinxAt.v[0] * t, jinxAt.p[1] + jinxAt.v[1] * t, jinxAt.p[2] + jinxAt.v[2] * t];
      if (len(sub(lead, eye)) < DQ.jinx.range * 0.5) jinx = { o: eye, d: norm(sub(lead, eye)) };
    }
    return { p, ry, throwDir, jinx };
  }
}

// The brain of a tag/infection bot. Each tick it looks at where everyone is
// and decides where to walk, and (as a chaser) whom to tag. It never cheats:
// it moves at most BOT speeds, and its tags go through the same server checks
// as a real player's (ChaseRoom.handleTag).
//
//  - Chaser: walk a path to the nearest runner; tag when close.
//  - Runner: when a chaser is near, pick a spot far from the chasers (and not
//    past them) and run there; otherwise wander.
//  - Between rounds: wander slowly.

import { RUN_SPEED, WALK_SPEED } from "../../../shared/src/constants.ts";
import type { Vec3 } from "../../../shared/src/protocol.ts";
import type { Player } from "../rooms/Room.ts";
import { BotWalker, flatDist, type Vec2 } from "./BotWalker.ts";

// A bit slower than a running player, so bots are catchable and escapable.
const CHASE_SPEED = RUN_SPEED * 0.85;
const FLEE_SPEED = RUN_SPEED * 0.82;
const WANDER_SPEED = WALK_SPEED * 0.6;
const DANGER_RADIUS = 14; // a chaser closer than this makes a runner flee
const TAG_REACH = 1.7; // bots tag from a bit closer than the max, like people

export type BotView = {
  now: number;
  dt: number; // seconds since last tick
  me: Player;
  others: Player[];
  chasers: Set<number>;
  playing: boolean;
};

export type BotAction = { p: Vec3; ry: number; tag: number | null };

export class ChaseBot extends BotWalker {
  think(view: BotView): BotAction {
    const { me, now } = view;
    this.sync(me);

    const amChaser = view.chasers.has(me.conn.id);
    const runners = view.others.filter((p) => !view.chasers.has(p.conn.id));
    const chasers = view.others.filter((p) => view.chasers.has(p.conn.id));
    let speed = WANDER_SPEED;
    let tag: number | null = null;

    if (view.playing && amChaser && runners.length) {
      const target = runners.reduce((a, b) => (flatDist(me.p, a.p) < flatDist(me.p, b.p) ? a : b));
      speed = CHASE_SPEED;
      if (now >= this.replanAt) this.planTo([target.p[0], target.p[2]], now, 400);
      const d = Math.hypot(target.p[0] - me.p[0], target.p[1] - me.p[1], target.p[2] - me.p[2]);
      if (d <= TAG_REACH) tag = target.conn.id;
      // Close and on the same level: run straight at them.
      if (flatDist(me.p, target.p) < 3 && Math.abs(target.p[1] - me.p[1]) < 0.5) this.path = [[target.p[0], target.p[2]]];
    } else if (view.playing && !amChaser && chasers.length) {
      const nearest = Math.min(...chasers.map((c) => flatDist(me.p, c.p)));
      if (nearest < DANGER_RADIUS) {
        speed = FLEE_SPEED;
        if (now >= this.replanAt || !this.path.length) this.planTo(this.fleeSpot(me, chasers), now, 1200);
      } else {
        this.wander(now);
      }
    } else {
      this.wander(now);
    }

    return { p: this.step(me.p, speed, view.dt), ry: this.ry, tag };
  }

  // Of a handful of random spots, the one furthest from the chasers, ignoring
  // spots that mean running past a chaser.
  private fleeSpot(me: Player, chasers: Player[]): Vec2 {
    let best: Vec2 = this.grid.randomSpot();
    let bestScore = -Infinity;
    for (let i = 0; i < 14; i++) {
      const spot = this.grid.randomSpot();
      const spot3: Vec3 = [spot[0], me.p[1], spot[1]];
      const away = Math.min(...chasers.map((c) => flatDist(spot3, c.p)));
      // Penalize spots on the far side of a chaser.
      const blocked = chasers.some((c) => {
        const toSpot = [spot[0] - me.p[0], spot[1] - me.p[2]];
        const toChaser = [c.p[0] - me.p[0], c.p[2] - me.p[2]];
        return toSpot[0] * toChaser[0] + toSpot[1] * toChaser[1] > 0 && flatDist(me.p, c.p) < 8;
      });
      const score = away - (blocked ? 30 : 0) - 0.2 * flatDist(me.p, spot3);
      if (score > bestScore) {
        bestScore = score;
        best = spot;
      }
    }
    return best;
  }

}

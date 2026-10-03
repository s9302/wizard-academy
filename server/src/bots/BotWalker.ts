// Walking for server-side bots: follow a path from the NavGrid at a given
// speed, keeping to the floor height (hopping up, dropping down). The bot
// brains (ChaseBot, RoyaleBot) decide where to go; this gets them there.

import type { Vec3 } from "../../../shared/src/protocol.ts";
import type { BotPeer } from "../Connection.ts";
import type { Player } from "../rooms/Room.ts";
import type { NavGrid } from "./NavGrid.ts";

export type Vec2 = [number, number];

const EYE = 0.9; // capsule center above the floor
const CLIMB_RATE = 7; // m/s up (a hop onto a wall or crate)
const FALL_RATE = 14; // m/s down

export const flatDist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);

export class BotWalker {
  readonly peer: BotPeer;
  protected grid: NavGrid;
  protected path: Vec2[] = [];
  protected goal: Vec2 | null = null;
  protected replanAt = 0;
  protected ry = 0;
  protected lastPos: Vec3 = [0, 0, 0]; // where we are (the server's copy)
  private lastTp = -1;

  constructor(peer: BotPeer, grid: NavGrid) {
    this.peer = peer;
    this.grid = grid;
  }

  // Call at the start of each think(): notices server teleports (round
  // start, respawn) and forgets the old plan.
  protected sync(me: Player): void {
    this.lastPos = me.p;
    if (me.tp !== this.lastTp) {
      this.lastTp = me.tp;
      this.path = [];
      this.goal = null;
      this.replanAt = 0;
    }
  }

  protected planTo(goal: Vec2, now: number, replanMs: number): void {
    this.goal = goal;
    this.path = this.grid.findPath([this.lastPos[0], this.lastPos[2]], goal) ?? [];
    this.replanAt = now + replanMs * (0.8 + Math.random() * 0.4); // stagger bots
  }

  protected wander(now: number): void {
    if (!this.path.length || now >= this.replanAt) this.planTo(this.grid.randomSpot(), now, 6000);
  }

  // Walk along the path for one tick, following the floor height.
  protected step(from: Vec3, speed: number, dt: number): Vec3 {
    let [x, y, z] = from;
    let budget = speed * dt;
    while (budget > 0 && this.path.length) {
      const [tx, tz] = this.path[0];
      const d = Math.hypot(tx - x, tz - z);
      if (d <= budget) {
        x = tx;
        z = tz;
        budget -= d;
        this.path.shift();
      } else {
        x += ((tx - x) / d) * budget;
        z += ((tz - z) / d) * budget;
        budget = 0;
      }
    }
    const moved = Math.hypot(x - from[0], z - from[2]);
    if (moved > 0.01) this.ry = Math.atan2(-(x - from[0]), -(z - from[2]));

    const floor = this.grid.floorAt(x, z);
    if (!Number.isNaN(floor)) {
      const targetY = floor + EYE;
      const dy = targetY - y;
      y += dy > 0 ? Math.min(dy, CLIMB_RATE * dt) : Math.max(dy, -FALL_RATE * dt);
    }
    const round = (n: number) => Math.round(n * 1000) / 1000;
    this.lastPos = [round(x), round(y), round(z)];
    return this.lastPos;
  }
}

// Sanity check for client-reported movement: rejects updates that imply
// impossible speed (speed hacks, teleporting).
//
// Network messages don't arrive evenly: a lag spike can deliver several moves
// at once. Comparing each move against the time since the previous one would
// flag those as speeding. Instead each player has a "distance budget" per axis
// that refills at the maximum legal speed (plus some tolerance), up to a cap.
// Each move spends from it. Legit movement never runs the budget dry; a
// teleport or speed hack does.

import { RUN_SPEED, TERMINAL_FALL_SPEED } from "../../shared/src/constants.ts";
import type { Vec3 } from "../../shared/src/protocol.ts";

const TOLERANCE = 1.3;

// meters per second, and the most that can be saved up (meters)
const HORIZONTAL = { rate: RUN_SPEED * TOLERANCE, cap: RUN_SPEED * TOLERANCE };
// Upward: the fastest sustained climb is running up stairs (~4 m/s); a jump
// adds at most JUMP_SPEED^2 / (2g) = ~1.2 m on top of that.
const UP = { rate: 6, cap: 2.5 };
const DOWN = { rate: TERMINAL_FALL_SPEED * TOLERANCE, cap: 15 };

export class MoveCheck {
  private horizontal = HORIZONTAL.cap;
  private up = UP.cap;
  private down = DOWN.cap;
  private last: number;

  constructor(now = Date.now()) {
    this.last = now;
  }

  // Call after a teleport so the jump doesn't count as movement.
  reset(now = Date.now()): void {
    this.horizontal = HORIZONTAL.cap;
    this.up = UP.cap;
    this.down = DOWN.cap;
    this.last = now;
  }

  // How much faster than normal this player may run (a fast class: the Monk).
  speedMul = 1;
  // Until then, any move is fine (a Druid in Dragon Form flies where it likes).
  freeUntil = 0;

  // Allow this many extra meters right now (a Knight's charge). It can go
  // over the usual cap; it's spent like any other distance.
  grant(meters: number): void {
    this.horizontal += meters;
  }

  // Allow this much extra climb (a jump pad's launch).
  grantUp(meters: number): void {
    this.up = Math.max(this.up, meters);
  }

  // Returns true if moving from `from` to `to` is plausible.
  allow(from: Vec3, to: Vec3, now = Date.now()): boolean {
    const seconds = Math.max(0, (now - this.last) / 1000);
    this.last = now;
    const mul = Math.max(1, this.speedMul);
    this.horizontal = Math.max(this.horizontal, Math.min(HORIZONTAL.cap * mul, this.horizontal + HORIZONTAL.rate * mul * seconds));
    this.up = Math.max(this.up, Math.min(UP.cap, this.up + UP.rate * seconds)); // a grant can go over the cap
    this.down = Math.min(DOWN.cap, this.down + DOWN.rate * seconds);
    if (now < this.freeUntil) return true;

    const horizontal = Math.hypot(to[0] - from[0], to[2] - from[2]);
    const dy = to[1] - from[1];
    const up = Math.max(0, dy);
    const down = Math.max(0, -dy);

    if (horizontal > this.horizontal || up > this.up || down > this.down) return false;
    this.horizontal -= horizontal;
    this.up -= up;
    this.down -= down;
    return true;
  }
}

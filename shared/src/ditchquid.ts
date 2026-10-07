// Ditchquid: two teams on brooms. Three hoops stand at each end of the
// pitch, each at a different height. Grab the ball (fly into it), throw it
// (click) through one of the other team's hoops for 10 points. Without the
// ball, click casts a Slowing Jinx: whoever it hits flies at half speed for
// a moment, and drops the ball if they had it. The server owns the ball.

import type { Vec3 } from "./protocol.ts";

export type Hoop = { pos: Vec3; r: number; team: 0 | 1 }; // team: whose hoop it is (they defend it)

export const DQ = {
  roundMs: 300_000, // five minutes
  goalPoints: 10,
  resetMs: 2_500, // after a goal, the ball waits at midfield this long
  ball: {
    radius: 0.35,
    speed: 26, // thrown, m/s (plus a little of your own speed)
    gravity: 7, // m/s^2: floaty
    drag: 0.35, // per second
    bounce: 0.5,
    reach: 1.8, // grab it from this close (flat and up/down)
    rethrowMs: 700, // you can't catch your own throw straight away
    holdMs: 2_000, // just caught it: a jinx slows you but can't knock it loose yet
  },
  jinx: {
    speed: 45,
    range: 55,
    radius: 0.45,
    cooldownMs: 1_200,
    slowFactor: 0.5,
    slowMs: 2_500,
  },
};

export const DQ_TEAMS = [
  { name: "Crimson Kites", color: "#e0483e" },
  { name: "Azure Harriers", color: "#3f8ae0" },
] as const;

// Did the ball, moving from a to b, go through this hoop? (Hoops face along
// x: the ball must cross the hoop's plane inside its ring.)
export function throughHoop(a: Vec3, b: Vec3, hoop: Hoop): boolean {
  const x = hoop.pos[0];
  if ((a[0] - x) * (b[0] - x) > 0 || a[0] === b[0]) return false;
  const t = (x - a[0]) / (b[0] - a[0]);
  const y = a[1] + (b[1] - a[1]) * t;
  const z = a[2] + (b[2] - a[2]) * t;
  return Math.hypot(y - hoop.pos[1], z - hoop.pos[2]) < hoop.r - DQ.ball.radius * 0.5;
}

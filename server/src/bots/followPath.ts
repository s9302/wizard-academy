// Walking along a path from the bots' walking map (NavGrid.findPath), for
// things the server moves itself: monsters and the Storm Tyrant. Moves up
// to speed * dt along the path (dropping waypoints as they're reached),
// stops `stopShort` meters before the last one (so a chaser doesn't walk
// into whoever it's chasing), and keeps `height` above the floor, easing
// up and down slopes rather than snapping.

import type { Vec3 } from "../../../shared/src/protocol.ts";
import type { NavGrid } from "./NavGrid.ts";

export type Vec2 = [number, number];

// Returns where it ends up and the direction it last moved in (null if it didn't).
export function followPath(grid: NavGrid, p: Vec3, path: Vec2[], speed: number, dt: number, stopShort: number, height: number): { p: Vec3; dir: Vec2 | null } {
  let [x, , z] = p;
  let budget = speed * dt;
  let dir: Vec2 | null = null;
  while (budget > 0 && path.length) {
    const [tx, tz] = path[0];
    let d = Math.hypot(tx - x, tz - z);
    const stop = path.length === 1 ? stopShort : 0;
    if (d <= stop) {
      path.shift();
      continue;
    }
    d -= stop;
    const step = Math.min(budget, d);
    const len = Math.hypot(tx - x, tz - z);
    x += ((tx - x) / len) * step;
    z += ((tz - z) / len) * step;
    budget -= step;
    if (step >= d - 1e-6) path.shift();
    if (Math.abs(tx - x) + Math.abs(tz - z) > 0.01) dir = [tx - x, tz - z];
  }
  const floor = grid.floorAt(x, z);
  const y = Number.isNaN(floor) ? p[1] : floor + height;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return { p: [r(x), r(p[1] + Math.max(-10 * dt, Math.min(8 * dt, y - p[1]))), r(z)], dir };
}

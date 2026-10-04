// For the check scripts: the extra stops a run must make for a course's
// tasks (Phase 16), after its checkpoints and before the finish. Orbs: fly
// through each. Runes: stand on each plate in the right order. Bosses are
// fought separately (see fightBoss in trials-check.ts and story-check.ts).

import type { Course } from "../../shared/src/levels/types.ts";
import type { Vec3 } from "../../shared/src/protocol.ts";

export function taskStops(course: Course): Vec3[] {
  const stops: Vec3[] = [];
  for (const t of course.tasks ?? []) {
    if (t.kind === "orbs") stops.push(...t.points);
    if (t.kind === "runes") for (const i of t.order) stops.push([t.points[i][0], t.points[i][1] + 0.9, t.points[i][2]]);
  }
  return stops;
}

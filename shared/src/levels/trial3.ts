// Trial III: The Shattered Bridge. The hardest trial: you start high and
// drop down a broken bridge with 6 m running leaps, climb a staircase of 1 m
// pillars that each rise a full metre, then cross a 0.4 m tightrope and make
// a near-maximum-height jump to the finish. Few safe spots anywhere.

import { COLORS, CourseKit } from "./courseKit.ts";
import type { Level } from "./types.ts";

const k = new CourseKit();
const { stone, stoneDark, violet, rust, start } = COLORS;

// Start high: everything from here goes down before it comes back up.
const START_TOP = 12;
k.plat(0, START_TOP, 0, 6, 6, start);

// Section 1: drop-downs onto 2.5 m stones, zig-zagging.
k.plat(0, 10.8, -7, 2.5, 2.5, stone);
k.plat(-3.5, 9.6, -11.5, 2.5, 2.5, stoneDark);
k.plat(0, 8.4, -16, 2.5, 2.5, stone);
k.plat(3.5, 7.2, -20.5, 2.5, 2.5, stoneDark);
const cp1 = k.checkpoint(3.5, 6.4, -27, 4);

// Section 2: the broken bridge. 6 m running leaps, each landing 0.8 m lower
// (the extra fall time is what makes them possible): take off within about
// a metre of the edge or you won't make it.
k.plat(3.5, 5.6, -36.5, 3, 3, rust);
k.plat(3.5, 4.8, -45.5, 3, 3, rust);
k.plat(3.5, 4.0, -54.5, 3, 3, rust);
const cp2 = k.checkpoint(3.5, 3.2, -63.5, 4);

// Section 3: pillar staircase heading east. 1 x 1 m tops, 1.5 m apart, each
// a full metre higher than the last (max jump height is ~1.2 m).
k.plat(7.5, 4.2, -63.5, 1, 1, violet);
k.plat(10, 5.2, -63.5, 1, 1, violet);
k.plat(12.5, 6.2, -63.5, 1, 1, violet);
k.plat(15, 7.2, -63.5, 1, 1, violet);
k.plat(17.5, 8.2, -63.5, 1, 1, violet);
const cp3 = k.checkpoint(21.5, 8.2, -63.5, 4);

// Section 4: the tightrope, north. 0.4 m wide and 14 m long, then a 1.1 m
// climb onto a small block and a last jump to the finish.
k.plat(21.5, 8.2, -74.5, 0.4, 14, stone);
k.plat(21.5, 9.3, -84, 1.2, 1.2, violet);
const finish = k.finish(21.5, 9.8, -90);

// Scenery: the stumps of the old bridge below section 2.
for (const z of [-36.5, -45.5, -54.5]) k.deco([3.5, -2, z], [1.4, 8, 1.4], stoneDark);

export const trial3: Level = {
  id: "trial3",
  name: "Trial III: The Shattered Bridge",
  spawn: [0, START_TOP + 1, 1],
  spawnSpread: 1.2,
  killY: -10,
  sky: "#f0b38f",
  boxes: k.boxes,
  course: {
    start: k.above(0, START_TOP, 0, 6, 6),
    checkpoints: [cp1, cp2, cp3],
    finish,
  },
};

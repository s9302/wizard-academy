// Trial I: The Floating Steps. A linear course of floating platforms heading
// north (-Z, the way you face when you spawn), with three checkpoints.
// Gaps are 0.5-4 m and steps rise at most 0.8 m; the 4 m gaps need a run.

import { COLORS, CourseKit } from "./courseKit.ts";
import type { Level } from "./types.ts";

const k = new CourseKit();
const { stone, stoneDark, violet, start } = COLORS;

// Start: a wide platform. The timer starts when you step off it.
k.plat(0, 0, 0, 8, 8, start);

// Section 1: stepping stones, rising gently.
k.plat(0, 0, -8, 3, 3, stone);
k.plat(0, 0, -13, 3, 3, stoneDark);
k.plat(1.5, 0.5, -18, 3, 3, stone);
k.plat(-1, 1.0, -23, 3, 3, stoneDark);
k.plat(0.5, 1.5, -28, 3, 3, stone);
const cp1 = k.checkpoint(0, 2, -35);

// Section 2: a narrow beam, a turn east along another beam, then steps up.
k.plat(0, 2, -44, 1.2, 10, violet);
k.plat(0, 2, -51, 3, 3, stone);
k.plat(6.5, 2, -51, 9, 1.2, violet);
k.plat(14, 2.5, -51, 3, 3, stone);
k.plat(14, 3.2, -55.5, 2, 2, stoneDark);
k.plat(14, 3.9, -59.5, 2, 2, stone);
k.plat(14, 4.6, -63.5, 2, 2, stoneDark);
const cp2 = k.checkpoint(14, 4.6, -70);

// Section 3: long running jumps.
k.plat(14, 4.6, -78, 4, 4, stone);
k.plat(14, 4.6, -86, 4, 4, stoneDark);
k.plat(14, 4.6, -94, 4, 4, stone);
k.plat(14, 5.4, -100.5, 4, 4, stoneDark);
const cp3 = k.checkpoint(14, 5.4, -108.5);

// Section 4: zig-zag pillars, climbing.
k.plat(12, 6.0, -115, 2, 2, violet);
k.plat(16, 6.6, -119, 2, 2, violet);
k.plat(12, 7.2, -123, 2, 2, violet);
k.plat(16, 7.8, -127, 2, 2, violet);

const finish = k.finish(14, 8.4, -134);

export const trial1: Level = {
  id: "trial1",
  name: "Trial I: The Floating Steps",
  spawn: [0, 1, 1.5],
  spawnSpread: 1.5,
  killY: -10,
  sky: "#a9b8ff",
  boxes: k.boxes,
  course: {
    start: k.above(0, 0, 0, 8, 8),
    checkpoints: [cp1, cp2, cp3],
    finish,
  },
};

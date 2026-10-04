// Trial V: The Hollow Stair. Chapter V. Down into the storm's hollow on a
// broken stair, across tiny stones set off in both directions, up a stair
// of rising columns, and along a tightrope that turns.

import { COLORS, CourseKit } from "./courseKit.ts";
import type { Level } from "./types.ts";

const k = new CourseKit();
const { stone, stoneDark, violet, rust, start, gold } = COLORS;
const HOLLOW = "#3d2f5c";

const START = 14;
k.plat(0, START, 0, 6, 6, start);

// Section 1: the broken stair down, east.
k.plat(5, 13, 0, 2, 2, stone);
k.plat(9, 12, 1.5, 2, 2, stoneDark);
k.plat(13, 11, 0, 2, 2, stone);
k.plat(17, 10, -1.5, 2, 2, stoneDark);
k.plat(21, 9, 0, 2, 2, stone);
const cp1 = k.checkpoint(27, 8.4, 0, 4);

// Section 2: the hollow. 1 m stones, offset in both directions.
k.plat(31, 8.4, 2.5, 1, 1, violet);
k.plat(34, 8.4, 0, 1, 1, violet);
k.plat(37, 8.4, 2.5, 1, 1, violet);
k.plat(40, 8.4, 0, 1, 1, violet);
k.plat(43, 8.4, 2.5, 1, 1, violet);
const cp2 = k.checkpoint(48, 8.4, 1, 4);

// Section 3: the stair of columns, north, each 0.8 m higher.
k.plat(48, 9.2, -3.5, 1.5, 1.5, stoneDark);
k.plat(48, 10.0, -7.0, 1.5, 1.5, stoneDark);
k.plat(48, 10.8, -10.5, 1.5, 1.5, stoneDark);
k.plat(48, 11.6, -14.0, 1.5, 1.5, stoneDark);
k.plat(48, 12.4, -17.5, 1.5, 1.5, stoneDark);
const cp3 = k.checkpoint(48, 12.4, -23, 4);

// Section 4: a tightrope north, a 1 m stone to turn on, a tightrope east,
// and up to the finish.
k.plat(48, 12.4, -28, 0.5, 6, rust);
k.plat(48, 12.4, -32, 1, 1, violet);
k.plat(52, 12.4, -32, 6, 0.5, rust);
const finish = k.finish(59, 12.8, -32, "x");

// Scenery: the hollow's walls, deep below.
for (const [x, z, h] of [
  [24, 8, 14],
  [38, -6, 18],
  [56, -16, 22],
  [10, -8, 12],
]) {
  k.deco([x, h / 2 - 8, z], [3, h, 3], HOLLOW);
}
k.deco([48, 16, -23], [0.6, 0.6, 0.6], gold);

export const trial5: Level = {
  id: "trial5",
  name: "Trial V: The Hollow Stair",
  spawn: [0, START + 1, 1],
  spawnSpread: 1.2,
  killY: -10,
  sky: "#a98fc9",
  skyStyle: "dusk",
  boxes: k.boxes,
  course: { start: k.above(0, START, 0, 6, 6), checkpoints: [cp1, cp2, cp3], finish },
};

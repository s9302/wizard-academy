// Trial IV: The Storm Gate. Chapter IV. Where Vale's trail meets the storm:
// a zig-zag climb of gate stones, narrow beams with sharp turns, a row of
// "storm teeth" that drop and rise, and long leaps down to the gate itself.

import { COLORS, CourseKit } from "./courseKit.ts";
import type { Level } from "./types.ts";

const k = new CourseKit();
const { stone, stoneDark, violet, rust, start, gold } = COLORS;
const STORM = "#5b3f8f";

k.plat(0, 2, 0, 6, 6, start);

// Section 1: gate stones, zig-zagging up 0.6 m at a time.
k.plat(0, 2.6, -6, 2, 2, stone);
k.plat(2.5, 3.2, -10.5, 2, 2, stoneDark);
k.plat(0, 3.8, -14.5, 2, 2, stone);
k.plat(-2.5, 4.4, -18.5, 2, 2, stoneDark);
k.plat(0, 5.0, -22.5, 2, 2, stone);
const cp1 = k.checkpoint(0, 5.0, -29, 4);

// Section 2: the narrows. A 1 m beam east, a corner stone, a turn north
// along another beam, then stones up and across.
k.plat(6.25, 5.0, -29, 5.5, 1, rust);
k.plat(10, 5.0, -29, 1.5, 1.5, violet);
k.plat(10, 5.0, -33.5, 1, 6, rust);
k.plat(10, 5.4, -41, 2, 2, violet);
k.plat(6, 5.8, -44.5, 2, 2, violet);
const cp2 = k.checkpoint(0, 5.8, -50, 4);

// Section 3: storm teeth. 1 m stones, 4 m apart center to center (3 m
// gaps, a standing jump each): down, down, up, up.
k.plat(0, 5.0, -55.5, 1, 1, stoneDark);
k.plat(0, 4.2, -59.5, 1, 1, stoneDark);
k.plat(0, 5.0, -63.5, 1, 1, stoneDark);
k.plat(0, 5.8, -67.5, 1, 1, stoneDark);
const cp3 = k.checkpoint(0, 5.8, -72.5, 4); // 2.5 m from the last tooth: no run-up there

// Section 4: down to the gate in long leaps.
k.plat(0, 5.2, -81, 3, 3, rust);
k.plat(0, 4.6, -89, 3, 3, rust);
const finish = k.finish(0, 5.0, -97);

// Scenery: the Storm Gate's two towers and the cloud-stones around it.
for (const x of [-6, 6]) k.deco([x, 3, -97], [2, 16, 2], STORM);
k.deco([0, 11.5, -97], [14, 1.4, 2], STORM);
k.deco([0, 12.6, -97], [1.2, 1.2, 1.2], gold);
for (const [x, z] of [
  [-9, -40],
  [12, -60],
  [-8, -75],
  [9, -15],
]) {
  k.deco([x, 1, z], [2.5, 6, 2.5], STORM);
}

export const trial4: Level = {
  id: "trial4",
  name: "Trial IV: The Storm Gate",
  spawn: [0, 3, 1],
  spawnSpread: 1.2,
  killY: -10,
  sky: "#c9a0dc",
  skyStyle: "dusk",
  boxes: k.boxes,
  course: { start: k.above(0, 2, 0, 6, 6), checkpoints: [cp1, cp2, cp3], finish },
};

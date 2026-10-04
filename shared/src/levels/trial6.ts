// Trial VI: The Eye of the Storm. Chapter VI, the last. Long leaps down
// toward the storm, a climb of pillars a full meter apart, a ring of stones
// around the eye itself, and one more tightrope to where Vale is waiting.

import { COLORS, CourseKit } from "./courseKit.ts";
import type { Level } from "./types.ts";

const k = new CourseKit();
const { stone, stoneDark, violet, rust, start, gold } = COLORS;
const EYE = "#7d3fbf";

const START = 6;
k.plat(0, START, 0, 6, 6, start);

// Section 1: 6 m leaps, each landing 0.8 m lower.
k.plat(0, 5.2, -10.5, 3, 3, rust);
k.plat(0, 4.4, -19.5, 3, 3, rust);
k.plat(0, 3.6, -28.5, 3, 3, rust);
const cp1 = k.checkpoint(0, 2.8, -37.5, 4);

// Section 2: pillars east, 1 m higher each (the most you can jump is ~1.2).
k.plat(4, 3.8, -37.5, 1, 1, violet);
k.plat(6.5, 4.8, -37.5, 1, 1, violet);
k.plat(9, 5.8, -37.5, 1, 1, violet);
k.plat(11.5, 6.8, -37.5, 1, 1, violet);
k.plat(14, 7.8, -37.5, 1, 1, violet);
const cp2 = k.checkpoint(18, 7.8, -37.5, 4);

// Section 3: the ring around the eye, half way round.
const [ex, ez, er] = [18, -48, 7];
for (const deg of [90, 45, 0, -45, -90]) {
  const a = (deg * Math.PI) / 180;
  k.plat(ex + er * Math.cos(a), 7.8, ez + er * Math.sin(a), 1.5, 1.5, deg % 90 ? stone : stoneDark);
}
const cp3 = k.checkpoint(18, 7.8, -61, 4);

// Section 4: the last tightrope, a 1.1 m climb, and the finish.
k.plat(18, 7.8, -68, 0.4, 10, stone);
k.plat(18, 8.9, -75, 1.2, 1.2, violet);
const finish = k.finish(18, 9.4, -81);

// The eye of the storm: a column of wild magic in the middle of the ring.
k.deco([ex, 4, ez], [3, 28, 3], EYE);
k.deco([ex, 19, ez], [1.4, 1.4, 1.4], gold);

export const trial6: Level = {
  id: "trial6",
  name: "Trial VI: The Eye of the Storm",
  spawn: [0, START + 1, 1],
  spawnSpread: 1.2,
  killY: -10,
  sky: "#8a6fb5",
  skyStyle: "dusk",
  boxes: k.boxes,
  course: { start: k.above(0, START, 0, 6, 6), checkpoints: [cp1, cp2, cp3], finish },
};

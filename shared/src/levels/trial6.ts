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

// Phase 16: the Storm Wraith's arena, where Vale waits. Near edge at z -78
// (where the old finish platform's was); the finish arch at the far end.
const ARENA = 9.4;
k.plat(18, ARENA, -90, 20, 24, stone);
for (const x of [8.2, 27.8]) k.deco([x, ARENA + 0.4, -91], [0.4, 0.8, 20], stoneDark);
const cp4 = {
  zone: k.above(18, ARENA, -79.5, 20, 3),
  respawn: [18, ARENA + 1, -79.6] as [number, number, number],
  marker: [26.5, ARENA + 1.6, -79.5] as [number, number, number],
};
k.deco([15.4, ARENA + 1.5, -101.6], [0.6, 3, 0.6], gold);
k.deco([20.6, ARENA + 1.5, -101.6], [0.6, 3, 0.6], gold);
k.deco([18, ARENA + 3.2, -101.6], [5.8, 0.4, 0.6], gold);
const finish = k.above(18, ARENA, -98.5, 6, 5);

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
  course: {
    start: k.above(0, START, 0, 6, 6),
    checkpoints: [cp1, cp2, cp3, cp4],
    finish,
    tasks: [
      {
        id: "wraith",
        kind: "boss",
        label: "Defeat the Storm Wraith",
        boss: "wraith",
        arena: { min: [8, ARENA - 0.5, -102], max: [28, ARENA + 10, -78] },
        home: [18, ARENA + 3.6, -92],
      },
    ],
  },
  props: [{ kind: "npc", talk: "shade", pos: [19.4, 7.8, -59.8], yaw: Math.PI }],
};

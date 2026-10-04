// Trial II: The Spiral Spire. Three laps up a spiral of small floating stones
// around a stone spire. Harder than Trial I: 1.5 x 1.5 m stones, and every
// jump is a running jump that also climbs 0.8 m, with only ~0.6 m of room to
// take off from. A fall usually costs you a lap, or drops you into the void.
// Checkpoints every three-quarters of a lap.

import type { Vec3 } from "../protocol.ts";
import { COLORS, CourseKit } from "./courseKit.ts";
import type { Checkpoint, Level } from "./types.ts";

const k = new CourseKit();

const RADIUS = 7.2;
const STEP_ANGLE = Math.PI / 4; // 8 stones per lap
const RISE = 0.8;
const STEPS = 24; // three laps; the last one is the finish

// Position i on the spiral, starting at +X and turning toward -Z.
function spot(i: number): Vec3 {
  const a = i * STEP_ANGLE;
  const round = (n: number) => Math.round(n * 100) / 100;
  return [round(RADIUS * Math.cos(a)), round(i * RISE), round(-RADIUS * Math.sin(a))];
}

// Start platform, just outside the spiral's first spot.
k.plat(RADIUS + 2, 0, 0, 6, 6, COLORS.start);

const checkpoints: Checkpoint[] = [];
for (let i = 1; i < STEPS; i++) {
  const [x, top, z] = spot(i);
  if (i % 6 === 0) {
    checkpoints.push(k.checkpoint(x, top, z, 4));
  } else {
    k.plat(x, top, z, 1.5, 1.5, i % 2 ? COLORS.violet : COLORS.stoneDark);
  }
}

const [fx, ftop, fz] = spot(STEPS);
const finish = k.finish(fx, ftop, fz, "x");

// The spire itself: scenery in the middle, rising above the finish.
k.deco([0, ftop / 2 - 2, 0], [3, ftop + 8, 3], COLORS.stone);
k.deco([0, ftop + 6.5, 0], [4.2, 0.6, 4.2], COLORS.gold);

// Phase 16: the finish is sealed by four rune plates, one in each corner of
// the finish platform. The Archivist tells you the order: sun, moon, stars,
// flame.
const RUNES: [number, number, string][] = [
  [-1.6, -1.6, "moon"],
  [1.6, -1.6, "flame"],
  [-1.6, 1.6, "sun"],
  [1.6, 1.6, "star"],
];
const runePoints: Vec3[] = RUNES.map(([dx, dz]) => [fx + dx, ftop, fz + dz]);

export const trial2: Level = {
  id: "trial2",
  name: "Trial II: The Spiral Spire",
  spawn: [RADIUS + 3, 1, 0],
  spawnSpread: 1.2,
  spawnYaw: Math.PI / 4, // north-west, toward the first stone
  killY: -10,
  sky: "#c3a9e8",
  boxes: k.boxes,
  course: {
    start: k.above(RADIUS + 2, 0, 0, 6, 6),
    checkpoints,
    finish,
    tasks: [
      {
        id: "runes",
        kind: "runes",
        label: "Wake the four runes in order",
        points: runePoints,
        symbols: RUNES.map((r) => r[2]),
        order: [2, 0, 3, 1], // sun, moon, star, flame
      },
    ],
  },
  props: [{ kind: "npc", talk: "archivist", pos: [fx + 2.6, ftop, fz + 0.2], yaw: Math.PI / 2 }],
};

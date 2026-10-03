// The academy courtyard: a walled arena for tag and infection. Lots of things
// to run around: a central fountain, four stone pillars, raised walkways on
// the east and west sides with ramps at both ends, low walls you can vault,
// and tall walls you can't.

import { FALL_RESPAWN_Y } from "../constants.ts";
import type { Vec3 } from "../protocol.ts";
import type { Box, Level } from "./types.ts";

const FLAGSTONE = "#9c9384";
const WALL = "#6c6889";
const STONE = "#8d8aa6";
const WATER = "#4f8fbf";
const GOLD = "#e8c547";
const WOOD = "#a8744f";
const HEDGE = "#4f7d45";

const HALF = 28; // the courtyard is 56 x 56 m
const boxes: Box[] = [];

// Ground and the outer walls (too tall to jump: 4 m).
boxes.push({ pos: [0, -0.5, 0], size: [HALF * 2 + 4, 1, HALF * 2 + 4], color: FLAGSTONE });
for (const [x, z, w, d] of [
  [0, -HALF, HALF * 2, 1],
  [0, HALF, HALF * 2, 1],
  [-HALF, 0, 1, HALF * 2],
  [HALF, 0, 1, HALF * 2],
]) {
  boxes.push({ pos: [x, 2, z], size: [w, 4, d], color: WALL });
}

// Central fountain: a low basin (you can hop onto its rim) and a spire.
boxes.push({ pos: [0, 0.35, 0], size: [7, 0.7, 7], color: STONE });
boxes.push({ pos: [0, 0.75, 0], size: [5.6, 0.1, 5.6], color: WATER });
boxes.push({ pos: [0, 1.9, 0], size: [1.2, 2.6, 1.2], color: STONE });
boxes.push({ pos: [0, 3.4, 0], size: [0.8, 0.4, 0.8], color: GOLD });

// Four big pillars: corners to circle around.
for (const [x, z] of [
  [-11, -11],
  [11, -11],
  [-11, 11],
  [11, 11],
]) {
  boxes.push({ pos: [x, 3, z], size: [2.2, 6, 2.2], color: WALL });
}

// Raised walkways (east and west), 2.4 m up, with a ramp at each end.
const WALK_TOP = 2.4;
const WALK_HALF_LEN = 12;
const RAMP_RUN = 7; // horizontal length of each ramp
const rampAngle = Math.atan2(WALK_TOP, RAMP_RUN);
const rampLen = Math.hypot(WALK_TOP, RAMP_RUN);
for (const x of [-21, 21]) {
  boxes.push({ pos: [x, WALK_TOP - 0.3, 0], size: [4, 0.6, WALK_HALF_LEN * 2], color: WOOD });
  // Supports, so the walkway doesn't look like it floats.
  for (const z of [-8, 0, 8]) boxes.push({ pos: [x, (WALK_TOP - 0.6) / 2, z], size: [0.6, WALK_TOP - 0.6, 0.6], color: WALL });
  // North ramp rises toward +Z (onto the walkway), south ramp toward -Z.
  const zNorth = -WALK_HALF_LEN - RAMP_RUN / 2;
  const zSouth = WALK_HALF_LEN + RAMP_RUN / 2;
  boxes.push({ pos: [x, WALK_TOP / 2 - 0.2, zNorth], size: [4, 0.4, rampLen], color: WOOD, rot: [-rampAngle, 0, 0] });
  boxes.push({ pos: [x, WALK_TOP / 2 - 0.2, zSouth], size: [4, 0.4, rampLen], color: WOOD, rot: [rampAngle, 0, 0] });
}

// Low walls (0.9 m: jump over them) and tall walls (2.6 m: go around).
const lowWalls: [number, number, number, number][] = [
  [0, -16, 8, 0.6],
  [0, 16, 8, 0.6],
  [-6, -6, 0.6, 4],
  [6, 6, 0.6, 4],
];
for (const [x, z, w, d] of lowWalls) boxes.push({ pos: [x, 0.45, z], size: [w, 0.9, d], color: STONE });
const tallWalls: [number, number, number, number][] = [
  [-6, 22, 10, 0.8],
  [6, -22, 10, 0.8],
  [-14, 0, 0.8, 8],
  [14, 0, 0.8, 8],
];
for (const [x, z, w, d] of tallWalls) boxes.push({ pos: [x, 1.3, z], size: [w, 2.6, d], color: WALL });

// Hedges in the corners: tall, for hiding behind.
for (const [x, z] of [
  [-23, -23],
  [23, 23],
  [-23, 23],
  [23, -23],
]) {
  boxes.push({ pos: [x, 1, z], size: [3, 2, 3], color: HEDGE });
}

// Crates to hop on.
for (const [x, z, s] of [
  [8, -16, 1],
  [9, -16, 1],
  [-8, 16, 1.2],
  [17, 18, 1],
  [-17, -18, 1],
]) {
  boxes.push({ pos: [x, s / 2, z], size: [s, s, s], color: WOOD });
}

// Spread-out spawn points, so a round never starts with everyone in a pile.
const spawnPoints: Vec3[] = [
  [0, 1, -10],
  [0, 1, 10],
  [-10, 1, 0],
  [10, 1, 0],
  [-18, 1, -18],
  [18, 1, 18],
  [-18, 1, 18],
  [18, 1, -18],
  [-6, 1, 14],
  [6, 1, -14],
];

export const courtyard: Level = {
  id: "courtyard",
  name: "The Courtyard",
  spawn: [0, 1, -10],
  spawnSpread: 1,
  spawnPoints,
  killY: FALL_RESPAWN_Y,
  sky: "#9ec9ff",
  boxes,
};

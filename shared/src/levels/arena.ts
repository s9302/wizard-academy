// The battle royale arena: ruins in an 84 x 84 m walled bowl. From the
// middle out: a raised dais with broken pillars, a ring of broken walls
// (some tall enough to hide behind, some low enough to shoot over), arches
// on the four sides, scattered cover, and four watchtowers in the corners
// with ramps up. Spells can't pass through anything, so cover matters.

import { FALL_RESPAWN_Y } from "../constants.ts";
import type { Vec3 } from "../protocol.ts";
import type { Box, Level } from "./types.ts";

const SAND = "#b9a27a";
const STONE = "#8d8aa6";
const STONE_DARK = "#6c6889";
const RUIN = "#9c8f7a";
const WOOD = "#a8744f";
const GOLD = "#e8c547";
const MOSS = "#6f8f4f";

const HALF = 42;
const boxes: Box[] = [];

// Ground and the bowl's wall (6 m: nobody climbs out).
boxes.push({ pos: [0, -0.5, 0], size: [HALF * 2 + 4, 1, HALF * 2 + 4], color: SAND });
for (const [x, z, w, d] of [
  [0, -HALF, HALF * 2, 1],
  [0, HALF, HALF * 2, 1],
  [-HALF, 0, 1, HALF * 2],
  [HALF, 0, 1, HALF * 2],
]) {
  boxes.push({ pos: [x, 3, z], size: [w, 6, d], color: STONE_DARK });
}

// A wall segment centered at angle `deg` on a circle, running along it.
function ringWall(radius: number, deg: number, len: number, h: number, color = RUIN): void {
  const a = (deg * Math.PI) / 180;
  // Box x-axis along the tangent (-sin a, cos a): yaw = atan2(-cos a, -sin a).
  boxes.push({ pos: [radius * Math.cos(a), h / 2, radius * Math.sin(a)], size: [len, h, 0.8], color, rot: [0, Math.atan2(-Math.cos(a), -Math.sin(a)), 0] });
}

// ---- The dais (center) ----
const DAIS_TOP = 1.2;
boxes.push({ pos: [0, DAIS_TOP / 2, 0], size: [10, DAIS_TOP, 10], color: STONE });
// Ramps north and south, a step east and west.
const rampRun = 4;
const rampAngle = Math.atan2(DAIS_TOP, rampRun);
const rampLen = Math.hypot(DAIS_TOP, rampRun);
boxes.push({ pos: [0, DAIS_TOP / 2 - 0.2, -5 - rampRun / 2], size: [4, 0.4, rampLen], color: STONE, rot: [-rampAngle, 0, 0] });
boxes.push({ pos: [0, DAIS_TOP / 2 - 0.2, 5 + rampRun / 2], size: [4, 0.4, rampLen], color: STONE, rot: [rampAngle, 0, 0] });
for (const x of [-5.6, 5.6]) boxes.push({ pos: [x, 0.3, 0], size: [1.2, 0.6, 4], color: STONE });
// Broken pillars on the dais, and the crystal in the middle.
for (const [x, z, h] of [
  [-3.5, -3.5, 3.4],
  [3.5, -3.5, 1.8],
  [-3.5, 3.5, 2.2],
  [3.5, 3.5, 3.0],
]) {
  boxes.push({ pos: [x, DAIS_TOP + h / 2, z], size: [1, h, 1], color: STONE_DARK });
}
boxes.push({ pos: [0, DAIS_TOP + 0.5, 0], size: [1, 1, 1], color: STONE_DARK });
boxes.push({ pos: [0, DAIS_TOP + 2.2, 0], size: [0.9, 0.9, 0.9], color: GOLD, rot: [0.62, 0.79, 0] });

// ---- The ring of broken walls (radius 16) ----
for (let k = 0; k < 8; k++) {
  const deg = 22.5 + k * 45;
  if (k % 2 === 0) ringWall(16, deg, 7, 2.4); // full cover
  else ringWall(16, deg, 5, 1.1); // waist high: shoot over it
}

// ---- Arches on the four sides (radius 26) ----
for (const deg of [0, 90, 180, 270]) {
  const a = (deg * Math.PI) / 180;
  const [cx, cz] = [26 * Math.cos(a), 26 * Math.sin(a)];
  const [tx, tz] = [-Math.sin(a), Math.cos(a)]; // along the arch
  for (const s of [-2.3, 2.3]) boxes.push({ pos: [cx + tx * s, 1.7, cz + tz * s], size: [1, 3.4, 1], color: STONE_DARK });
  boxes.push({ pos: [cx, 3.8, cz], size: [Math.abs(tx) * 5.6 + Math.abs(tz) * 1, 0.8, Math.abs(tz) * 5.6 + Math.abs(tx) * 1], color: STONE_DARK });
}

// ---- Scattered cover between the arches and the towers ----
for (const deg of [20, 70, 110, 160, 200, 250, 290, 340]) ringWall(24, deg, 4, 2.2, deg % 20 === 0 ? RUIN : MOSS);
// Crates and a fallen column in each quadrant.
for (const [sx, sz] of [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
]) {
  boxes.push({ pos: [sx * 13, 0.5, sz * 35], size: [1, 1, 1], color: WOOD });
  boxes.push({ pos: [sx * 14.1, 0.5, sz * 35.3], size: [1, 1, 1], color: WOOD });
  boxes.push({ pos: [sx * 13.5, 1.5, sz * 35.1], size: [1, 1, 1], color: WOOD });
  boxes.push({ pos: [sx * 31, 0.6, sz * 12], size: [1.2, 1.2, 6], color: RUIN }); // fallen column
}

// ---- Watchtowers in the corners: 3 m up, a ramp, a low parapet ----
const TOWER_TOP = 3;
const towerRun = 8;
const towerAngle = Math.atan2(TOWER_TOP, towerRun);
const towerRampLen = Math.hypot(TOWER_TOP, towerRun);
for (const [sx, sz] of [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
]) {
  const [x, z] = [sx * 30, sz * 30];
  boxes.push({ pos: [x, TOWER_TOP / 2, z], size: [5, TOWER_TOP, 5], color: STONE });
  // The ramp comes in from the side facing the middle (along x), rising toward the tower.
  boxes.push({
    pos: [x - sx * (2.5 + towerRun / 2), TOWER_TOP / 2 - 0.2, z],
    size: [towerRampLen, 0.4, 3],
    color: WOOD,
    rot: [0, 0, sx * towerAngle],
  });
  // Parapet on the three other sides.
  boxes.push({ pos: [x + sx * 2.3, TOWER_TOP + 0.45, z], size: [0.4, 0.9, 5], color: STONE_DARK });
  boxes.push({ pos: [x, TOWER_TOP + 0.45, z + sz * 2.3], size: [5, 0.9, 0.4], color: STONE_DARK });
  boxes.push({ pos: [x, TOWER_TOP + 0.45, z - sz * 2.3], size: [5, 0.9, 0.4], color: STONE_DARK });
}

// Spawn points: ten around the outside, so nobody starts next to anyone.
const spawnPoints: Vec3[] = [];
for (let k = 0; k < 10; k++) {
  const a = (k * 36 * Math.PI) / 180;
  spawnPoints.push([Math.round(33 * Math.cos(a) * 10) / 10, 1, Math.round(33 * Math.sin(a) * 10) / 10]);
}

// Where pickups appear (the item floats here; y is about chest height).
export const pickupSpots: Vec3[] = [
  [0, DAIS_TOP + 0.9, -2], // on the dais
  [0, DAIS_TOP + 0.9, 2],
  [30, TOWER_TOP + 0.9, 30], // tower tops
  [-30, TOWER_TOP + 0.9, 30],
  [30, TOWER_TOP + 0.9, -30],
  [-30, TOWER_TOP + 0.9, -30],
  [0, 0.9, 22.5], // just inside the arches
  [0, 0.9, -22.5],
  [22.5, 0.9, 0],
  [-22.5, 0.9, 0],
  [10, 0.9, 10], // inside the ring
  [-10, 0.9, -10],
  [10, 0.9, -10],
  [-10, 0.9, 10],
];

export const arena: Level = {
  id: "arena",
  name: "The Ruins",
  spawn: [0, 1, 33],
  spawnSpread: 1,
  spawnYaw: 0,
  spawnPoints,
  killY: FALL_RESPAWN_Y,
  sky: "#e3b7c8",
  boxes,
  pickupSpots,
};

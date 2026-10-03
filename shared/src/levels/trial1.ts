// Trial I: The Floating Steps. A linear course of floating platforms heading
// north (-Z, the way you face when you spawn), with three checkpoints.
//
// Jump budget (see constants.ts): a running jump covers ~5.6 m on the flat and
// the highest jump is ~1.2 m, so gaps here are 0.5-4 m and steps rise at most
// 0.8 m. The 4 m gaps need a running jump.

import type { Vec3 } from "../protocol.ts";
import type { Box, Checkpoint, Level, Zone } from "./types.ts";

const STONE = "#8d8aa6";
const STONE_DARK = "#6c6889";
const VIOLET = "#7b68b5";
const TEAL = "#4fa3a5"; // checkpoint platforms
const GOLD = "#e8c547";
const START = "#5b8f5a";

const boxes: Box[] = [];

// A platform 1 m thick whose top surface is at `top`.
function plat(x: number, top: number, z: number, w: number, d: number, color: string): void {
  boxes.push({ pos: [x, top - 0.5, z], size: [w, 1, d], color });
}

// The air above a platform, up to 4 m high: a trigger zone.
function above(x: number, top: number, z: number, w: number, d: number): Zone {
  return { min: [x - w / 2, top, z - d / 2], max: [x + w / 2, top + 4, z + d / 2] };
}

function checkpoint(x: number, top: number, z: number): Checkpoint {
  plat(x, top, z, 6, 6, TEAL);
  const respawn: Vec3 = [x, top + 1, z];
  return { zone: above(x, top, z, 6, 6), respawn, marker: [x + 2.2, top + 1.6, z + 2.2] };
}

// Start: a wide platform. The timer starts when you step off it.
plat(0, 0, 0, 8, 8, START);

// Section 1: stepping stones, rising gently.
plat(0, 0, -8, 3, 3, STONE);
plat(0, 0, -13, 3, 3, STONE_DARK);
plat(1.5, 0.5, -18, 3, 3, STONE);
plat(-1, 1.0, -23, 3, 3, STONE_DARK);
plat(0.5, 1.5, -28, 3, 3, STONE);
const cp1 = checkpoint(0, 2, -35);

// Section 2: a narrow beam, a turn east along another beam, then steps up.
plat(0, 2, -44, 1.2, 10, VIOLET);
plat(0, 2, -51, 3, 3, STONE);
plat(6.5, 2, -51, 9, 1.2, VIOLET);
plat(14, 2.5, -51, 3, 3, STONE);
plat(14, 3.2, -55.5, 2, 2, STONE_DARK);
plat(14, 3.9, -59.5, 2, 2, STONE);
plat(14, 4.6, -63.5, 2, 2, STONE_DARK);
const cp2 = checkpoint(14, 4.6, -70);

// Section 3: long running jumps.
plat(14, 4.6, -78, 4, 4, STONE);
plat(14, 4.6, -86, 4, 4, STONE_DARK);
plat(14, 4.6, -94, 4, 4, STONE);
plat(14, 5.4, -100.5, 4, 4, STONE_DARK);
const cp3 = checkpoint(14, 5.4, -108.5);

// Section 4: zig-zag pillars, climbing.
plat(12, 6.0, -115, 2, 2, VIOLET);
plat(16, 6.6, -119, 2, 2, VIOLET);
plat(12, 7.2, -123, 2, 2, VIOLET);
plat(16, 7.8, -127, 2, 2, VIOLET);

// Finish platform with a golden arch at the far end.
const FINISH_TOP = 8.4;
plat(14, FINISH_TOP, -134, 6, 6, STONE);
boxes.push({ pos: [11.5, FINISH_TOP + 1.5, -136.4], size: [0.6, 3, 0.6], color: GOLD });
boxes.push({ pos: [16.5, FINISH_TOP + 1.5, -136.4], size: [0.6, 3, 0.6], color: GOLD });
boxes.push({ pos: [14, FINISH_TOP + 3.2, -136.4], size: [5.6, 0.4, 0.6], color: GOLD });

export const trial1: Level = {
  id: "trial1",
  name: "Trial I: The Floating Steps",
  spawn: [0, 1, 1.5],
  spawnSpread: 1.5,
  killY: -10,
  sky: "#a9b8ff",
  boxes,
  course: {
    start: above(0, 0, 0, 8, 8),
    checkpoints: [cp1, cp2, cp3],
    finish: above(14, FINISH_TOP, -134, 6, 6),
  },
};

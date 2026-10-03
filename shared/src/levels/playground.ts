// A small playground for trying out movement: open ground, a ramp, stairs,
// stepping stones at increasing heights, a tunnel to test head bumps, and a
// perimeter wall.

import { FALL_RESPAWN_Y } from "../constants.ts";
import type { Box, Level } from "./types.ts";

const STONE = "#8d8aa6";
const STONE_DARK = "#6c6889";
const GRASS = "#6fae5c";
const WOOD = "#a8744f";
const GOLD = "#e8c547";

const boxes: Box[] = [];

// Ground: 80 x 80 m, top surface at y = 0.
boxes.push({ pos: [0, -0.5, 0], size: [80, 1, 80], color: GRASS });

// Perimeter walls so nobody walks off the edge.
for (const [x, z, w, d] of [
  [0, -40, 80, 1],
  [0, 40, 80, 1],
  [-40, 0, 1, 80],
  [40, 0, 1, 80],
]) {
  boxes.push({ pos: [x, 1.5, z], size: [w, 3, d], color: STONE_DARK });
}

// Ramp up to a platform (north), about 20 degrees.
boxes.push({ pos: [0, 1.35, -14], size: [4, 0.4, 8], color: STONE, rot: [0.35, 0, 0] });
boxes.push({ pos: [0, 1.4, -21], size: [8, 2.8, 6], color: STONE_DARK });

// Stairs (east): 0.3 m steps, walkable thanks to the controller's autostep.
for (let i = 0; i < 8; i++) {
  const h = 0.3 * (i + 1);
  boxes.push({ pos: [10 + i * 0.6, h / 2, 0], size: [0.6, h, 3], color: WOOD });
}
boxes.push({ pos: [17.5, 1.2, 0], size: [3, 2.4, 3], color: WOOD });

// Stepping stones (west), each one higher.
const stones = [
  [-8, 0.5, 4],
  [-11, 1.1, 6],
  [-14, 1.7, 4],
  [-17, 2.3, 6],
  [-20, 2.9, 4],
  [-23, 3.5, 6],
];
stones.forEach(([x, y, z], i) => {
  boxes.push({ pos: [x, y - 0.25, z], size: [2, 0.5, 2], color: i % 2 ? STONE : STONE_DARK });
});
boxes.push({ pos: [-23, 4.25, 6], size: [0.6, 0.6, 0.6], color: GOLD, rot: [0.6, 0.6, 0] });

// Low tunnel (south) to check that jumping into a ceiling stops you.
boxes.push({ pos: [-2, 1, 14], size: [1, 2, 6], color: STONE });
boxes.push({ pos: [2, 1, 14], size: [1, 2, 6], color: STONE });
boxes.push({ pos: [0, 2.25, 14], size: [5, 0.5, 6], color: STONE_DARK });

// A few crates to hop on and hide behind.
for (const [x, z, s] of [
  [8, 10, 1],
  [9.2, 11, 1],
  [-6, -8, 1.2],
  [14, -12, 1.5],
]) {
  boxes.push({ pos: [x, s / 2, z], size: [s, s, s], color: WOOD });
}
boxes.push({ pos: [8, 1.5, 10], size: [1, 1, 1], color: WOOD }); // stacked crate

// Tower (northeast): a 2 m gap jump up from the ramp platform.
// Max jump height is JUMP_SPEED^2 / (2 * GRAVITY) = ~1.2 m, so +0.8 m is doable.
boxes.push({ pos: [8, 1.8, -21], size: [4, 3.6, 4], color: STONE });

export const playground: Level = {
  id: "playground",
  name: "Playground",
  spawn: [0, 2, 0],
  spawnSpread: 3.5,
  killY: FALL_RESPAWN_Y,
  sky: "#9ec9ff",
  boxes,
};

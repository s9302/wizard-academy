// The hub: a plaza in front of the academy, where everyone arrives. A ring of
// portal arches leads to every other room: the three trials on the west side,
// tag, infection and the playground on the east. The academy building to the
// north is scenery (you can't go in).

import { FALL_RESPAWN_Y } from "../constants.ts";
import type { Vec3 } from "../protocol.ts";
import { type Box, type Level, type Portal, PORTAL_HEIGHT, PORTAL_STEP, PORTAL_WIDTH, portalPoint } from "./types.ts";

const GRASS = "#6fae5c";
const FLAGSTONE = "#9c9384";
const WALL = "#6c6889";
const STONE = "#8d8aa6";
const STONE_DARK = "#57536f";
const ROOF = "#3b2a6b";
const WOOD = "#7a5236";
const WINDOW = "#f2d98a";
const GOLD = "#e8c547";
const HEDGE = "#4f7d45";
const LEAVES = "#3f8a4a";
const TRUNK = "#6b4a30";

const HALF = 38; // the grounds are 76 x 76 m
const PORTAL_RING = 17; // portals stand on a circle this far from the center
const boxes: Box[] = [];

// Ground and a boundary wall.
boxes.push({ pos: [0, -0.5, 0], size: [HALF * 2 + 4, 1, HALF * 2 + 4], color: GRASS });
for (const [x, z, w, d] of [
  [0, -HALF, HALF * 2, 1],
  [0, HALF, HALF * 2, 1],
  [-HALF, 0, 1, HALF * 2],
  [HALF, 0, 1, HALF * 2],
]) {
  boxes.push({ pos: [x, 2, z], size: [w, 4, d], color: WALL });
}

// ---- The academy building (north) ----

const FRONT = -28; // z of the facade
boxes.push({ pos: [0, 7, FRONT - 4], size: [40, 14, 8], color: WALL });
// Battlements along the top of the facade.
for (let x = -19; x <= 19; x += 2) boxes.push({ pos: [x, 14.4, FRONT - 0.4], size: [1, 0.8, 0.8], color: WALL });
// Grand door and the steps up to it.
boxes.push({ pos: [0, 4, FRONT + 0.15], size: [6, 8, 0.3], color: WOOD });
boxes.push({ pos: [0, 8.6, FRONT + 0.2], size: [7, 1.2, 0.4], color: STONE });
for (let i = 0; i < 3; i++) boxes.push({ pos: [0, 0.15 + i * 0.3, FRONT + 2.4 - i * 0.8], size: [10 - i * 1.5, 0.3, 0.8], color: STONE });
// Lit windows, two rows.
for (const y of [4, 10]) {
  for (const x of [-16, -11, -6, 6, 11, 16]) boxes.push({ pos: [x, y, FRONT + 0.1], size: [1.8, 2.8, 0.2], color: WINDOW });
}
boxes.push({ pos: [0, 11.5, FRONT + 0.1], size: [2.4, 2.4, 0.2], color: WINDOW });
// Corner towers with stepped spires.
for (const x of [-22, 22]) {
  boxes.push({ pos: [x, 10, FRONT - 4], size: [7, 20, 7], color: STONE_DARK });
  boxes.push({ pos: [x, 15, FRONT - 0.45], size: [1.6, 2.6, 0.2], color: WINDOW });
  for (let i = 0; i < 4; i++) {
    const w = 7.6 - i * 1.8;
    boxes.push({ pos: [x, 20.6 + i * 1.6, FRONT - 4], size: [w, 1.6, w], color: ROOF });
  }
  boxes.push({ pos: [x, 27.4, FRONT - 4], size: [0.7, 0.7, 0.7], color: GOLD, rot: [0.6, 0.6, 0] });
}

// ---- Central plaza ----

boxes.push({ pos: [0, 0.15, 0], size: [14, 0.3, 14], color: FLAGSTONE });
boxes.push({ pos: [0, 0.45, 0], size: [7, 0.3, 7], color: STONE });
boxes.push({ pos: [0, 1.6, 0], size: [1.4, 2, 1.4], color: STONE_DARK });
boxes.push({ pos: [0, 2.7, 0], size: [2, 0.2, 2], color: STONE });
// The academy's crystal, hovering over the pedestal.
boxes.push({ pos: [0, 4.4, 0], size: [1.3, 1.3, 1.3], color: GOLD, rot: [0.62, 0.79, 0] });
// The path north to the academy door, and south to where you arrive.
boxes.push({ pos: [0, 0.03, -16], size: [3, 0.06, 18], color: FLAGSTONE }); // plaza edge (-7) to the steps (-25)
boxes.push({ pos: [0, 0.03, 22], size: [3, 0.06, 30], color: FLAGSTONE });

// ---- Portals ----

// Angles around the plaza (0 = east, 90 = south; north is the academy).
const portalAngles: [string, number, string][] = [
  ["trial1", 150, "#8f7bff"],
  ["trial2", 180, "#6f9dff"],
  ["trial3", 210, "#5ad1ff"],
  ["tag", 30, "#ff5a4a"],
  ["infection", 0, "#7dff5a"],
  ["playground", 330, "#ffd25a"],
];

export const portals: Portal[] = portalAngles.map(([room, degrees, color]) => {
  const a = (degrees * Math.PI) / 180;
  // Face the center: front = (-sin yaw, -cos yaw) must point at (-cos a, -sin a).
  return { room, pos: [PORTAL_RING * Math.cos(a), 0, PORTAL_RING * Math.sin(a)] as Vec3, yaw: Math.atan2(Math.cos(a), Math.sin(a)), color };
});

const PILLAR = 0.8;
for (const portal of portals) {
  const rot: Vec3 = [0, portal.yaw, 0];
  const pillarH = PORTAL_HEIGHT + 0.4;
  const side = PORTAL_WIDTH / 2 + PILLAR / 2;
  // Step, pillars, lintel, and a dark back wall (you can only go in the front).
  boxes.push({ pos: portalPoint(portal, 0, PORTAL_STEP / 2, 0.2), size: [PORTAL_WIDTH + 2.4, PORTAL_STEP, 2.6], color: STONE, rot });
  for (const s of [-side, side]) {
    boxes.push({ pos: portalPoint(portal, s, PORTAL_STEP + pillarH / 2, 0), size: [PILLAR, pillarH, PILLAR], color: STONE_DARK, rot });
  }
  boxes.push({ pos: portalPoint(portal, 0, PORTAL_STEP + pillarH + 0.4, 0), size: [PORTAL_WIDTH + 2 * PILLAR + 0.6, 0.8, PILLAR + 0.2], color: STONE_DARK, rot });
  boxes.push({ pos: portalPoint(portal, 0, PORTAL_STEP + pillarH + 1.2, 0), size: [0.6, 0.6, 0.6], color: GOLD, rot: [0.6, portal.yaw, 0.6] });
  boxes.push({ pos: portalPoint(portal, 0, PORTAL_STEP + pillarH / 2, -0.6), size: [PORTAL_WIDTH + 0.4, pillarH, 0.3], color: "#241c3a", rot });
  // A flagstone path from the plaza to the portal.
  boxes.push({ pos: portalPoint(portal, 0, 0.03, 6), size: [2.4, 0.06, 7], color: FLAGSTONE, rot });
}

// ---- Greenery ----

function tree(x: number, z: number, scale = 1): void {
  boxes.push({ pos: [x, 1.2 * scale, z], size: [0.6 * scale, 2.4 * scale, 0.6 * scale], color: TRUNK });
  boxes.push({ pos: [x, 3.2 * scale, z], size: [3 * scale, 1.8 * scale, 3 * scale], color: LEAVES });
  boxes.push({ pos: [x, 4.5 * scale, z], size: [1.8 * scale, 1.2 * scale, 1.8 * scale], color: LEAVES, rot: [0, 0.6, 0] });
}
for (const [x, z, s] of [
  [-30, 30, 1.2],
  [30, 30, 1.1],
  [-31, -14, 1],
  [31, -14, 1.3],
  [-12, 31, 0.9],
  [12, 31, 1],
  [-28, 8, 0.8],
  [28, 6, 0.9],
]) {
  tree(x, z, s);
}
// Hedges lining the arrival path.
for (const x of [-3, 3]) {
  for (const z of [16, 22, 28]) boxes.push({ pos: [x, 0.5, z], size: [0.8, 1, 4], color: HEDGE });
}

export const academy: Level = {
  id: "academy",
  name: "The Academy",
  spawn: [0, 1.2, 25],
  spawnSpread: 1.5,
  spawnYaw: 0, // facing north, at the plaza and the academy
  killY: FALL_RESPAWN_Y,
  sky: "#a9c8f5",
  boxes,
  portals,
};

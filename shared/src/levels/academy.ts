// The hub: a plaza in front of the academy, where everyone arrives. A ring of
// portal arches leads to the games: tag, infection and capture the flag on
// the east, the battle royale, Horde and Ditchquid on the west. The trials are all
// inside the academy (north, its doors always open): I to III in the Hall of
// Trials, IV to IX in the Headmaster's Sanctum behind it.
//
// The story opens more of it: Chapter I opens the Spell Garden (southwest
// corner), Chapter II the Observatory (southeast), and Chapter III the
// Sanctum's doors. Around the plaza
// stand the Spellbook (choose your spell), the Wardrobe (hat and robe) and
// the Chronicle (the story so far).

import { FALL_RESPAWN_Y } from "../constants.ts";
import type { Vec3 } from "../protocol.ts";
import { houseTowers } from "./academyHouses.ts";
import { UPPER, upperFloor } from "./academyUpper.ts";
import { type Box, type Label, type Level, type PointLightDef, type Portal, PORTAL_HEIGHT, PORTAL_STEP, PORTAL_WIDTH, portalPoint, type Prop, type Station } from "./types.ts";

const GRASS = "#6fae5c";
const FLAGSTONE = "#9c9384";
const WALL = "#6c6889";
const STONE = "#8d8aa6";
const STONE_DARK = "#57536f";
const STONE_LIGHT = "#a5a2bb";
const ROOF = "#3b2a6b";
const WOOD = "#7a5236";
const WINDOW = "#f2d98a";
const GOLD = "#e8c547";
const HEDGE = "#4f7d45";
const LEAVES = "#3f8a4a";
const TRUNK = "#6b4a30";
const BARRIER = "#b48cff"; // drawn as a shimmering see-through wall
const CARPET = "#8c2a3c";
const BOOKS = ["#7a3b9e", "#2f6fa8", "#a8483b", "#3b8c5a", "#c9a227"];
const FROST = "#bfeeff";
const FLOWERS = ["#ff8fb8", "#ffd25a", "#8fb8ff", "#ff7a5a"];

const HALF = 38; // the grounds are 76 m wide, from z = HALF (south)...
const NORTH = -82; // ...to here, behind the academy
const PORTAL_RING = 17; // portals stand on a circle this far from the center
const boxes: Box[] = [];
// Decoration the client draws (trees, banners, torches, roofs...).
const props: Prop[] = [];

// Ground and a boundary wall.
const MIDZ = (HALF + NORTH) / 2;
const DEPTH = HALF - NORTH;
boxes.push({ pos: [0, -0.5, MIDZ], size: [HALF * 2 + 8, 1, DEPTH + 4], color: GRASS }); // (the house towers stand out over the side walls)
for (const [x, z, w, d] of [
  [0, NORTH, HALF * 2, 1],
  [0, HALF, HALF * 2, 1],
  [-HALF, MIDZ, 1, DEPTH],
  [HALF, MIDZ, 1, DEPTH],
]) {
  boxes.push({ pos: [x, 2, z], size: [w, 4, d], color: WALL });
}
// Battlements along the top of the boundary wall.
for (let t = -HALF + 1; t <= HALF - 1; t += 2.5) {
  for (const [x, z, w, d] of [
    [t, NORTH, 1.2, 1.1],
    [t, HALF, 1.2, 1.1],
  ]) {
    boxes.push({ pos: [x, 4.4, z], size: [w, 0.8, d], color: WALL });
  }
}
for (let t = NORTH + 1; t <= HALF - 1; t += 2.5) {
  for (const x of [-HALF, HALF]) boxes.push({ pos: [x, 4.4, t], size: [1.1, 0.8, 1.2], color: WALL });
}
// Corner turrets on the boundary wall.
for (const [x, z] of [[-HALF, NORTH], [HALF, NORTH], [-HALF, HALF], [HALF, HALF]]) {
  boxes.push({ pos: [x, 3.5, z], size: [3.4, 7, 3.4], color: STONE_DARK });
  props.push({ kind: "cone", pos: [x, 7, z], size: [2.6, 4], color: ROOF });
}

// ---- The academy building (north) ----

// 60 m wide and 48 m deep, with the plaza-facing facade at FRONT. Its great
// doors are always open: inside is the Hall of Trials (Trials I to III), and
// behind the hall's inner doors (they open with Chapter III), the
// Headmaster's Sanctum with Trials IV to IX.
const FRONT = -28; // z of the facade
const BACK = FRONT - 48; // z of the back wall
const AW = 30; // half the building's width
const MID = FRONT - 22; // the wall between the hall and the Sanctum
const HALL_Z = (FRONT + MID) / 2; // the middle of the Hall of Trials
const SANC_Z = (MID + BACK) / 2; // the middle of the Sanctum
const INNER = AW - 0.6; // inside face of the side walls
boxes.push({ pos: [0, 7, BACK + 0.3], size: [AW * 2, 14, 0.6], color: WALL });
for (const x of [-AW + 0.3, AW - 0.3]) boxes.push({ pos: [x, 7, (FRONT + BACK) / 2], size: [0.6, 14, FRONT - BACK], color: WALL });
for (const s of [-1, 1]) boxes.push({ pos: [s * (3 + (AW - 3) / 2), 7, FRONT - 0.3], size: [AW - 3, 14, 0.6], color: WALL });
boxes.push({ pos: [0, 11, FRONT - 0.3], size: [6, 6, 0.6], color: WALL });
boxes.push({ pos: [0, 14.3, (FRONT + BACK) / 2], size: [AW * 2, 0.6, FRONT - BACK], color: WALL });
// Battlements along the top of the facade.
for (let x = -AW + 1; x <= AW - 1; x += 2) boxes.push({ pos: [x, 14.4, FRONT - 0.4], size: [1, 0.8, 0.8], color: WALL });
// The great doors stand open (swung back inside), and the steps up to them.
for (const s of [-1, 1]) boxes.push({ pos: [s * 3.2, 4, FRONT - 2.2], size: [0.3, 8, 3], color: WOOD });
boxes.push({ pos: [0, 8.6, FRONT + 0.2], size: [7, 1.2, 0.4], color: STONE });
// Solid steps, each running back to the facade (no gaps under or behind
// them), a threshold through the doorway, and two steps down inside.
for (let i = 0; i < 3; i++) {
  const top = 0.3 * (i + 1);
  const depth = 2.8 - i * 0.8;
  boxes.push({ pos: [0, top / 2, FRONT + depth / 2], size: [10 - i * 1.5, top, depth], color: STONE });
}
boxes.push({ pos: [0, 0.45, FRONT - 0.3], size: [6, 0.9, 0.6], color: STONE });
for (let i = 0; i < 2; i++) {
  const top = 0.6 - i * 0.3;
  boxes.push({ pos: [0, top / 2, FRONT - 0.6 - 0.4 - i * 0.8], size: [6, top, 0.8], color: STONE });
}
// Lit windows below, stained glass above, and a rose window over the door.
for (const x of [-26, -21, -16, -11, -6, 6, 11, 16, 21, 26]) {
  boxes.push({ pos: [x, 4, FRONT + 0.1], size: [1.8, 2.8, 0.2], color: WINDOW, glow: 2.2 });
  boxes.push({ pos: [x, 10, FRONT + 0.05], size: [2.1, 3.1, 0.1], color: STONE_DARK });
  props.push({ kind: "window", pos: [x, 10, FRONT + 0.12], yaw: 0, size: [1.8, 2.8] });
}
boxes.push({ pos: [0, 11.6, FRONT + 0.05], size: [3.3, 3.3, 0.1], color: STONE_DARK });
props.push({ kind: "window", pos: [0, 11.6, FRONT + 0.12], yaw: 0, size: [3, 3] });
// Banners between the windows, and torches either side of the door.
for (const [x, color] of [[-3.9, "#4a2a9e"], [3.9, "#4a2a9e"], [-8.5, "#1f4f8f"], [8.5, "#1f4f8f"], [-13.5, "#7a1f4a"], [13.5, "#7a1f4a"], [-18.5, "#1f4f8f"], [18.5, "#1f4f8f"], [-23.5, "#4a2a9e"], [23.5, "#4a2a9e"]] as const) {
  props.push({ kind: "banner", pos: [x, 13.4, FRONT + 0.25], yaw: 0, size: [1.5, 4.6], color });
}
for (const x of [-3.7, 3.7]) props.push({ kind: "sconce", pos: [x, 4.6, FRONT + 0.55], yaw: 0, light: true });
// The corner towers are the four houses' (academyHouses.ts, further down).
// Slim turrets rising from the facade, and a great spire over the middle.
for (const x of [-11, 11, -22, 22]) {
  boxes.push({ pos: [x, 17.2, FRONT - 1.6], size: [2.6, 5.2, 2.6], color: STONE_DARK });
  boxes.push({ pos: [x, 17.5, FRONT - 0.25], size: [0.7, 1.4, 0.1], color: WINDOW, glow: 2.2 });
  props.push({ kind: "cone", pos: [x, 19.8, FRONT - 1.6], size: [2.1, 5], color: ROOF });
}
boxes.push({ pos: [0, 19, MID], size: [8, 9, 8], color: STONE_DARK });
for (const s of [-1, 1]) boxes.push({ pos: [s * 4.05, 19.5, MID], size: [0.1, 2.4, 1.2], color: WINDOW, glow: 2.2 });
props.push({ kind: "cone", pos: [0, 23.5, MID], size: [6, 12], color: ROOF });

// ---- The Hall of Trials (inside the doors; always open) ----

// The floor runs right up to the facade and the inner wall (through both
// doorways), so no lawn shows at the thresholds.
boxes.push({ pos: [0, 0.02, HALL_Z], size: [INNER * 2, 0.04, FRONT - MID], color: STONE }); // floor
boxes.push({ pos: [0, 0.05, HALL_Z], size: [2.6, 0.04, FRONT - MID], color: CARPET });
for (const x of [-7, 7]) for (const z of [HALL_Z + 6, HALL_Z - 6]) boxes.push({ pos: [x, 7, z], size: [0.8, 14, 0.8], color: STONE });
// The inner wall, with the Sanctum's doors in the middle (Chapter III),
// and upstairs three doorways from the gallery to the Portrait Gallery.
for (const s of [-1, 1]) boxes.push({ pos: [s * (3 + (INNER - 3) / 2), UPPER / 2, MID], size: [INNER - 3, UPPER, 0.6], color: WALL });
boxes.push({ pos: [0, (6 + UPPER) / 2, MID], size: [6, UPPER - 6, 0.6], color: WALL });
{
  const DOOR_TOP = UPPER + 3.4;
  let x = -INNER;
  for (const dx of [-20, 0, 20, INNER + 1.5]) {
    const end = Math.min(INNER, dx - 1.5);
    boxes.push({ pos: [(x + end) / 2, (UPPER + 14) / 2, MID], size: [end - x, 14 - UPPER, 0.6], color: WALL });
    if (dx < INNER) boxes.push({ pos: [dx, (DOOR_TOP + 14) / 2, MID], size: [3, 14 - DOOR_TOP, 0.6], color: WALL });
    x = dx + 1.5;
  }
}
boxes.push({ pos: [0, 3, MID], size: [6, 6, 0.4], color: WOOD, gate: "area:sanctum" });
boxes.push({ pos: [0, 6.5, MID + 0.5], size: [7, 1, 0.4], color: STONE });
for (const x of [-3.7, 3.7]) props.push({ kind: "sconce", pos: [x, 4.6, MID + 0.85], yaw: 0, light: false });
// Bookshelves along the side walls, and Vale's statue at the east end.
for (const s of [-1, 1]) {
  for (const z of [HALL_Z + 6, HALL_Z - 4]) {
    boxes.push({ pos: [s * (INNER - 0.3), 2.2, z], size: [0.6, 4.4, 5], color: WOOD });
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 4; i++) boxes.push({ pos: [s * (INNER - 0.65), 0.9 + row * 1.35, z - 1.9 + i * 1.27], size: [0.12, 0.85, 1.0], color: BOOKS[(i + row * 2 + (s > 0 ? 1 : 0)) % BOOKS.length] });
    }
  }
}
boxes.push({ pos: [18, 0.6, MID + 2.5], size: [3, 1.2, 3], color: STONE });
boxes.push({ pos: [18, 2.4, MID + 2.5], size: [0.9, 2.4, 0.7], color: STONE_LIGHT });
boxes.push({ pos: [18, 3.95, MID + 2.5], size: [0.6, 0.7, 0.6], color: STONE_LIGHT });
props.push({ kind: "crystal", pos: [18, 5.4, MID + 2.5], color: GOLD, scale: 0.6 });

// ---- The Headmaster's Sanctum (behind the inner doors, Chapter III) ----

boxes.push({ pos: [0, 0.02, (MID + BACK + 0.6) / 2], size: [INNER * 2, 0.04, MID - BACK - 0.6], color: STONE });
boxes.push({ pos: [0, 0.05, (MID + BACK + 0.6) / 2], size: [2.6, 0.04, MID - BACK - 0.6], color: CARPET });
for (const x of [-7, 7]) for (const z of [SANC_Z + 6, SANC_Z - 6]) boxes.push({ pos: [x, (UPPER - 0.4) / 2, z], size: [0.8, UPPER - 0.4, 0.8], color: STONE }); // holding up the floor above
// Bookshelves along the back wall, between the three portals (further down).
for (const cx of [-6.75, 6.75]) {
  boxes.push({ pos: [cx, 2.2, BACK + 0.9], size: [5, 4.4, 0.6], color: WOOD });
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 4; i++) {
      boxes.push({ pos: [cx - 1.9 + i * 1.27, 0.9 + row * 1.35, BACK + 1.25], size: [1.0, 0.85, 0.12], color: BOOKS[(i + row * 2) % BOOKS.length] });
    }
  }
}
// The Headmaster's desk (his letter is on it) and chair, just inside the
// doors on the left; the crown on its stand on the right.
const DESK: [number, number] = [-6.5, MID - 3.2];
boxes.push({ pos: [DESK[0], 0.5, DESK[1]], size: [3, 1, 1.2], color: WOOD });
boxes.push({ pos: [DESK[0] + 0.6, 1.05, DESK[1]], size: [0.5, 0.06, 0.4], color: "#f4efe6" });
boxes.push({ pos: [DESK[0], 0.9, DESK[1] + 1.1], size: [1, 1.8, 0.2], color: CARPET });
boxes.push({ pos: [6.5, 0.55, DESK[1]], size: [0.8, 1.1, 0.8], color: STONE });
for (let i = 0; i < 5; i++) {
  const a = (i / 5) * Math.PI * 2;
  boxes.push({ pos: [6.5 + Math.cos(a) * 0.22, 1.32, DESK[1] + Math.sin(a) * 0.22], size: [0.14, 0.34, 0.14], color: GOLD });
}

// ---- The Spell Garden (southwest corner, Chapter I) ----

const G = { x0: -37.5, x1: -24, z0: 20, z1: 37.5 };
boxes.push({ pos: [(G.x0 + G.x1) / 2, 1.3, G.z0], size: [G.x1 - G.x0, 2.6, 0.8], color: HEDGE });
boxes.push({ pos: [G.x1, 1.3, 23], size: [0.8, 2.6, 6], color: HEDGE });
boxes.push({ pos: [G.x1, 1.3, 33.25], size: [0.8, 2.6, 8.5], color: HEDGE });
boxes.push({ pos: [G.x1, 1.3, 27.5], size: [0.4, 2.6, 3], color: BARRIER, gate: "area:garden" });
boxes.push({ pos: [-31, 0.03, 27.5], size: [4.4, 0.06, 4.4], color: STONE_DARK }); // pond
props.push({ kind: "water", pos: [-31, 0.08, 27.5], size: [4, 4], color: "#24608f" });
[
  [-34.5, 23.5],
  [-34.5, 34],
  [-27.5, 34],
  [-31, 34],
].forEach(([x, z], i) => boxes.push({ pos: [x, 0.15, z], size: [2.4, 0.3, 1.6], color: FLOWERS[i % FLOWERS.length] }));
// The frost shrine.
boxes.push({ pos: [-35.5, 0.5, 28.5], size: [1.2, 1, 1.2], color: STONE });
boxes.push({ pos: [-35.5, 1.7, 28.5], size: [0.7, 1.3, 0.7], color: FROST, rot: [0.3, 0.7, 0.2], glow: 1.8 });
boxes.push({ pos: [-27, 0.55, 22.4], size: [0.6, 1.1, 0.6], color: STONE }); // tablet stand
boxes.push({ pos: [-27, 1.15, 22.4], size: [0.9, 0.1, 0.7], color: STONE_DARK });

// ---- The Observatory (southeast corner, Chapter II) ----

const O = { x0: 24, x1: 37.5, z0: 20, z1: 37.5 };
boxes.push({ pos: [(O.x0 + O.x1) / 2, 1.3, O.z0], size: [O.x1 - O.x0, 2.6, 0.8], color: STONE_DARK });
boxes.push({ pos: [O.x0, 1.3, 23], size: [0.8, 2.6, 6], color: STONE_DARK });
boxes.push({ pos: [O.x0, 1.3, 33.25], size: [0.8, 2.6, 8.5], color: STONE_DARK });
boxes.push({ pos: [O.x0, 1.3, 27.5], size: [0.4, 2.6, 3], color: BARRIER, gate: "area:observatory" });
// The tower (3.5 m up), a ramp to it from the north, a low parapet.
const OBS_TOP = 3.5;
const obsRun = 7;
boxes.push({ pos: [32, OBS_TOP / 2, 32], size: [6, OBS_TOP, 6], color: STONE });
boxes.push({ pos: [32, OBS_TOP / 2 - 0.2, 29 - obsRun / 2], size: [3, 0.4, Math.hypot(obsRun, OBS_TOP)], color: WOOD, rot: [-Math.atan2(OBS_TOP, obsRun), 0, 0] });
boxes.push({ pos: [34.8, OBS_TOP + 0.4, 32], size: [0.4, 0.8, 6], color: STONE_DARK });
boxes.push({ pos: [29.2, OBS_TOP + 0.4, 32], size: [0.4, 0.8, 6], color: STONE_DARK });
boxes.push({ pos: [32, OBS_TOP + 0.4, 34.8], size: [6, 0.8, 0.4], color: STONE_DARK });
// The telescope, and Vale's star chart.
boxes.push({ pos: [33.4, OBS_TOP + 0.6, 33.4], size: [0.3, 1.2, 0.3], color: WOOD });
boxes.push({ pos: [33.4, OBS_TOP + 1.5, 33.1], size: [0.35, 0.35, 2.2], color: GOLD, rot: [0.7, 0.5, 0] });
boxes.push({ pos: [30.8, OBS_TOP + 0.55, 30.4], size: [0.6, 1.1, 0.6], color: STONE_DARK }); // tablet stand
boxes.push({ pos: [30.8, OBS_TOP + 1.15, 30.4], size: [0.9, 0.1, 0.7], color: "#26306b" });

// ---- Stations around the plaza: Spellbook, Wardrobe, Chronicle ----

// A spot on a 10 m circle around the plaza, and the yaw that faces the middle.
const around = (deg: number): { x: number; z: number; yaw: number } => {
  const a = (deg * Math.PI) / 180;
  return { x: 10 * Math.cos(a), z: 10 * Math.sin(a), yaw: Math.atan2(Math.cos(a), Math.sin(a)) };
};
const spellbook = around(120);
boxes.push({ pos: [spellbook.x, 0.55, spellbook.z], size: [0.7, 1.1, 0.7], color: WOOD });
boxes.push({ pos: [spellbook.x, 1.15, spellbook.z], size: [1, 0.12, 0.8], color: WOOD, rot: [0, spellbook.yaw, 0] });
boxes.push({ pos: [spellbook.x, 1.27, spellbook.z], size: [0.7, 0.12, 0.5], color: "#7a3b9e", rot: [0, spellbook.yaw, 0] });
const wardrobe = around(60);
boxes.push({ pos: [wardrobe.x, 1.3, wardrobe.z], size: [1.6, 2.6, 0.5], color: WOOD, rot: [0, wardrobe.yaw, 0] });
boxes.push({ pos: [wardrobe.x, 1.4, wardrobe.z], size: [1.2, 2.0, 0.56], color: "#cfd8e8", rot: [0, wardrobe.yaw, 0] });
const chronicle = around(240);
for (const s of [-1.2, 1.2]) {
  boxes.push({ pos: [chronicle.x + Math.cos(chronicle.yaw) * s, 1, chronicle.z - Math.sin(chronicle.yaw) * s], size: [0.2, 2, 0.2], color: WOOD });
}
boxes.push({ pos: [chronicle.x, 1.6, chronicle.z], size: [2.8, 1.4, 0.15], color: "#d9c79a", rot: [0, chronicle.yaw, 0] });

// Where to stand to use each one: a little in front, toward the plaza.
const front = (p: { x: number; z: number; yaw: number }, d = 1.2): Vec3 => [p.x - Math.sin(p.yaw) * d, 0, p.z - Math.cos(p.yaw) * d];
const stations: Station[] = [
  { id: "spellbook", kind: "spellbook", pos: front(spellbook), label: "Spellbook" },
  { id: "wardrobe", kind: "wardrobe", pos: front(wardrobe), label: "Wardrobe" },
  { id: "chronicle", kind: "chronicle", pos: front(chronicle), label: "The Chronicle" },
  { id: "garden", kind: "tablet", pos: [-27, 0, 23.6], label: "A note", tablet: "garden" },
  { id: "observatory", kind: "tablet", pos: [30.8, OBS_TOP, 31.4], label: "Star chart", tablet: "observatory" },
  { id: "sanctum", kind: "tablet", pos: [DESK[0], 0, DESK[1] - 1.1], label: "The Headmaster's letter", tablet: "sanctum" },
];

const labels: Label[] = [
  { pos: [spellbook.x, 3, spellbook.z], title: "Spellbook", subtitle: "Choose your spell", color: "#b48cff" },
  { pos: [wardrobe.x, 3.6, wardrobe.z], title: "Wardrobe", subtitle: "Hats and robes", color: "#5ac8ff" },
  { pos: [chronicle.x, 3.4, chronicle.z], title: "The Chronicle", subtitle: "The story so far", color: "#e8c547" },
  { pos: [-22.8, 4, 27.5], title: "The Spell Garden", color: "#8fe3ff", unlock: "area:garden" },
  { pos: [22.8, 4, 27.5], title: "The Observatory", color: "#ffe066", unlock: "area:observatory" },
  { pos: [0, 10.2, FRONT + 1.2], title: "The Academy", subtitle: "The Hall of Trials", color: "#ff8fb8" },
  { pos: [0, 5.9, MID + 3.2], title: "The Sanctum", color: "#ff8fb8", unlock: "area:sanctum" },
  { pos: [0, 4.2, FRONT - 6], title: "Upstairs", subtitle: "Library · Champions · Office", color: "#ffd25a" },
  { pos: [-13, 3, BACK + 2.6], title: "Trial V", color: "#7b5bd6", unlock: "area:trial5", onlyLocked: true },
  { pos: [13, 3, BACK + 2.6], title: "Trial VI", color: "#c65bd6", unlock: "area:trial6", onlyLocked: true },
  { pos: [INNER - 1.4, 3, SANC_Z], title: "Trial VII", color: "#ffcf5a", unlock: "area:trial7", onlyLocked: true },
  { pos: [-INNER + 1.4, 3, SANC_Z], title: "Trial VIII", color: "#bff4ff", unlock: "area:trial8", onlyLocked: true },
  { pos: [18, 3, MID - 2.4], title: "Trial IX", color: "#9a7bff", unlock: "area:trial9", onlyLocked: true },
];

// (Every light costs every lit pixel, so the ground floor makes do with one
// light per room now that the upper floor has its own.)
const lights: PointLightDef[] = [
  { pos: [0, 6.5, HALL_Z], color: "#ffd7a0", intensity: 50, distance: 30 },
  { pos: [0, 5.5, SANC_Z], color: "#ffd7a0", intensity: 50, distance: 30 },
];

// ---- The upper floor (academyUpper.ts) ----

{
  const upper = upperFloor(boxes, props, { front: FRONT, mid: MID, back: BACK, inner: INNER });
  stations.push(...upper.stations);
  labels.push(...upper.labels);
  lights.push(...upper.lights);
}

// ---- The house towers on the four corners (academyHouses.ts) ----

const houses = houseTowers(boxes, props);
stations.push(...houses.stations);
labels.push(...houses.labels);

// ---- Central plaza ----

boxes.push({ pos: [0, 0.15, 0], size: [14, 0.3, 14], color: FLAGSTONE });
boxes.push({ pos: [0, 0.45, 0], size: [7, 0.3, 7], color: STONE });
// The fountain: a low rim around a shallow pool (you can wade in it).
for (const [x, z, w, d] of [
  [0, -3.3, 7, 0.4],
  [0, 3.3, 7, 0.4],
  [-3.3, 0, 0.4, 6.2],
  [3.3, 0, 0.4, 6.2],
]) {
  boxes.push({ pos: [x, 0.8, z], size: [w, 0.4, d], color: STONE_DARK });
}
props.push({ kind: "water", pos: [0, 0.82, 0], size: [6.2, 6.2], color: "#2a6fa0" });
boxes.push({ pos: [0, 1.6, 0], size: [1.4, 2, 1.4], color: STONE_DARK });
boxes.push({ pos: [0, 2.7, 0], size: [2, 0.2, 2], color: STONE });
props.push({ kind: "fountain", pos: [0, 2.85, 0] });
// The academy's crystal, hovering over the fountain.
props.push({ kind: "crystal", pos: [0, 4.6, 0], color: GOLD, scale: 0.9 });
// The path north to the academy door, and south to where you arrive.
boxes.push({ pos: [0, 0.03, -16], size: [3, 0.06, 18], color: FLAGSTONE }); // plaza edge (-7) to the steps (-25)
boxes.push({ pos: [0, 0.03, 22], size: [3, 0.06, 30], color: FLAGSTONE });

// ---- Portals ----

// Angles around the plaza (0 = east, 90 = south; north is the academy).
// (The trials are all inside the academy; the path north to its doors is clear.)
const portalAngles: [string, number, string][] = [
  ["tag", 30, "#ff5a4a"],
  ["infection", 0, "#7dff5a"],
  ["ctf", 330, "#ffd25a"],
  ["royale", 180, "#ff3d8b"],
  ["horde", 210, "#ff7a2a"],
  ["ditchquid", 150, "#ffd25a"],
];

const ringPortals: Portal[] = portalAngles.map(([room, degrees, color]) => {
  const a = (degrees * Math.PI) / 180;
  // Face the center: front = (-sin yaw, -cos yaw) must point at (-cos a, -sin a).
  return { room, pos: [PORTAL_RING * Math.cos(a), 0, PORTAL_RING * Math.sin(a)] as Vec3, yaw: Math.atan2(Math.cos(a), Math.sin(a)), color };
});

// Inside the academy: Trials I to III on the Hall of Trials' inner wall
// (facing the doors), and IV to IX in the Sanctum behind it: IV to VI on the
// back wall, VII and VIII on the east and west walls, IX by the doors.
// V to IX are behind barriers until the chapter before them is done (IV
// opens with the Sanctum).
const hallPortals: Portal[] = [
  { room: "trial1", pos: [-18, 0, MID + 1.2], yaw: Math.PI, color: "#8f7bff" },
  { room: "trial2", pos: [-9, 0, MID + 1.2], yaw: Math.PI, color: "#6f9dff" },
  { room: "trial3", pos: [9, 0, MID + 1.2], yaw: Math.PI, color: "#5ad1ff" },
];
const sanctumPortals: Portal[] = [
  { room: "trial4", pos: [0, 0, BACK + 1.2], yaw: Math.PI, color: "#9f7bff" },
  { room: "trial5", pos: [-13, 0, BACK + 1.2], yaw: Math.PI, color: "#7b5bd6" },
  { room: "trial6", pos: [13, 0, BACK + 1.2], yaw: Math.PI, color: "#c65bd6" },
  { room: "trial7", pos: [INNER - 1.2, 0, SANC_Z], yaw: Math.PI / 2, color: "#ffcf5a" },
  { room: "trial8", pos: [-INNER + 1.2, 0, SANC_Z], yaw: -Math.PI / 2, color: "#bff4ff" },
  { room: "trial9", pos: [18, 0, MID - 1.2], yaw: 0, color: "#9a7bff" },
];

// Their signs float lower than outdoors, under the upper floor.
for (const p of [...hallPortals, ...sanctumPortals]) p.signY = PORTAL_STEP + PORTAL_HEIGHT + 1.1;

export const portals: Portal[] = [...ringPortals, ...hallPortals, ...sanctumPortals];

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
  boxes.push({ pos: portalPoint(portal, 0, PORTAL_STEP + pillarH + 1.2, 0), size: [0.6, 0.6, 0.6], color: portal.color, rot: [0.6, portal.yaw, 0.6], glow: 2.5 });
  // Torches in front of each arch.
  if (ringPortals.includes(portal)) {
    for (const side of [-3.3, 3.3]) props.push({ kind: "torch", pos: portalPoint(portal, side, PORTAL_STEP, 1.3), light: false });
  }
  boxes.push({ pos: portalPoint(portal, 0, PORTAL_STEP + pillarH / 2, -0.6), size: [PORTAL_WIDTH + 0.4, pillarH, 0.3], color: "#241c3a", rot });
  // A flagstone path from the plaza to the portal (the courtyard ones).
  if (ringPortals.includes(portal)) boxes.push({ pos: portalPoint(portal, 0, 0.03, 6), size: [2.4, 0.06, 7], color: FLAGSTONE, rot });
}
for (const [room, gate] of [
  ["trial5", "area:trial5"],
  ["trial6", "area:trial6"],
  ["trial7", "area:trial7"],
  ["trial8", "area:trial8"],
  ["trial9", "area:trial9"],
]) {
  const portal = sanctumPortals.find((p) => p.room === room)!;
  boxes.push({
    pos: portalPoint(portal, 0, PORTAL_STEP + PORTAL_HEIGHT / 2, 0.9),
    size: [PORTAL_WIDTH + 0.6, PORTAL_HEIGHT + 0.4, 0.3],
    color: BARRIER,
    rot: [0, portal.yaw, 0],
    gate,
  });
}

// ---- Greenery ----

// A tree: a solid (invisible) trunk to bump into, and the prop that draws it.
function tree(x: number, z: number, scale = 1, kind: "tree" | "pine" = "tree"): void {
  boxes.push({ pos: [x, 1.4 * scale, z], size: [0.5 * scale, 2.8 * scale, 0.5 * scale], color: TRUNK, invisible: true });
  props.push({ kind, pos: [x, 0, z], scale, color: kind === "tree" ? LEAVES : undefined });
}
for (const [x, z, s] of [
  [-30, 30, 1.2],
  [-31, -14, 1],
  [31, -14, 1.3],
  [-12, 31, 0.9],
  [12, 31, 1],
  [-28, 8, 0.8],
  [28, 6, 0.9],
  [-18, 34, 1.1],
  [18, 34, 1.05],
  [-34, -2, 1],
  [34, -4, 1.1],
  [-20, 13, 0.85],
  [20, 12, 0.9],
]) {
  tree(x, z, s);
}
// Pines along the walls.
for (const [x, z] of [[-35.5, -15], [-35, -8], [35.5, -15], [35, 14], [-35, 14], [-8, 35], [8, 35], [-34.5, -44], [34.5, -46], [-34.5, -60], [34.5, -62]]) {
  tree(x, z, 0.9 + ((x * 7 + z * 3) % 5 + 5) / 25, "pine");
}
// Bushes, rocks and flower beds.
for (const [x, z] of [[-9, -8], [9, -8], [-9, 8], [9, 8], [-24, -18], [24, -18]]) props.push({ kind: "bush", pos: [x, 0, z] });
for (const [x, z, sc] of [[-34.5, -38, 1.4], [34.5, -39, 1.1], [-33, 4, 1], [33, 22.5, 0.8], [15, -33, 1.2]]) props.push({ kind: "rock", pos: [x, 0, z], scale: sc });
for (const [x, z] of [[-6.5, -12], [6.5, -12], [-6.5, 12.5], [6.5, 12.5]]) props.push({ kind: "flowers", pos: [x, 0, z], size: [3, 1.2] });
// Lamps along the paths (a few give real light on Ultra).
for (const z of [-11, -19]) for (const x of [-2.2, 2.2]) props.push({ kind: "lamp", pos: [x, 0, z], light: z === -19 });
for (const z of [12, 19, 25, 32]) for (const x of [-2.2, 2.2]) props.push({ kind: "lamp", pos: [x, 0, z], light: z === 12 });
// Hedges lining the arrival path.
for (const x of [-3, 3]) {
  for (const z of [16, 22, 28]) boxes.push({ pos: [x, 0.5, z], size: [0.8, 1, 4], color: HEDGE });
}

// ---- People (Phase 16): teachers to talk to, students wandering about ----
// (Drawn and moved by your own browser only; see client/src/npcs/Npcs.ts.)
props.push(
  { kind: "npc", talk: "thistle", pos: [-7.4, 0, 9.4], yaw: 2.4 },
  { kind: "npc", talk: "rook", pos: [-12.6, 0, 3.6], yaw: -1.9 },
  { kind: "npc", talk: "quill", pos: [-7.8, 0, -7.4], yaw: 0.9 },
  { kind: "npc", talk: "bram", pos: [-20.5, 0, 25], yaw: -1.2 },
);
for (const [x, z, r] of [
  [8, 20, 4],
  [-9, 22, 4],
  [12, -6, 4],
  [-13, -3, 3],
  [9, -21, 3],
  [-10, -20, 3],
  [20, 20, 5],
  [-15, 10, 3],
]) {
  props.push({ kind: "student", pos: [x, 0, z], scale: r });
}

export const academy: Level = {
  id: "academy",
  name: "The Academy",
  spawn: [0, 1.2, 25],
  spawnSpread: 1.5,
  spawnYaw: 0, // facing north, at the plaza and the academy
  killY: FALL_RESPAWN_Y,
  sky: "#a9c8f5",
  skyStyle: "golden",
  boxes,
  props,
  portals,
  stations,
  labels,
  lights,
  teleporters: houses.teleporters,
};

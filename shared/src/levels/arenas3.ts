// Five more arenas, all about getting around: teleporters, jump pads and
// ladders everywhere. The Spire is the climbing one: four levels stacked
// around a central summit. Like the others, everywhere a pickup sits has a
// ramp route for bots; ladders, pads and teleporters are shortcuts.

import { ArenaKit } from "./arenaKit.ts";
import type { Level } from "./types.ts";

const STONE = "#8d8aa6";
const STONE_LIGHT = "#a5a2bb";
const STONE_DARK = "#6c6889";
const DARK = "#57536f";
const WOOD = "#a8744f";
const WOOD_DARK = "#7a5236";
const GRASS = "#6fae5c";
const GOLD = "#e8c547";
const BASALT = "#3d3640";
const SAND = "#c9a46a";
const CLOUD = "#e8ecf5";

// A ladder's yaw for the face of a block it's on (it faces the wall).
const FACE = { "+x": Math.PI / 2, "-x": -Math.PI / 2, "+z": 0, "-z": Math.PI };
const CORNERS: [number, number][] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

// ---------------- Medium: The Spire (64 x 64 m), four levels ----------------

// Ground (0), four corner terraces (4 m), four mid-side ledges (8 m) and the
// summit in the middle (12 m). Ramps link them in a climb (ground, corner,
// side ledge, summit); ladders, jump pads and two teleporters skip ahead.
function spire(): Level {
  const k = new ArenaKit(32, STONE_DARK, DARK, 9);
  // Level 1: the corner terraces (14..26 from the middle).
  for (const [sx, sz] of CORNERS) {
    const x = sx * 20;
    const z = sz * 20;
    k.block(x, z, 12, 12, 4, STONE);
    k.rampZ(sz * 7.2, sz * 14, sx * 16, 3, 0, 4, WOOD); // up from the ground
    k.ladder(sx * 24, sz * 14, 4, sz > 0 ? FACE["-z"] : FACE["+z"]);
    k.pad(sx * 11, z, 16); // next to its inner face
    k.rampZ(sz * 14, sz * 4, x, 3, 4, 8, WOOD_DARK); // on up to the side ledge
    k.wall(x + sx * 5.6, z, 0.5, 12, 0.9, STONE_DARK, 4); // a parapet on the outer edge
    k.pickup(x + sx * 2, z + sz * 2, 4);
  }
  // Level 2: ledges in the middle of each side, 8 x 8.
  for (const s of [1, -1]) {
    k.block(s * 20, 0, 8, 8, 8, STONE_LIGHT);
    k.block(0, s * 20, 8, 8, 8, STONE_LIGHT);
    k.rampX(s * 16, s * 6, 0, 3, 8, 12, WOOD); // to the summit
    k.rampZ(s * 16, s * 6, 0, 3, 8, 12, WOOD);
    k.ladder(0, s * 24, 8, s > 0 ? FACE["+z"] : FACE["-z"]); // the outer face, from the ground
    k.pickup(s * 21, 2, 8);
  }
  // Level 3: the summit, 12 x 12, with a crystal and a low rim.
  k.block(0, 0, 12, 12, 12, STONE);
  for (const [x, z, w, d] of [
    [3.5, -5.8, 2.5, 0.4],
    [-3.5, 5.8, 2.5, 0.4],
    [-5.8, 3.5, 0.4, 3],
    [5.8, -3.5, 0.4, 3],
  ]) {
    k.wall(x, z, w, d, 0.8, STONE_DARK, 12);
  }
  k.props.push({ kind: "crystal", pos: [0, 15, 0], color: GOLD, scale: 0.9 });
  k.pickup(-3, -3, 12).pickup(3, 3, 12);
  // Ladders straight up the summit's sides from the ground (12 m: a long climb).
  k.ladder(6, 3.5, 12, FACE["+x"]).ladder(-6, -3.5, 12, FACE["-x"]);
  // Big jump pads beside the summit (they throw you about 12 m).
  k.pad(9, 9, 22).pad(-9, -9, 22);
  // Teleporters: the ground to the summit, and corner to corner.
  k.teleporterPair([-10, 0, -28], [2, 12, 2], "#ffb347");
  k.teleporterPair([22, 4, 22], [-22, 4, -22]);
  // Lava pools along the sides, and cover on the ground.
  for (const [sx, sz] of CORNERS) k.pit(sx * 29.5, sz * 9, 3, 4, "lava");
  for (const [sx, sz] of CORNERS) k.wall(sx * 8, sz * 16, 3, 1, 1.2, STONE_DARK);
  k.pickup(0, 26).pickup(26, 0).pickup(-26, 0);
  for (const [x, z] of [
    [28, 0],
    [-28, 0],
    [0, 28],
    [0, -28],
    [10, 26],
    [-10, 26],
    [10, -26],
    [9, -9],
    [-9, 9],
  ]) {
    k.spawn(x, z);
  }
  for (const [x, z] of [
    [-30, -30],
    [30, 30],
    [30, -30],
    [-30, 30],
  ]) {
    k.props.push({ kind: "torch", pos: [x, 0, z], light: true });
  }
  return k.level("spire", "The Spire", "medium", "golden", 46);
}

// ---------------- Large: The Magma Islands (96 x 96 m) ----------------

// A lake of lava (it burns, it doesn't kill) with stone islands linked by
// low bridges, a volcano in the middle with ramps and ladders, basalt
// lookouts with ladders, and teleporters between the corner islands.
function magmaIslands(): Level {
  const k = new ArenaKit(48, BASALT, DARK, 6);
  k.pit(0, 0, 80, 80, "lava");
  const isle = (x: number, z: number, w: number, d: number) => k.slab(x, z, w, d, 0, 0.3, STONE_DARK);
  // The middle: an island with the volcano on it.
  isle(0, 0, 22, 22);
  k.block(0, 0, 8, 8, 5, BASALT);
  k.boxes.push({ pos: [0, 5.2, 0], size: [3, 0.4, 3], color: "#ff7a2e", glow: 3 });
  k.rampX(12.5, 4, 0, 3, 0.3, 5, STONE).rampX(-12.5, -4, 0, 3, 0.3, 5, STONE);
  k.ladder(0, 4, 4.7, FACE["+z"], 0.3).ladder(0, -4, 4.7, FACE["-z"], 0.3);
  k.pickup(2, 2, 5);
  // Side islands (radius 26), bridges in to the middle and out to the shore.
  for (const s of [1, -1]) {
    isle(s * 26, 0, 10, 10);
    isle(0, s * 26, 10, 10);
    k.slab(s * 16, 0, 10.5, 3, 0, 0.3, STONE); // to the middle
    k.slab(0, s * 16, 3, 10.5, 0, 0.3, STONE);
    k.slab(s * 36, 0, 10.5, 3, 0, 0.3, STONE); // to the shore
    k.slab(0, s * 36, 3, 10.5, 0, 0.3, STONE);
    // A basalt lookout with a ladder (a perch for archers).
    k.block(s * 28, 3, 2.5, 2.5, 5, BASALT);
    k.ladder(s * 28 - s * 1.25, 3, 4.7, s > 0 ? FACE["-x"] : FACE["+x"], 0.3);
    k.pickup(s * 25, -2, 0.3);
  }
  // Corner islands, linked to the side islands, with pads and teleporters.
  for (const [sx, sz] of CORNERS) {
    isle(sx * 28, sz * 28, 12, 12);
    k.slab(sx * 26, sz * 13.5, 3, 17, 0, 0.3, STONE);
    k.wall(sx * 30, sz * 30, 3, 1, 1.2, STONE_DARK, 0.3);
    k.pad(sx * 24, sz * 31, 16, 0.3);
    k.pickup(sx * 31, sz * 26, 0.3);
  }
  k.teleporterPair([28, 0.3, 28], [-28, 0.3, -28], "#ffb347");
  k.teleporterPair([-28, 0.3, 28], [28, 0.3, -28]);
  // Pads on the shore's corners, and cover there.
  for (const [sx, sz] of CORNERS) {
    k.pad(sx * 44, sz * 44, 16);
    k.wall(sx * 44, sz * 20, 1, 4, 1.2, STONE_DARK);
  }
  for (const [x, z] of [
    [26, 3],
    [-26, -3],
    [3, 26],
    [-3, -26],
  ]) {
    k.spawn(x, z, 0.3);
  }
  for (const [x, z] of [
    [44, 10],
    [-44, -10],
    [10, -44],
    [-10, 44],
  ]) {
    k.spawn(x, z);
  }
  for (const [sx, sz] of CORNERS) k.props.push({ kind: "torch", pos: [sx * 6, 0.3, sz * 6], light: true });
  return k.level("magma", "The Magma Islands", "large", "night", 62);
}

// ---------------- Medium: The Treetops (64 x 64 m) ----------------

// A village in the trees: four platforms 5 m up joined by rope bridges, a
// big platform 9 m up in the middle, and two crow's nests at 13 m (ladders
// and a teleporter only). Huts on the platforms have ladders to their roofs.
// The platforms and the north and south bridges are solid to the bots' map
// (they walk them); the east and west bridges are players' shortcuts that
// you can walk under.
function treetops(): Level {
  const k = new ArenaKit(32, GRASS, WOOD_DARK, 6);
  const L1 = 5;
  const L2 = 9;
  const L3 = 13;
  // The four platforms (9 x 9, 5 m up) on trunks.
  for (const [sx, sz] of CORNERS) {
    const x = sx * 18;
    const z = sz * 18;
    k.block(x, z, 1.6, 1.6, L1 - 0.4, WOOD_DARK);
    k.slab(x, z, 9, 9, L1 - 0.4, L1, WOOD);
    k.pickup(x + sx * 2.5, z - sz * 2.5, L1);
  }
  // Rope bridges between them (2 m wide, 5 m up).
  for (const s of [1, -1]) {
    k.slab(0, s * 18, 27, 2, L1 - 0.4, L1, WOOD_DARK);
    k.bridge(s * 18, 0, 2, 27, L1, WOOD_DARK);
  }
  // Ramps up from the ground to two of them (the others by bridge, pad or hut).
  k.rampZ(-5, -13.5, -21.5, 3, 0, L1, WOOD).rampZ(5, 13.5, 21.5, 3, 0, L1, WOOD);
  // Huts on two platforms, a ladder up to each roof.
  for (const s of [1, -1]) {
    k.wall(s * 18, -s * 18, 4, 4, 2.6, WOOD_DARK, L1);
    k.ladder(s * 18, -s * 18 + s * 2, 2.6, s > 0 ? FACE["+z"] : FACE["-z"], L1);
  }
  // The great platform in the middle, 9 m up, with ramps up from the north
  // and south bridges.
  k.block(0, 0, 2, 2, L2 - 0.4, WOOD_DARK);
  k.slab(0, 0, 14, 14, L2 - 0.4, L2, WOOD);
  for (const s of [1, -1]) k.rampZ(s * 17, s * 7, 0, 3, L1, L2, WOOD);
  k.pickup(-2, 2, L2).pickup(2, -2, L2);
  // Crow's nests at 13 m on tall trunks, each with a post on its outer edge
  // and a ladder up the post from the ground.
  for (const s of [1, -1]) {
    k.block(0, s * 21, 1.6, 1.6, L3 - 0.4, WOOD_DARK);
    k.bridge(0, s * 21, 6, 6, L3, WOOD);
    k.block(0, s * 24.6, 1.2, 1.2, L3, WOOD_DARK);
    k.ladder(0, s * 25.2, L3, s > 0 ? FACE["+z"] : FACE["-z"]);
  }
  k.teleporterPair([-26, 0, -10], [0, L3, -20], "#7dff5a");
  // Jump pads up to the platforms without ramps, and one toward the middle.
  k.pad(12, -12, 16).pad(-12, 12, 16).pad(9.5, -9.5, 19);
  // Trees and bushes on the ground (cover), and lanterns.
  for (const [x, z, s] of [
    [-6, -24, 1],
    [6, 24, 1.1],
    [-26, 6, 0.9],
    [26, -6, 1],
    [-10, -6, 0.8],
    [10, 6, 0.8],
  ]) {
    k.tree(x, z, s);
  }
  for (const [sx, sz] of CORNERS) k.wall(sx * 26, sz * 26, 2, 2, 1.2, WOOD_DARK);
  k.pickup(12, -3).pickup(-12, 3).pickup(-26, 18);
  for (const [x, z] of [
    [-28, 0],
    [28, 0],
    [0, 28],
    [0, -28],
    [-14, -28],
    [14, 28],
    [28, -16],
    [-28, 16],
  ]) {
    k.spawn(x, z);
  }
  for (const [x, z] of [
    [-12, 0],
    [12, 0],
    [0, 8],
    [0, -8],
  ]) {
    k.props.push({ kind: "torch", pos: [x, 0, z], light: true });
  }
  return k.level("treetops", "The Treetops", "medium", "dusk", 46);
}

// ---------------- Small: The Quarry (48 x 48 m) ----------------

// A stone quarry: terraces along the walls (2 m, and 4 m in the corners)
// with ramps and ladders, a bottomless shaft in the middle, two crane towers
// with ladders, and teleporters between opposite corners.
function quarry(): Level {
  const k = new ArenaKit(24, SAND, STONE_DARK, 7);
  const T1 = 2;
  const T2 = 4;
  // The first terrace all around (6 m deep).
  k.block(0, -21, 48, 6, T1, STONE_LIGHT).block(0, 21, 48, 6, T1, STONE_LIGHT);
  k.block(-21, 0, 6, 36, T1, STONE_LIGHT).block(21, 0, 6, 36, T1, STONE_LIGHT);
  // The second, in the corners.
  for (const [sx, sz] of CORNERS) {
    k.block(sx * 20, sz * 20, 8, 8, T2, STONE);
    k.pickup(sx * 22, sz * 22, T2);
  }
  // Ramps: ground to terrace, terrace to corner.
  for (const s of [1, -1]) {
    k.rampZ(s * 14.6, s * 18, -6, 3, 0, T1, WOOD).rampX(s * 14.6, s * 18, 6, 3, 0, T1, WOOD);
    k.rampX(s * 10, s * 16, s * -21, 3, T1, T2, WOOD_DARK).rampZ(s * 10, s * 16, s * 21, 3, T1, T2, WOOD_DARK);
    k.ladder(6, s * 18, T1, s > 0 ? FACE["-z"] : FACE["+z"]);
    k.ladder(s * 18, -6, T1, s > 0 ? FACE["-x"] : FACE["+x"]);
    k.pad(s * 12, s * -12, 16);
  }
  // The shaft (bottomless), with a low rim.
  k.pit(0, 0, 6, 6, "void");
  k.wall(0, -3.4, 4, 0.4, 0.6, STONE_DARK).wall(0, 3.4, 4, 0.4, 0.6, STONE_DARK);
  // Crane towers, 7 m, with ladders (a perch, nothing to pick up).
  for (const s of [1, -1]) {
    k.block(s * 9, s * 9, 2.5, 2.5, 7, WOOD_DARK);
    k.ladder(s * 9 - s * 1.25, s * 9, 7, s > 0 ? FACE["-x"] : FACE["+x"]);
    k.slab(s * 9, s * 6, 0.6, 5, 6.6, 7, WOOD_DARK, true); // the crane's arm
  }
  k.teleporterPair([20, T2, 20], [-20, T2, -20], "#ffb347");
  k.teleporterPair([-20, T2, 20], [20, T2, -20]);
  // Crates for cover, and pickups on the floor and terraces.
  for (const [x, z] of [
    [-6, 9],
    [6, -9],
    [-11, -3],
    [11, 3],
  ]) {
    k.wall(x, z, 1.4, 1.4, 1.4, WOOD);
  }
  k.pickup(-8, 0).pickup(8, 0).pickup(0, -21, T1).pickup(0, 21, T1);
  for (const [x, z] of [
    [0, -9],
    [0, 9],
    [-9, 0],
    [9, 0],
    [-12, 12],
    [12, -12],
  ]) {
    k.spawn(x, z);
  }
  return k.level("quarry", "The Quarry", "small", "day", 30);
}

// ---------------- Large: The Cloud Citadel (96 x 96 m) ----------------

// Islands floating over nothing (fall and you're out): a citadel in the
// middle with a keep, side islands on narrow bridges, and big corner
// islands with towers (ladders and pads) and teleporters across.
function cloudCitadel(): Level {
  const k = new ArenaKit(48, CLOUD, STONE_DARK, 4);
  k.pit(0, 0, 96, 96, "void");
  const isle = (x: number, z: number, w: number, d: number) => k.slab(x, z, w, d, 0, 0.3, STONE_LIGHT);
  // The citadel: a 22 m island, a keep in the middle with ramps and ladders.
  isle(0, 0, 22, 22);
  k.block(0, 0, 6, 6, 5, STONE);
  k.rampX(11, 3, 0, 3, 0.3, 5, WOOD).rampX(-11, -3, 0, 3, 0.3, 5, WOOD);
  k.ladder(0, 3, 4.7, FACE["+z"], 0.3).ladder(0, -3, 4.7, FACE["-z"], 0.3);
  k.props.push({ kind: "crystal", pos: [0, 7, 0], color: "#8fe3ff", scale: 0.8 });
  k.pickup(1.5, 1.5, 5);
  for (const [sx, sz] of CORNERS) k.wall(sx * 7, sz * 7, 2, 2, 1.4, STONE, 0.3);
  // Side islands on narrow bridges.
  for (const s of [1, -1]) {
    isle(s * 30, 0, 8, 8);
    isle(0, s * 30, 8, 8);
    k.slab(s * 18.5, 0, 15, 2, 0, 0.3, STONE);
    k.slab(0, s * 18.5, 2, 15, 0, 0.3, STONE);
    k.pickup(s * 30, 0, 0.3).pickup(0, s * 30, 0.3);
  }
  // Corner islands: bridged to the side islands, each with a tower.
  for (const [sx, sz] of CORNERS) {
    const x = sx * 30;
    const z = sz * 30;
    isle(x, z, 14, 14);
    k.slab(x, sz * 13.5, 2, 19, 0, 0.3, STONE); // to the side island (x, 0)
    k.block(x + sx * 3, z + sz * 3, 4, 4, 6, STONE);
    k.ladder(x + sx * 3 - sx * 2, z + sz * 3, 5.7, sx > 0 ? FACE["-x"] : FACE["+x"], 0.3);
    k.pad(x - sx * 3, z + sz * 3, 17, 0.3);
    k.pickup(x, z - sz * 4, 0.3);
  }
  k.teleporterPair([26, 0.3, 26], [-26, 0.3, -26], "#ffb347");
  k.teleporterPair([-26, 0.3, 26], [26, 0.3, -26]);
  for (const [x, z] of [
    [30, 2],
    [-30, -2],
    [2, 30],
    [-2, -30],
    [26, 30],
    [-26, -30],
    [30, -26],
    [-30, 26],
  ]) {
    k.spawn(x, z, 0.3);
  }
  return k.level("citadel", "The Cloud Citadel", "large", "day", 62);
}

export const ARENAS3: Level[] = [spire(), magmaIslands(), treetops(), quarry(), cloudCitadel()];

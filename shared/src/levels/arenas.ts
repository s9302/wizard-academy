// The battle royale arenas, three of each size. Players vote between rounds
// (one of each size is offered). Every arena has high ground to climb to:
// ramps lead to everything you're meant to stand on, so the server-side
// bots can get there too (client/scripts/walk-arenas.ts checks that).
//
// Medium "The Ruins" lives in arena.ts (it came first).

import { arena as ruins } from "./arena.ts";
import { ArenaKit } from "./arenaKit.ts";
import { ARENAS2 } from "./arenas2.ts";
import { ARENAS3 } from "./arenas3.ts";
import { skyspires } from "./parkour.ts";
import type { Level } from "./types.ts";

const SAND = "#b9a27a";
const GRASS = "#6fae5c";
const FLAG = "#9c9384";
const STONE = "#8d8aa6";
const STONE_LIGHT = "#a5a2bb";
const STONE_DARK = "#6c6889";
const WOOD = "#a8744f";
const ROCK = "#a4573c";
const ROCK_DARK = "#7f4330";
const RED_SAND = "#c98f5f";
const ROOF = "#8a6f8f";
const WATER = "#4f8fbf";
const GOLD = "#e8c547";
const HEDGE = "#4f7d45";

// ---------------- Small (48 x 48 m) ----------------

// A sunken floor ringed by a raised rim, ramps down from each side, and a
// tower in the middle you can climb to shoot down into the pit.
function thePit(): Level {
  const k = new ArenaKit(24, SAND, STONE_DARK, 7);
  const RIM = 3;
  k.block(0, -19.5, 48, 9, RIM, STONE).block(0, 19.5, 48, 9, RIM, STONE);
  k.block(-19.5, 0, 9, 30, RIM, STONE).block(19.5, 0, 9, 30, RIM, STONE);
  k.rampZ(-15, -8, 8, 3, RIM, 0, WOOD).rampZ(15, 8, -8, 3, RIM, 0, WOOD);
  k.rampX(-15, -8, 8, 3, RIM, 0, WOOD).rampX(15, 8, -8, 3, RIM, 0, WOOD);
  // The central tower (4.5 m) and its ramp from the south.
  const T = 4.5;
  k.block(0, 0, 5, 5, T, STONE_LIGHT).rampZ(10, 2.5, 0, 3, 0, T, WOOD);
  k.wall(0, -2.3, 5, 0.4, 0.8, STONE_DARK, T).wall(-2.3, 0, 0.4, 5, 0.8, STONE_DARK, T).wall(2.3, 0, 0.4, 5, 0.8, STONE_DARK, T);
  // Cover in the pit, and crates on the rim.
  k.wall(-7, -4, 4, 0.6, 1.2, STONE).wall(7, 4, 4, 0.6, 1.2, STONE).wall(-4, 7, 0.6, 4, 1.2, STONE).wall(4, -7, 0.6, 4, 1.2, STONE);
  for (const [x, z] of [
    [-11, -11],
    [11, -11],
    [-11, 11],
    [11, 11],
  ]) {
    k.block(x, z, 1.5, 1.5, 3.5, STONE_DARK);
  }
  for (const [x, z] of [
    [-12, -20],
    [12, 20],
    [-20, 12],
    [20, -12],
  ]) {
    k.wall(x, z, 1.2, 1.2, 1.2, WOOD, RIM);
  }
  k.spawn(0, -20, RIM).spawn(18, -20, RIM).spawn(0, 20, RIM).spawn(-18, 20, RIM);
  k.spawn(-20, 0, RIM).spawn(20, 0, RIM).spawn(-20, -9, RIM).spawn(20, 9, RIM);
  k.pickup(0, 0, T).pickup(-6, 0).pickup(6, 0);
  k.pickup(-20, -20, RIM).pickup(20, 20, RIM).pickup(20, -20, RIM).pickup(-20, 20, RIM);
  return k.level("pit", "The Pit", "small", "dusk", 35);
}

// Two 6 m towers joined by a bridge, with low platforms and cover between.
function twinTowers(): Level {
  const k = new ArenaKit(24, GRASS, STONE_DARK, 6);
  const T = 6;
  k.block(-10, 0, 6, 6, T, STONE).block(10, 0, 6, 6, T, STONE);
  k.rampZ(13, 3, -10, 3, 0, T, WOOD).rampZ(-13, -3, 10, 3, 0, T, WOOD);
  k.bridge(0, 0, 14, 2.4, T, WOOD);
  k.wall(-12.8, 0, 0.4, 6, 0.8, STONE_DARK, T).wall(-10, -2.8, 6, 0.4, 0.8, STONE_DARK, T);
  k.wall(12.8, 0, 0.4, 6, 0.8, STONE_DARK, T).wall(10, 2.8, 6, 0.4, 0.8, STONE_DARK, T);
  // Low platforms (2 m) with a 1 m step up.
  for (const sz of [-1, 1]) k.block(0, sz * 15, 8, 4, 2, STONE_LIGHT).block(0, sz * 12.5, 4, 1, 1, STONE_LIGHT);
  for (const [x, z] of [
    [-13, -17],
    [13, -17],
    [-13, 17],
    [13, 17],
  ]) {
    k.wall(x, z, 5, 0.6, 2.2, STONE);
  }
  for (const [x, z] of [
    [-5, -9],
    [5, 9],
    [-18, 4],
    [18, -4],
  ]) {
    k.wall(x, z, 1.2, 1.2, 1.2, WOOD);
  }
  for (const [x, z] of [
    [-19, -19],
    [19, -19],
    [-19, 19],
    [19, 19],
  ]) {
    k.tree(x, z, 0.9);
  }
  k.spawnRing(8, 18, 0, 22.5);
  k.pickup(-10, 0, T).pickup(10, 0, T).pickup(-11.5, -1.5, T).pickup(0, -15, 2).pickup(0, 15, 2).pickup(6, 6).pickup(-6, -6);
  return k.level("twins", "Twin Towers", "small", "day", 35);
}

// A stepped pyramid (1 m steps you can hop, and ramps up two sides), with a
// watchtower in each corner.
function ziggurat(): Level {
  const k = new ArenaKit(24, FLAG, STONE_DARK, 6);
  [22, 17, 12, 7].forEach((w, i) => k.block(0, 0, w, w, i + 1, i % 2 ? STONE_LIGHT : STONE));
  k.rampZ(16, 3.5, 0, 3, 0, 4, WOOD).rampZ(-16, -3.5, 0, 3, 0, 4, WOOD);
  k.block(0, 0, 1.2, 1.2, 6.5, GOLD); // the obelisk on top
  for (const [sx, sz] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    k.block(sx * 18, sz * 18, 4, 4, 4, STONE_DARK).rampX(sx * 9, sx * 16, sz * 18, 3, 0, 4, WOOD);
    k.wall(sx * 19.8, sz * 18, 0.4, 4, 0.8, STONE, 4);
  }
  for (const [x, z, w, d] of [
    [-16, 0, 0.6, 5],
    [16, 0, 0.6, 5],
    [6, -18, 4, 0.6],
    [-6, 18, 4, 0.6],
  ]) {
    k.wall(x, z, w, d, 1.3, STONE);
  }
  k.spawnRing(8, 17, 0, 22.5);
  k.pickup(2.2, 0, 4).pickup(9.75, 9.75, 1).pickup(-9.75, -9.75, 1);
  for (const [sx, sz] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    k.pickup(sx * 18, sz * 18, 4);
  }
  return k.level("ziggurat", "The Ziggurat", "small", "day", 35);
}

// ---------------- Medium (84 x 84 m) ----------------

// Four 7 m towers in a square, joined by bridges, over a plaza and gardens.
function skyBridges(): Level {
  const k = new ArenaKit(42, GRASS, STONE_DARK, 7);
  const T = 7;
  for (const [sx, sz] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    k.block(sx * 16, sz * 16, 6, 6, T, STONE).rampX(sx * 31, sx * 19, sz * 16, 3, 0, T, WOOD);
  }
  for (const s of [-1, 1]) {
    k.bridge(0, s * 16, 26, 2.6, T, WOOD).bridge(s * 16, 0, 2.6, 26, T, WOOD);
  }
  // The plaza: a fountain and a statue.
  k.block(0, 0, 6, 6, 0.8, STONE_LIGHT).slab(0, 0, 5, 5, 0.75, 0.82, WATER).block(0, 0, 1.2, 1.2, 3, GOLD);
  for (const [x, z, w, d, h] of [
    [-28, 0, 0.8, 8, 2.4],
    [28, 0, 0.8, 8, 2.4],
    [0, -28, 8, 0.8, 2.4],
    [0, 28, 8, 0.8, 2.4],
    [-8, -8, 3, 0.6, 1.1],
    [8, 8, 3, 0.6, 1.1],
    [8, -8, 0.6, 3, 1.1],
    [-8, 8, 0.6, 3, 1.1],
  ]) {
    k.wall(x, z, w, d, h, STONE);
  }
  for (const [x, z] of [
    [-24, -26],
    [25, 24],
    [-26, 25],
    [24, -25],
    [-36, -8],
    [36, 9],
  ]) {
    k.block(x, z, 4, 1.4, 1.2, HEDGE);
  }
  for (const [x, z, s] of [
    [-34, -34, 1.1],
    [34, -34, 1],
    [-34, 34, 1],
    [34, 34, 1.2],
    [0, -37, 0.9],
    [0, 37, 0.9],
  ]) {
    k.tree(x, z, s);
  }
  k.spawnRing(10, 34, 0, 18);
  for (const [sx, sz] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    k.pickup(sx * 16, sz * 16, T).pickup(sx * 24, sz * 21);
  }
  k.pickup(0, 5).pickup(0, -5);
  return k.level("skybridges", "Sky Bridges", "medium", "day", 50);
}

// Two high plateaus with a canyon between: ramps down into it, bridges
// across it, and a mesa in the middle.
function canyon(): Level {
  const k = new ArenaKit(42, RED_SAND, ROCK_DARK, 8);
  const P = 5;
  k.block(0, -28, 84, 28, P, ROCK).block(0, 28, 84, 28, P, ROCK);
  for (const x of [-28, 4, 30]) k.rampZ(-14, -4, x, 4, P, 0, ROCK_DARK);
  for (const x of [-14, 18]) k.rampZ(14, 4, x, 4, P, 0, ROCK_DARK);
  k.bridge(-36, 0, 3, 28, P, WOOD).bridge(12, 0, 3, 28, P, WOOD);
  // The mesa (3 m) and its ramp.
  k.block(-20, 0, 6, 6, 3, ROCK).rampX(-11, -17, 0, 3, 0, 3, ROCK_DARK);
  // Boulders in the canyon; rocks and ruins on the plateaus.
  for (const [x, z, w, d, h] of [
    [8, 6, 3, 2.5, 2.2],
    [30, 5, 3, 3, 2.5],
    [-34, 4, 2.5, 3, 2],
    [24, -7, 2, 2, 1.4],
    [-4, 8, 2.5, 2, 1.6],
  ]) {
    k.block(x, z, w, d, h, ROCK_DARK);
  }
  for (const [x, z, w, d, h] of [
    [-20, -24, 6, 0.8, 2.2],
    [24, -30, 0.8, 6, 2.2],
    [-8, 26, 6, 0.8, 2.2],
    [26, 30, 0.8, 6, 2.2],
    [-30, 32, 3, 3, 3],
    [36, -24, 3, 3, 3],
  ]) {
    k.wall(x, z, w, d, h, ROCK_DARK, P);
  }
  for (const x of [-32, -16, 0, 16, 32]) k.spawn(x, -30, P).spawn(x + 6, 30, P);
  k.pickup(0, 0).pickup(-20, 0, 3).pickup(28, 0).pickup(-20, -22, P).pickup(20, -22, P).pickup(-20, 22, P).pickup(20, 22, P).pickup(0, -36, P).pickup(0, 36, P);
  return k.level("canyon", "The Canyon", "medium", "dusk", 50);
}

// ---------------- Large (120 x 120 m) ----------------

// Mesas of different heights, each with a ramp, over open grassland: long
// sightlines for archers, and plenty of high ground to fight over.
function highlands(): Level {
  const k = new ArenaKit(60, GRASS, STONE_DARK, 7);
  const ROCKY = "#8f8a7a";
  k.block(-30, -30, 12, 10, 6, ROCKY).rampX(-12, -24, -30, 3, 0, 6, WOOD);
  k.block(30, -28, 10, 12, 4, ROCKY).rampZ(-12, -22, 30, 3, 0, 4, WOOD);
  k.block(-28, 30, 10, 10, 3, ROCKY).rampX(-13, -23, 30, 3, 0, 3, WOOD);
  k.block(28, 28, 10, 10, 8, ROCKY).rampZ(10, 23, 28, 3, 0, 8, WOOD);
  k.block(0, 0, 14, 14, 2.5, ROCKY).rampX(13, 7, 0, 3, 0, 2.5, WOOD).rampX(-13, -7, 0, 3, 0, 2.5, WOOD);
  // The tower on top of it. Its ramp carries straight on from the mesa's
  // east ramp, so it's one climb from the ground to the top.
  k.block(0, 0, 4, 4, 5.5, STONE).rampX(7, 2, 0, 2.5, 2.5, 5.5, WOOD);
  k.block(-45, 0, 8, 16, 3.5, ROCKY).rampX(-31, -41, 0, 3, 0, 3.5, WOOD);
  k.block(45, -2, 8, 14, 5, ROCKY).rampX(31, 41, -2, 3, 0, 5, WOOD);
  k.block(0, -45, 16, 8, 4, ROCKY).rampZ(-31, -41, 0, 3, 0, 4, WOOD);
  k.block(2, 46, 14, 8, 6, ROCKY).rampZ(30, 42, 2, 3, 0, 6, WOOD);
  for (const [x, z, s] of [
    [-15, -12, 1],
    [14, -14, 1.1],
    [-12, 15, 0.9],
    [16, 13, 1],
    [-40, -18, 1.2],
    [40, 18, 1],
    [-18, -42, 1],
    [20, 40, 1.1],
    [-50, 30, 1],
    [50, -30, 0.9],
    [-20, 48, 1],
    [26, -50, 1],
  ]) {
    k.tree(x, z, s);
  }
  for (const [x, z, w, d] of [
    [-22, 0, 0.8, 6],
    [22, 6, 0.8, 6],
    [8, -24, 6, 0.8],
    [-6, 24, 6, 0.8],
  ]) {
    k.wall(x, z, w, d, 1.3, FLAG);
  }
  k.spawnRing(10, 52, 0, 9);
  k.pickup(-30, -30, 6).pickup(30, -28, 4).pickup(-28, 30, 3).pickup(28, 28, 8).pickup(0, 0, 5.5).pickup(5, 4, 2.5);
  k.pickup(-45, 0, 3.5).pickup(45, -2, 5).pickup(0, -45, 4).pickup(2, 46, 6).pickup(-20, 0).pickup(20, -6);
  return k.level("highlands", "The Highlands", "large", "day", 72);
}

// A walled castle: walk the battlements (ramps up from the courtyard, and up
// and over the corner towers), hold the keep, or fight in the fields outside.
function fortress(): Level {
  const k = new ArenaKit(60, "#5f8f4f", STONE_DARK, 7);
  const W = 5; // wall top
  const TT = 8; // tower top
  for (const s of [-1, 1]) {
    // North/south walls with a 6 m gate, a walkway over it; east/west walls.
    k.block(-12, s * 20, 18, 2, W, STONE).block(12, s * 20, 18, 2, W, STONE).bridge(0, s * 20, 6, 2, W, STONE_DARK);
    k.block(s * 20, 0, 2, 34, W, STONE);
  }
  for (const [sx, sz] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    k.block(sx * 20, sz * 20, 6, 6, TT, STONE_LIGHT);
    // Up from each wall onto the tower.
    k.rampZ(sz * 11, sz * 17, sx * 20, 2, W, TT, WOOD);
    k.rampX(sx * 11, sx * 17, sz * 20, 2, W, TT, WOOD);
    k.wall(sx * 22.8, sz * 20, 0.4, 6, 0.9, STONE_DARK, TT).wall(sx * 20, sz * 22.8, 6, 0.4, 0.9, STONE_DARK, TT);
  }
  // Ramps from the courtyard up onto the east and west walls.
  k.rampZ(12, 0, -17.5, 3, 0, W, WOOD).rampZ(-12, 0, 17.5, 3, 0, W, WOOD);
  // The keep (6 m) and its ramp.
  k.block(0, 0, 10, 10, 6, STONE_LIGHT).rampX(14, 5, 0, 3, 0, 6, WOOD);
  k.wall(-4.8, 0, 0.4, 10, 0.9, STONE_DARK, 6).wall(0, -4.8, 10, 0.4, 0.9, STONE_DARK, 6);
  for (const [x, z] of [
    [-10, -12],
    [-11, 12],
    [11, -12],
    [9, 13],
  ]) {
    k.wall(x, z, 1.2, 1.2, 1.2, WOOD);
  }
  // Outside: hills with ramps, trees, low walls.
  k.block(-40, -38, 10, 8, 3, "#7c9a5a").rampX(-29, -35, -38, 3, 0, 3, WOOD);
  k.block(40, 38, 10, 8, 3, "#7c9a5a").rampX(29, 35, 38, 3, 0, 3, WOOD);
  k.block(42, -36, 8, 8, 2, "#7c9a5a").block(42, -31.5, 4, 1, 1, "#7c9a5a");
  k.block(-42, 36, 8, 8, 2, "#7c9a5a").block(-42, 31.5, 4, 1, 1, "#7c9a5a");
  for (const [x, z, s] of [
    [-34, 0, 1.1],
    [34, 0, 1.1],
    [0, -36, 1],
    [0, 36, 1],
    [-50, -50, 1.2],
    [50, 50, 1.2],
    [-50, 50, 1],
    [50, -50, 1],
    [-28, 28, 0.9],
    [28, -28, 0.9],
  ]) {
    k.tree(x, z, s);
  }
  for (const [x, z, w, d] of [
    [-30, -14, 0.8, 7],
    [30, 14, 0.8, 7],
    [14, -32, 7, 0.8],
    [-14, 32, 7, 0.8],
  ]) {
    k.wall(x, z, w, d, 1.3, FLAG);
  }
  k.spawnRing(10, 45, 0, 18);
  k.pickup(10, 10).pickup(-10, -10).pickup(0, 0, 6).pickup(-40, -38, 3).pickup(40, 38, 3).pickup(42, -36, 2).pickup(-42, 36, 2);
  for (const [sx, sz] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    k.pickup(sx * 20, sz * 20, TT);
  }
  return k.level("fortress", "The Fortress", "large", "dusk", 72);
}

// A city of rooftops on a checkerboard of plazas: ramps up the buildings, a
// ring of bridges at 6 m, and the tallest tower (8 m) in the middle.
function rooftops(): Level {
  const k = new ArenaKit(60, FLAG, STONE_DARK, 7);
  const H = [
    [3, 0, 5, 0, 4],
    [0, 6, 0, 7, 0],
    [5, 0, 8, 0, 5],
    [0, 7, 0, 6, 0],
    [4, 0, 5, 0, 3],
  ];
  const colors = [STONE, ROOF, STONE_LIGHT, "#9a7b6a"];
  H.forEach((row, i) =>
    row.forEach((t, j) => {
      if (!t) return;
      const [x, z] = [-40 + 20 * j, -40 + 20 * i];
      k.block(x, z, 12, 12, t, colors[(i + j) % colors.length]);
      // A ramp up the west side (about 30 degrees), off-center so it misses
      // the bridges, which meet the buildings' middles.
      k.rampX(x - 6 - t * 1.75, x - 6, z + 4, 3, 0, t, WOOD);
      k.pickup(x + 2, z + 2, t);
      k.wall(x + 4, z - 5.8, 4, 0.4, 0.9, STONE_DARK, t); // a bit of parapet, clear of the bridges
    }),
  );
  // The bridge ring at 6 m (a 1 m hop up onto the 7 m roofs).
  k.bridge(0, -20, 28, 2.4, 6, WOOD).bridge(0, 20, 28, 2.4, 6, WOOD);
  k.bridge(-20, 0, 2.4, 28, 6, WOOD).bridge(20, 0, 2.4, 28, 6, WOOD);
  // Market stalls and crates in the plazas.
  for (const [x, z] of [
    [-20, -40],
    [20, 40],
    [-40, 20],
    [40, -20],
    [0, -20],
    [0, 20],
  ]) {
    k.wall(x + 3, z - 3, 1.2, 1.2, 1.2, WOOD).wall(x - 3, z + 3, 3, 0.6, 1.1, STONE);
  }
  for (const [x, z] of [
    [-20, -40],
    [20, -40],
    [-40, -20],
    [40, -20],
    [-40, 20],
    [40, 20],
    [-20, 40],
    [20, 40],
  ]) {
    k.spawn(x, z);
  }
  k.pickup(-20, 0).pickup(20, 0).pickup(0, -24).pickup(0, 24);
  return k.level("rooftops", "The Rooftops", "large", "day", 72);
}

export const ARENAS: Level[] = [thePit(), twinTowers(), ziggurat(), ruins, skyBridges(), canyon(), highlands(), fortress(), rooftops(), ...ARENAS2, ...ARENAS3, skyspires];

export function arenasOfSize(size: "small" | "medium" | "large"): Level[] {
  return ARENAS.filter((a) => a.arena?.size === size);
}

// Two arenas built around Phase 16's features: lava and void pits, ladders,
// jump pads and teleporters. Like the others, everything bots must reach
// has a ramp; ladders and jump pads are shortcuts to high ground that only
// players take (no pickups are put where only they lead).

import { ArenaKit } from "./arenaKit.ts";
import type { Level } from "./types.ts";

const STONE = "#8d8aa6";
const STONE_LIGHT = "#a5a2bb";
const STONE_DARK = "#6c6889";
const DARK = "#57536f";
const WOOD = "#a8744f";
const GRASS = "#6fae5c";
const GOLD = "#e8c547";
const EMBER = "#ff7a2e";

// ---------------- Medium: The Ember Forge (64 x 64 m) ----------------

// A dwarf-forge at night: two lava channels split the floor into three
// bands, crossed by low bridges. A raised forge in the middle, four watch
// towers in the corners (ladders and jump pads up), and two pairs of
// teleporters: west <-> east and north <-> south.
function emberForge(): Level {
  const k = new ArenaKit(32, STONE_DARK, DARK, 7);
  // The forge: a 2 m platform with ramps north and south, and its fire.
  k.block(0, 0, 10, 10, 2, STONE).rampZ(11, 5, 0, 3, 0, 2, WOOD).rampZ(-11, -5, 0, 3, 0, 2, WOOD);
  k.boxes.push({ pos: [0, 2.35, 0], size: [2.2, 0.7, 2.2], color: EMBER, glow: 3 });
  k.wall(-4.6, 0, 0.4, 6, 0.8, STONE_DARK, 2).wall(4.6, 0, 0.4, 6, 0.8, STONE_DARK, 2);
  // Lava channels, and the bridges over them (0.3 m: you can step up).
  for (const z of [-16, 16]) {
    k.pit(0, z, 44, 3.2, "lava");
    for (const x of [-14, 0, 14]) k.slab(x, z, 3.2, 4.4, 0, 0.3, STONE_LIGHT);
  }
  // Watch towers: 6 m, with a ladder on the side facing the middle and a
  // jump pad beside the other inner face.
  const T = 6;
  for (const [x, z] of [
    [-25, -25],
    [25, -25],
    [-25, 25],
    [25, 25],
  ]) {
    k.block(x, z, 5, 5, T, STONE);
    for (const [wx, wz, w, d] of [
      [0, -2.3, 5, 0.4],
      [0, 2.3, 5, 0.4],
      [-2.3, 0, 0.4, 5],
      [2.3, 0, 0.4, 5],
    ]) {
      k.wall(x + wx, z + wz, w, d, 0.8, STONE_DARK, T);
    }
    const sz = -Math.sign(z); // toward the middle along z
    const sx = -Math.sign(x);
    // Ladder on the face toward the middle (z side): facing the wall.
    k.ladder(x, z + sz * 2.5, T, sz > 0 ? 0 : Math.PI);
    // Jump pad 2.4 m out from the x-side face.
    k.pad(x + sx * 4.9, z, 16);
    k.props.push({ kind: "torch", pos: [x + sx * 3, 0, z + sz * 3], light: true });
  }
  // Teleporters: west <-> east (blue), north <-> south (orange).
  k.teleporterPair([-28, 0, 0], [28, 0, 0]);
  k.teleporterPair([0, 0, -28], [0, 0, 28], "#ffb347");
  // Cover: anvils and crates in each band.
  for (const [x, z] of [
    [-10, -6],
    [10, 6],
    [-18, 4],
    [18, -4],
    [-8, -24],
    [8, 24],
    [-18, -22],
    [18, 22],
  ]) {
    k.wall(x, z, 2.4, 1.2, 1.2, STONE_DARK);
  }
  for (const [x, z] of [
    [-12, 24],
    [12, -24],
    [22, 8],
    [-22, -8],
  ]) {
    k.wall(x, z, 1.2, 1.2, 1.2, WOOD);
  }
  // Spawns clear of the lava (the channels run z 14.4..17.6 for |x| < 22).
  for (const [x, z] of [
    [0, -24],
    [0, 24],
    [-24, 0],
    [24, 0],
    [-14, -24],
    [14, 24],
    [-24, -10],
    [24, 10],
  ]) {
    k.spawn(x, z);
  }
  k.pickup(0, -3.6, 2).pickup(-14, -6).pickup(14, 6).pickup(-6, -24).pickup(6, 24).pickup(-28, 10).pickup(28, -10);
  for (const [x, z] of [
    [-6, -9],
    [6, 9],
  ]) {
    k.props.push({ kind: "torch", pos: [x, 0, z], light: true });
  }
  return k.level("forge", "The Ember Forge", "medium", "night", 46);
}

// ---------------- Large: The Sky Temple (96 x 96 m) ----------------

// A temple on an island in a moat of void, under a golden sky. Four bridges
// cross the moat; ramps climb the temple. Out in the gardens, four pavilions
// with ladders and jump pads; two pavilions have teleporters to the temple
// roof.
function skyTemple(): Level {
  const k = new ArenaKit(48, GRASS, STONE_DARK, 6);
  // The void moat: a square ring between 12 and 20 m from the middle.
  k.pit(0, -16, 40, 8, "void").pit(0, 16, 40, 8, "void");
  k.pit(-16, 0, 8, 24, "void").pit(16, 0, 8, 24, "void");
  // Bridges over it (stone, 0.3 m), one per side.
  k.slab(0, -16, 4, 9, 0, 0.3, STONE_LIGHT).slab(0, 16, 4, 9, 0, 0.3, STONE_LIGHT);
  k.slab(-16, 0, 9, 4, 0, 0.3, STONE_LIGHT).slab(16, 0, 9, 4, 0, 0.3, STONE_LIGHT);
  // The temple: 12 x 12, 4 m, ramps up from each bridge's end.
  const T = 4;
  k.block(0, 0, 12, 12, T, STONE_LIGHT);
  k.rampZ(-12, -6, 0, 3, 0, T, WOOD).rampZ(12, 6, 0, 3, 0, T, WOOD);
  k.rampX(-12, -6, 0, 3, 0, T, WOOD).rampX(12, 6, 0, 3, 0, T, WOOD);
  // The shrine on top: four pillars, a roof you can walk under, a crystal.
  for (const [x, z] of [
    [-4, -4],
    [4, -4],
    [-4, 4],
    [4, 4],
  ]) {
    k.slab(x, z, 0.9, 0.9, T, T + 3.5, STONE);
  }
  k.slab(0, 0, 10, 10, T + 3.5, T + 4.1, STONE_DARK, true);
  k.props.push({ kind: "crystal", pos: [0, T + 2, 0], color: GOLD, scale: 0.8 });
  // Ladders up the temple's corners (a quicker way up than the ramps).
  k.ladder(-4, 6, T, 0).ladder(4, -6, T, Math.PI);
  // Pavilions: 5 m platforms in the gardens, a ramp each.
  const P = 5;
  for (const [x, z] of [
    [-32, -32],
    [32, -32],
    [-32, 32],
    [32, 32],
  ]) {
    k.block(x, z, 8, 8, P, STONE);
    const sx = -Math.sign(x);
    const sz = -Math.sign(z);
    // Ramp along x toward the middle, off-center.
    k.rampX(x + sx * (4 + P * 1.6), x + sx * 4, z + sz * 1, 3, 0, P, WOOD);
    k.ladder(x - sx * 1.5, z + sz * 4, P, sz > 0 ? 0 : Math.PI);
    k.pad(x - sx * 2, z + sz * 6.6, 17);
    k.pickup(x - sx * 1.5, z - sz * 1.5, P);
    k.props.push({ kind: "cone", pos: [x, P + 3.2, z], size: [5.2, 4], color: "#3b2a6b" });
    for (const [px, pz] of [
      [-3.4, -3.4],
      [3.4, -3.4],
      [-3.4, 3.4],
      [3.4, 3.4],
    ]) {
      k.slab(x + px, z + pz, 0.6, 0.6, P, P + 3.2, STONE_DARK);
    }
  }
  // Teleporters from two pavilion roofs to the temple roof.
  k.teleporterPair([-34, P, -34], [-2.2, T, 1.5], "#c58fff");
  k.teleporterPair([34, P, 34], [2.2, T, -1.5], "#c58fff");
  // Gardens: trees (solid) and hedges for cover.
  for (const [x, z, s] of [
    [-38, 0, 1.1],
    [38, 0, 1],
    [0, -38, 1.2],
    [0, 38, 1],
    [-26, -12, 0.9],
    [26, 12, 0.9],
    [-12, 28, 1],
    [12, -28, 1],
  ]) {
    k.tree(x, z, s);
  }
  for (const [x, z, w, d] of [
    [-24, 4, 0.8, 6],
    [24, -4, 0.8, 6],
    [4, 26, 6, 0.8],
    [-4, -26, 6, 0.8],
  ]) {
    k.wall(x, z, w, d, 1.3, "#4f7d45");
  }
  for (const [x, z] of [
    [0, -30],
    [0, 30],
    [-30, 0],
    [30, 0],
    [-22, -22],
    [22, 22],
    [-22, 22],
    [22, -22],
  ]) {
    k.spawn(x, z);
  }
  k.pickup(-2, 3, T).pickup(2, -3, T).pickup(-8, -9).pickup(8, 9).pickup(-36, 14).pickup(36, -14).pickup(14, 36).pickup(-14, -36);
  return k.level("temple", "The Sky Temple", "large", "golden", 72);
}

export const ARENAS2: Level[] = [emberForge(), skyTemple()];

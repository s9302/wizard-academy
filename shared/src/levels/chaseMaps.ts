// Maps for tag and infection, built with the arenas' kit: several levels to
// run up and over (ramps everywhere a bot needs to go; ladders, jump pads and
// teleporters as players' shortcuts), and pits to keep out of (fall in and
// you're back at a spawn point).

import { ArenaKit } from "./arenaKit.ts";
import type { Level } from "./types.ts";

const GRASS = "#6fae5c";
const HEDGE = "#4f7d45";
const STONE = "#8d8aa6";
const STONE_LIGHT = "#a5a2bb";
const STONE_DARK = "#57536f";
const WOOD = "#7a5236";
const PLANK = "#a8744f";
const ROOF = "#8a6f8f";
const GOLD = "#e8c547";

// ---------------- Tag: The Clocktower Gardens (68 x 68 m) ----------------

// A garden around a tall clocktower. A raised terrace (3 m) rings the tower,
// with a ramp at its north and south ends and two high ledges (6 m) up a
// ladder or a jump pad. Four cottages in the corners have ramps and ladders
// to their roofs; two long rooftop bridges link them, each broken in the
// middle over a void (jump the gap or fall back to a spawn point). Lava
// fountain pools, hedges, trees, and two teleporter pairs for escapes.
function clocktowerGardens(): Level {
  const k = new ArenaKit(34, GRASS, STONE_DARK, 6);
  const T = 3; // the terrace
  const L = 6; // the ledges

  // The clocktower and its crown.
  k.block(0, 0, 6, 6, 13, STONE_LIGHT);
  k.slab(0, 0, 7, 7, 13, 13.6, STONE_DARK);
  k.props.push({ kind: "crystal", pos: [0, 15, 0], color: GOLD, scale: 1.2 });

  // The terrace ring around it: north and south long sides, east and west short.
  k.block(0, -7, 18, 4, T, STONE).block(0, 7, 18, 4, T, STONE);
  k.block(-7, 0, 4, 10, T, STONE).block(7, 0, 4, 10, T, STONE);
  k.rampZ(9 + T * 1.7, 9, 0, 3.5, 0, T, PLANK).rampZ(-9 - T * 1.7, -9, 0, 3.5, 0, T, PLANK);
  // Low parapets along the outside (hop over them, or use the ramps).
  k.wall(-6.5, -8.8, 5, 0.4, 0.8, STONE_DARK, T).wall(6.5, 8.8, 5, 0.4, 0.8, STONE_DARK, T);

  // The two high ledges, on the east and west sides of the tower.
  for (const s of [-1, 1]) {
    k.slab(s * 7.5, 0, 3, 5, T, L, STONE_LIGHT);
    k.ladder(s * 7.5, 2.5, L - T, 0, T); // up the south face, from the terrace
    k.pad(s * 7, -3.6, 15, T); // or a jump pad on the terrace beside it
  }

  // The corner cottages: 8 x 8, 3 m, a ramp toward the middle, a ladder at the back.
  const C = 3;
  for (const [x, z] of [
    [-24, -24],
    [24, -24],
    [-24, 24],
    [24, 24],
  ]) {
    k.block(x, z, 8, 8, C, PLANK);
    k.props.push({ kind: "cone", pos: [x, C + 2.4, z], size: [5.6, 3], color: ROOF });
    const sx = -Math.sign(x);
    const sz = -Math.sign(z);
    k.rampX(x + sx * (4 + C * 1.7), x + sx * 4, z + sz * 2, 3, 0, C, WOOD);
    k.ladder(x - sx * 1.5, z - sz * 4, C, sz > 0 ? Math.PI : 0);
  }

  // Rooftop bridges between the cottages (north and south), each with a gap
  // over a void pit in the middle.
  for (const z of [-24, 24]) {
    // From each roof's edge (x 20) to 1.3 m short of the middle: a 2.6 m gap.
    k.bridge(-10.65, z, 18.7, 2.5, C, WOOD).bridge(10.65, z, 18.7, 2.5, C, WOOD);
    k.pit(0, z, 7, 5, "void");
  }

  // Lava fountain pools in two garden quadrants, with a stone rim.
  for (const [x, z] of [
    [-15, 13],
    [15, -13],
  ]) {
    k.pit(x, z, 4, 4, "lava");
    k.wall(x, z - 2.6, 5.2, 0.4, 0.5, STONE_DARK).wall(x, z + 2.6, 5.2, 0.4, 0.5, STONE_DARK);
  }

  // Hedges (1.6 m: they block the view, not the way around), trees.
  for (const [x, z, w, d] of [
    [-16, -4, 0.8, 9],
    [16, 4, 0.8, 9],
    [-4, 18, 9, 0.8],
    [4, -18, 9, 0.8],
    [-26, 6, 6, 0.8],
    [26, -6, 6, 0.8],
    [-8, 28, 0.8, 5],
    [8, -28, 0.8, 5],
  ]) {
    k.wall(x, z, w, d, 1.6, HEDGE);
  }
  for (const [x, z, s] of [
    [-30, -12, 1],
    [30, 12, 1.1],
    [-12, -30, 0.9],
    [12, 30, 1],
    [-20, 4, 0.8],
    [20, -4, 0.8],
  ]) {
    k.tree(x, z, s);
  }

  // Teleporters: corner to corner across the garden, and from the south lawn
  // up onto the west ledge.
  k.teleporterPair([-30, 0, 16], [30, 0, -16], "#5ac8ff");
  k.teleporterPair([0, 0, 29], [-7.5, L, -1.2], "#c58fff");

  for (const [x, z] of [
    [-10, 10],
    [12, -10],
    [-12, -14],
    [12, 14],
    [-28, 0],
    [28, 0],
    [0, -28],
    [0, 20],
  ]) {
    k.spawn(x, z);
  }
  for (const [x, z] of [
    [-6, 10],
    [6, -10],
  ]) {
    k.props.push({ kind: "torch", pos: [x, T, z], light: true });
  }
  const level = k.level("clocktower", "The Clocktower Gardens", "large", "golden", 48);
  return { ...level, spawnYaw: Math.PI };
}

// ---------------- Infection: The Moonlit Graveyard (64 x 64 m) ----------------

// A graveyard at night. In the middle, a ruined chapel on a raised nave
// (2.5 m, ramps at both ends) with a walkway along its roof (5.5 m, a ramp up
// from the nave) and a bell tower with a ladder. Two mausoleums with
// ladders, linked by a teleporter. Rows of tombstones over open graves (void
// pits), iron fences, and torches.
function moonlitGraveyard(): Level {
  const k = new ArenaKit(32, "#4f7a46", STONE_DARK, 5);
  const N = 2.5; // the nave
  const R = 5.5; // the roof walkway

  // The chapel nave: a raised floor with broken walls along its sides.
  k.block(0, 0, 16, 8, N, STONE);
  k.rampX(-8 - N * 1.7, -8, 0, 3.5, 0, N, WOOD).rampX(8 + N * 1.7, 8, 0, 3.5, 0, N, WOOD);
  for (const [x, w] of [
    [-5, 3],
    [1, 2],
    [5.5, 3],
  ]) {
    k.wall(x, -3.8, w, 0.5, 2.2, STONE_DARK, N).wall(x + 1, 3.8, w, 0.5, 1.6, STONE_DARK, N);
  }
  // The roof walkway, and a ramp up to it from the nave.
  k.rampX(-7, -1.9, 0, 2.5, N, R, PLANK);
  k.bridge(3, 0, 9.8, 2.5, R, WOOD);
  for (const x of [-1, 7]) k.slab(x, 0, 0.6, 0.6, N, R - 0.4, WOOD); // posts under it

  // The bell tower against the chapel's north side, and its bell.
  k.block(0, -6, 4, 4, 9, STONE_LIGHT);
  k.ladder(0, -8, 9, Math.PI);
  k.props.push({ kind: "crystal", pos: [0, 10, -6], color: "#c58fff", scale: 0.8 });

  // Mausoleums, 3 m, with a ladder each and a teleporter between their doors.
  for (const x of [-21, 21]) {
    k.block(x, -18, 7, 6, 3, STONE_LIGHT);
    k.slab(x, -18, 7.6, 6.6, 3, 3.4, STONE_DARK);
    k.ladder(x, -21, 3, Math.PI);
  }
  k.teleporterPair([-21, 0, -14], [21, 0, -14], "#c58fff");

  // Open graves in rows (void pits), each with a tombstone at its head.
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5; col++) {
      const x = -16 + col * 8 + (row % 2) * 4;
      const z = 13 + row * 6;
      k.pit(x, z, 1.6, 2.4, "void");
      k.block(x, z - 1.8, 1.4, 0.4, 1.3, STONE_LIGHT);
    }
  }

  // Iron fences (low: hop over) and hedges, a few dead trees.
  const IRON = "#2e2a36";
  for (const [x, z, w, d] of [
    [-24, 8, 14, 0.3],
    [24, 8, 14, 0.3],
    [-12, -10, 0.3, 8],
    [12, -10, 0.3, 8],
  ]) {
    k.wall(x, z, w, d, 1.1, IRON);
  }
  k.wall(0, -26, 12, 0.8, 1.6, HEDGE).wall(-27, -4, 0.8, 8, 1.6, HEDGE).wall(27, 4, 0.8, 8, 1.6, HEDGE);
  for (const [x, z, s] of [
    [-28, -28, 1],
    [28, -26, 0.9],
    [-28, 26, 1.1],
    [28, 28, 1],
    [0, -14, 0.8],
  ]) {
    k.tree(x, z, s);
  }

  // Jump pads by the nave's long sides, for a quick way up.
  k.pad(-5, -6, 13).pad(5, 6, 13);

  // Torches all around (it's dark).
  for (const [x, z, y] of [
    [-9, -5, 0],
    [9, 5, 0],
    [-24.5, -14.5, 0],
    [24.5, -14.5, 0],
    [-26, 18, 0],
    [26, 18, 0],
    [0, 0, R],
    [-6, 0, N],
  ]) {
    k.props.push({ kind: "torch", pos: [x, y, z], light: true });
  }

  for (const [x, z] of [
    [-26, -8],
    [26, -8],
    [-26, 0],
    [26, 0],
    [0, -22],
    [-14, -24],
    [14, -24],
    [0, 9],
  ]) {
    k.spawn(x, z);
  }
  return k.level("graveyard", "The Moonlit Graveyard", "large", "night", 46);
}

export const clocktower = clocktowerGardens();
export const graveyard = moonlitGraveyard();

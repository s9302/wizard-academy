// Capture the flag: Twin Keeps (72 x 72 m). Red's keep is at the north end,
// Blue's at the south: each a raised platform (3 m) with the flag stand in
// the middle, ramps down both front corners, parapets, a ladder up the side
// and a jump pad in front. Between them: a central bridge over a lava
// channel (or cross on the stepping stones), broken walls and pillars for
// cover, side lanes with crates, and a teleporter from each keep's back
// corner to the far side of the middle.

import { ArenaKit } from "./arenaKit.ts";
import type { Vec3 } from "../protocol.ts";
import type { Level } from "./types.ts";

const GRASS = "#6f8f4f";
const STONE = "#8d8aa6";
const STONE_LIGHT = "#a5a2bb";
const STONE_DARK = "#57536f";
const WOOD = "#7a5236";
const PLANK = "#a8744f";
const RED = "#b8505a";
const BLUE = "#4f6fb8";

function twinKeeps(): Level {
  const k = new ArenaKit(36, GRASS, STONE_DARK, 6);
  const K = 3; // keep platforms
  const flags: [Vec3, Vec3] = [
    [0, K, -29],
    [0, K, 29],
  ];
  const spawns: [Vec3[], Vec3[]] = [[], []];
  for (const [team, s] of [
    [0, -1],
    [1, 1],
  ] as const) {
    const z = s * 28;
    // The keep: a platform with colored trim, parapets, a back wall.
    k.block(0, z, 18, 10, K, STONE);
    k.slab(0, z - s * 5.2, 18, 0.4, K, K + 0.25, team === 0 ? RED : BLUE);
    k.wall(-7.5, z - s * 4.8, 3, 0.4, 1, STONE_DARK, K).wall(7.5, z - s * 4.8, 3, 0.4, 1, STONE_DARK, K);
    k.wall(0, z + s * 4.8, 18, 0.5, 3, STONE_DARK, K);
    // Ramps down both front corners (toward the middle), a ladder up the west
    // side (the back is walled off at the top).
    k.rampZ(z - s * (5 + K * 1.7), z - s * 5, -11, 3, 0, K, PLANK).rampZ(z - s * (5 + K * 1.7), z - s * 5, 11, 3, 0, K, PLANK);
    k.ladder(-9, z + s * 1, K, -Math.PI / 2);
    // The flag stand, and towers at the keep's corners.
    k.block(0, z - s * 1, 1.6, 1.6, K + 0.3, team === 0 ? RED : BLUE);
    for (const x of [-8.5, 8.5]) k.block(x, z + s * 3.5, 2, 2, K + 3, STONE_LIGHT);
    k.pad(0, z - s * 8, 13); // a jump pad up onto the keep
    // Spawns behind the keep (on the ground) and on it.
    for (const x of [-14, -6, 6, 14]) spawns[team].push([x, 1, z + s * 6.5]);
    for (const x of [-4, 4]) spawns[team].push([x, K + 1, z + s * 2]);
    for (const p of spawns[team]) k.spawn(p[0], p[2], p[1] - 1);
  }
  flags[0] = [0, K + 0.3, -27];
  flags[1] = [0, K + 0.3, 27];

  // The middle: a lava channel across the map, a bridge over it, and
  // stepping stones at the sides.
  k.pit(0, 0, 72, 3, "lava");
  k.slab(0, 0, 6, 4.5, 0, 0.6, STONE_LIGHT);
  for (const x of [-22, -16, 16, 22]) k.slab(x, 0, 1.6, 1.6, 0, 0.5, STONE);
  // A raised walkway over the bridge (3 m), up ramps from both sides.
  k.bridge(0, 0, 4, 8, 3, WOOD);
  k.rampZ(-4 - 3 * 1.7, -4, 0, 3, 0, 3, PLANK).rampZ(4 + 3 * 1.7, 4, 0, 3, 0, 3, PLANK);

  // Cover: broken walls, pillars, crates in the side lanes.
  for (const s of [-1, 1]) {
    for (const [x, z, w, d, h] of [
      [-8, 9, 5, 0.6, 1.6],
      [8, 13, 5, 0.6, 1.2],
      [-15, 15, 0.6, 5, 2.2],
      [15, 8, 0.6, 5, 1.6],
    ]) {
      k.wall(x, s * z, w, d, h, STONE_DARK);
    }
    for (const [x, z] of [
      [-4, 7],
      [4, 7],
    ]) {
      k.block(x, s * z, 1.4, 1.4, 4, STONE_LIGHT);
    }
    for (const [x, z, h] of [
      [-28, 10, 1.2],
      [-27, 12, 2.2],
      [28, 10, 1.2],
      [27, 12, 2.2],
    ]) {
      k.block(x, s * z, 1.8, 1.8, h, WOOD);
    }
  }
  // Teleporters: each keep's back corner to the far side of the middle.
  k.teleporterPair([5, K, -31], [-26, 0, 5], "#ff6a6a");
  k.teleporterPair([-5, K, 31], [26, 0, -5], "#6a8cff");
  for (const [x, z] of [
    [-11, -18],
    [11, 18],
    [0, -4],
    [0, 4],
  ]) {
    k.props.push({ kind: "torch", pos: [x, 0, z], light: true });
  }
  const level = k.level("ctf", "Twin Keeps", "large", "dusk", 50);
  return { ...level, ctf: { flags, spawns } };
}

export const ctf = twinKeeps();

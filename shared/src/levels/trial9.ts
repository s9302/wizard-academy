// Trial IX: The Hollow Throne. The last boss fight (BossRoom), against the
// Lich Sovereign: a sunken necropolis at night. The Lich blinks from place
// to place, so there's no safe corner, just lots of cover: crypts,
// gravestones and a broken colonnade, a raised ring of walkways to fight
// from, two pools of void, and teleporters across the middle.

import { ArenaKit } from "./arenaKit.ts";
import type { Level } from "./types.ts";

const FLOOR = "#4f4a5c";
const STONE = "#77718a";
const STONE_DARK = "#3a3548";
const BONE = "#cfc7b0";
const VIOLET = "#9a7bff";

function hollowThrone(): Level {
  const k = new ArenaKit(40, FLOOR, STONE_DARK, 9);

  // Crypts: four solid tombs with flat roofs you can reach by ladder.
  for (const [x, z] of [
    [-24, -20],
    [24, -20],
    [-24, 20],
    [24, 20],
  ]) {
    k.block(x, z, 8, 6, 3.5, STONE);
    k.ladder(x - Math.sign(x) * 4.1, z, 3.5, Math.sign(x) > 0 ? Math.PI / 2 : -Math.PI / 2);
    k.pickup(x, z, 3.5);
    k.props.push({ kind: "crystal", pos: [x, 5, z], color: VIOLET, scale: 0.6 });
  }

  // A broken colonnade around the middle.
  for (let i = 0; i < 10; i++) {
    if (i === 2 || i === 7) continue; // two have fallen
    const a = (i / 10) * Math.PI * 2;
    k.block(Math.cos(a) * 14, Math.sin(a) * 14, 1.6, 1.6, 2.5 + (i % 3), STONE);
  }

  // Gravestones: low cover everywhere.
  for (const [x, z] of [
    [-6, -24], [0, -26], [6, -24], [-6, 24], [0, 26], [6, 24],
    [-30, 0], [-32, -6], [-32, 6], [30, 0], [32, -6], [32, 6],
    [-16, -4], [16, 4], [-8, 8], [8, -8],
  ]) {
    k.wall(x, z, 1.2, 0.4, 1.2, BONE);
  }

  // Void pools between the crypts.
  k.pit(0, -34, 10, 4, "void").pit(0, 34, 10, 4, "void");

  // Teleporters across the middle (east to west), and pads near them.
  k.teleporterPair([-36, 0, -14], [36, 0, 14], VIOLET);
  k.pad(-10, -14, 14).pad(10, 14, 14);

  // The throne on its dais at the north (the Lich starts over it).
  k.slab(0, -16, 6, 4, 0, 0.5, STONE_DARK);
  k.block(0, -17.5, 2.2, 1, 3, STONE_DARK);
  k.props.push({ kind: "crystal", pos: [0, 4, -17.5], color: VIOLET, scale: 1 });

  for (const [x, z] of [
    [-12, -36],
    [12, -36],
    [-12, 36],
    [12, 36],
    [-36, -18],
    [36, 18],
  ]) {
    k.props.push({ kind: "torch", pos: [x, 0, z], light: true });
  }

  k.pickup(0, 0).pickup(-14, 10).pickup(14, -10).pickup(-30, -12).pickup(30, 12);

  for (const x of [-9, -3, 3, 9]) k.spawn(x, 30);
  for (const x of [-6, 0, 6]) k.spawn(x, 27);

  const level = k.level("trial9", "The Hollow Throne", "large", "night", 60);
  return { ...level, bossFight: { boss: "lich", home: [0, 3.3, -14] } };
}

export const trial9 = hollowThrone();

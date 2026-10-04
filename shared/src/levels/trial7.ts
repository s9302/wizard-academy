// Trial VII: The Tyrant's Crown. Not a course: a boss fight (BossRoom),
// fought with your battle royale class. An 80 x 80 m ruin at dusk, built
// with the arenas' kit so the boss (and allied bots) can walk all of it.
//
// What's here for the fight: broken pillars to hide behind (they stop the
// Tyrant's boulders and orbs), four raised platforms with ramps for
// archers and casters, two lava pools to keep out of, jump pads for
// dodging a leap, and potions and wards that come back after a while.

import { ArenaKit } from "./arenaKit.ts";
import type { Level } from "./types.ts";

const FLOOR = "#7d7590";
const STONE = "#8d8aa6";
const STONE_DARK = "#57536f";
const WOOD = "#7a5236";
const GOLD = "#e8c547";

function tyrantsCrown(): Level {
  const k = new ArenaKit(40, FLOOR, STONE_DARK, 8);

  // The raised platforms: 9 x 9, 3 m up, a ramp each toward the middle.
  const P = 3;
  for (const [x, z] of [
    [-28, -28],
    [28, -28],
    [-28, 28],
    [28, 28],
  ]) {
    k.block(x, z, 9, 9, P, STONE);
    const sx = -Math.sign(x);
    k.rampX(x + sx * (4.5 + P * 1.7), x + sx * 4.5, z, 3, 0, P, WOOD);
    k.pickup(x, z, P);
    // A low parapet on the outer edges (cover from the middle is the point).
    k.wall(x - sx * 4.2, z, 0.5, 9, 0.9, STONE_DARK, P);
  }

  // Broken pillars around the middle: cover from what the Tyrant throws.
  for (const [x, z, h] of [
    [-12, -6, 5],
    [12, -6, 3.5],
    [-12, 10, 3],
    [12, 10, 5],
    [0, -18, 4],
    [-22, 2, 4.5],
    [22, 2, 4],
    [0, 22, 3.5],
  ]) {
    k.block(x, z, 2.2, 2.2, h, STONE);
  }
  // Fallen pillar pieces: low walls you can shoot over.
  k.wall(-6, 16, 5, 1.2, 1.1, STONE_DARK).wall(7, -24, 1.2, 5, 1.1, STONE_DARK).wall(-26, -12, 1.2, 4, 1.1, STONE_DARK).wall(26, 16, 1.2, 4, 1.1, STONE_DARK);

  // Lava pools on the east and west sides of the middle.
  k.pit(-20, -18, 7, 5, "lava").pit(20, 22, 7, 5, "lava");

  // Jump pads near the middle, for getting out of a leap's circle in a hurry.
  k.pad(-6, 4, 14).pad(6, 4, 14).pad(0, -9, 14);

  // The Tyrant's dais at the north end (it starts here), with a crown of gold.
  k.slab(0, -32, 10, 6, 0, 0.4, STONE_DARK);
  for (const x of [-4, 4]) k.slab(x, -34.5, 0.8, 0.8, 0.4, 5, STONE_DARK);
  k.props.push({ kind: "crystal", pos: [0, 6, -34.5], color: GOLD, scale: 1.1 });
  for (const [x, z] of [
    [-6, -30],
    [6, -30],
    [-16, 30],
    [16, 30],
    [-36, 0],
    [36, 0],
  ]) {
    k.props.push({ kind: "torch", pos: [x, 0, z], light: true });
  }

  // Pickups on the floor (the platforms have one each).
  k.pickup(0, 6).pickup(-16, -2).pickup(16, -2).pickup(-8, 26).pickup(8, 26).pickup(0, -24);

  // Everyone starts at the south end, facing the dais.
  for (const x of [-9, -3, 3, 9]) k.spawn(x, 32);
  for (const x of [-6, 0, 6]) k.spawn(x, 28);

  const level = k.level("trial7", "The Tyrant's Crown", "large", "dusk", 60);
  return { ...level, bossFight: { boss: "tyrant", home: [0, 3.4, -30] } };
}

export const trial7 = tyrantsCrown();

// Trial VIII: The Frozen Summit. A boss fight (BossRoom) against the Frost
// Wyrm, fought with your battle royale class. A wide, snowy mountaintop:
// the Wyrm circles high over the middle, so this arena is about cover from
// its breath and ice, high ground for the archers and casters, and being
// ready when it swoops down (melee classes get their chance then).
//
// What's here: ice pillars and broken walls for cover, four raised ledges
// with ramps, a frozen crevasse on each side (fall in and you're out), jump
// pads for getting out of a dive's circle, and potions that come back.

import { ArenaKit } from "./arenaKit.ts";
import type { Level } from "./types.ts";

const SNOW = "#dfe8f0";
const ICE = "#9fd4ef";
const ROCK = "#6f7a8c";
const ROCK_DARK = "#4a5262";
const WOOD = "#7a5236";

function frozenSummit(): Level {
  const k = new ArenaKit(42, SNOW, ROCK_DARK, 8);

  // Raised ledges at the corners, 4 m up, a ramp each toward the middle.
  const P = 4;
  for (const [x, z] of [
    [-30, -26],
    [30, -26],
    [-30, 26],
    [30, 26],
  ]) {
    k.block(x, z, 10, 9, P, ROCK);
    const sz = -Math.sign(z);
    k.rampZ(z + sz * (4.5 + P * 1.7), z + sz * 4.5, x, 3, 0, P, WOOD);
    k.pickup(x, z, P);
    k.wall(x, z - sz * 4.2, 10, 0.5, 1, ROCK_DARK, P);
  }

  // Ice pillars around the middle (cover from the breath and the shards).
  for (const [x, z, h] of [
    [-10, -8, 5],
    [10, -8, 4],
    [-10, 10, 4],
    [10, 10, 5],
    [0, -20, 3.5],
    [0, 20, 3.5],
    [-22, 0, 4.5],
    [22, 0, 4.5],
  ]) {
    k.block(x, z, 2, 2, h, ICE);
  }
  // Low snow drifts and broken walls you can shoot over.
  k.wall(-5, 0, 4, 1.2, 1.1, ROCK).wall(5, 0, 4, 1.2, 1.1, ROCK).wall(0, -10, 1.2, 4, 1.1, ROCK).wall(0, 12, 1.2, 4, 1.1, ROCK);
  k.wall(-18, -16, 5, 1.2, 1.1, SNOW).wall(18, 16, 5, 1.2, 1.1, SNOW).wall(-18, 18, 1.2, 4, 1.1, SNOW).wall(18, -18, 1.2, 4, 1.1, SNOW);

  // Crevasses on the east and west edges.
  k.pit(-34, 0, 5, 12, "void").pit(34, 0, 5, 12, "void");

  // Jump pads for dodging a dive.
  k.pad(-15, -2, 14).pad(15, -2, 14).pad(0, 6, 14).pad(0, -26, 14);

  // Ice crystals and torches.
  for (const [x, z, s] of [
    [-38, -38, 1.4],
    [38, -38, 1.2],
    [-38, 38, 1.2],
    [38, 38, 1.4],
  ]) {
    k.props.push({ kind: "crystal", pos: [x, 3, z], color: "#bff4ff", scale: s });
  }
  for (const [x, z] of [
    [-8, -36],
    [8, -36],
    [-14, 34],
    [14, 34],
    [-38, -12],
    [38, 12],
  ]) {
    k.props.push({ kind: "torch", pos: [x, 0, z], light: true });
  }

  k.pickup(0, 0).pickup(-16, 6).pickup(16, 6).pickup(-6, -30).pickup(6, 30).pickup(0, -14);

  for (const x of [-9, -3, 3, 9]) k.spawn(x, 36);
  for (const x of [-6, 0, 6]) k.spawn(x, 32);

  const level = k.level("trial8", "The Frozen Summit", "large", "night", 60);
  // Its home is over the middle of the arena (it circles 13 m around it).
  return { ...level, bossFight: { boss: "wyrm", home: [0, 2.2, -4] } };
}

export const trial8 = frozenSummit();

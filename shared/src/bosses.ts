// Bosses at the end of some trials. Everyone who reaches the boss arena
// fights the same boss together; it has more health the more of you there
// are. You get three hearts; lose them all and you're back at the arena's
// entrance. Beat it and the finish opens for everyone who was there.

import type { Vec3 } from "./protocol.ts";

export type BossKind = "golem" | "wraith";

export type BossDef = {
  name: string;
  title: string; // shown over its health bar
  hp: number; // for one wizard; +60% for each extra
  radius: number; // its body, for your spells
  height: number; // body center above the arena floor
  speed: number;
  color: string;
};

export const BOSSES: Record<BossKind, BossDef> = {
  golem: { name: "The Bridge Golem", title: "Guardian of the Shattered Bridge", hp: 260, radius: 1.7, height: 2.1, speed: 2.4, color: "#9a96aa" },
  wraith: { name: "The Storm Wraith", title: "Heart of the Storm", hp: 380, radius: 1.4, height: 3.6, speed: 3.6, color: "#8fe3ff" },
};

export const BOSS_HEARTS = 3;
export const PLAYER_BOLT_DAMAGE = 18;
export const PLAYER_BOLT_COOLDOWN_MS = 420;

// Projectiles the boss throws: they fly straight at `speed` from o along d.
export type BossShot = { id: number; o: Vec3; d: Vec3; speed: number; radius: number; kind: "rock" | "orb"; time: number };
export const bossShotAt = (s: BossShot, t: number): Vec3 => [s.o[0] + s.d[0] * s.speed * t, s.o[1] + s.d[1] * s.speed * t, s.o[2] + s.d[2] * s.speed * t];
export const SHOT_RANGE = 45;

// A shockwave: a ring spreading along the floor from o. Jump over it.
export const WAVE_SPEED = 9;
export const WAVE_RANGE = 15;
export const WAVE_WIDTH = 0.8;
export const WAVE_HEIGHT = 0.6; // your feet must be at least this high to clear it

// A lightning strike: a marked circle, then a bolt from the sky.
export const STRIKE_DELAY_MS = 1300;
export const STRIKE_RADIUS = 2.4;

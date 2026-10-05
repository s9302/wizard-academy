// Bosses at the end of some trials. Everyone who reaches the boss arena
// fights the same boss together; it has more health the more of you there
// are. You get three hearts; lose them all and you're back at the arena's
// entrance. Beat it and the finish opens for everyone who was there.

import type { Vec3 } from "./protocol.ts";

export type BossKind = "golem" | "wraith" | "tyrant" | "wyrm" | "lich";

export type BossDef = {
  name: string;
  title: string; // shown over its health bar
  hp: number; // for one wizard; +60% for each extra
  radius: number; // its body, for your spells
  height: number; // body center above the arena floor
  speed: number;
  color: string;
  // For the class-fought bosses: a short hint for the HUD, and the tip after a loss.
  hint?: string;
  tip?: string;
};

export const BOSSES: Record<BossKind, BossDef> = {
  golem: { name: "The Bridge Golem", title: "Guardian of the Shattered Bridge", hp: 260, radius: 1.7, height: 2.1, speed: 2.4, color: "#9a96aa" },
  wraith: { name: "The Storm Wraith", title: "Heart of the Storm", hp: 380, radius: 1.4, height: 3.6, speed: 3.6, color: "#8fe3ff" },
  // Trial VII's boss: fought with your battle royale class (BossRoom), not
  // with hearts. Its numbers are in TYRANT below.
  tyrant: { name: "The Storm Tyrant", title: "The Storm Made Flesh", hp: 2200, radius: 1.8, height: 3, speed: 3.2, color: "#ffcf5a", hint: "hide behind pillars, jump the shockwaves", tip: "Hide behind the pillars from its boulders, jump its shockwaves, and get out of the red circles." },
  // Trial VIII: a dragon that circles overhead and swoops; Trial IX: a
  // necromancer that teleports and raises the dead. Fought like the Tyrant.
  wyrm: { name: "The Frost Wyrm", title: "Wings of the Long Winter", hp: 2600, radius: 2.4, height: 2.2, speed: 0, color: "#bfeeff", hint: "pillars stop its breath; hit it when it lands", tip: "Ice pillars stop its frost breath. Get out of the circles, and when it swoops down, that's your chance up close." },
  lich: { name: "The Lich Sovereign", title: "King of the Hollow Dead", hp: 2400, radius: 1.3, height: 2.8, speed: 0, color: "#9a7bff", hint: "it blinks: keep moving, kill the dead", tip: "It blinks around, so don't stay put. Jump its death rings, get out of the circles, and deal with the wolves it raises." },
};

// The Storm Tyrant (Trial VII). It walks after the nearest fighter and gets
// meaner as it's hurt: phase 2 below 66% health, phase 3 below 33%.
export const TYRANT = {
  // Damage to a fighter (before class defense, shields and Fortify).
  damage: { slam: 28, rock: 20, leap: 38, orb: 14, frost: 14, lightning: 24, meteor: 30, ice: 26 },
  phase2: 0.66,
  phase3: 0.33,
  leapRadius: 4.5, // the marked circle it lands in
  leapDelayMs: 1400,
  meteorRadius: 3.2,
  meteorDelayMs: 1600,
  wolves: 2, // per summon, at most 4 at once
};

// In the battle royale's hit tests the boss is one more body to hit; its id
// is in the monster range, so clients treat a hit on it like a monster's.
export const BOSS_BODY_ID = 999_000_000;

export const BOSS_HEARTS = 3;
export const PLAYER_BOLT_DAMAGE = 18;
export const PLAYER_BOLT_COOLDOWN_MS = 420;

// Projectiles the boss throws: they fly straight at `speed` from o along d.
export type BossShot = { id: number; o: Vec3; d: Vec3; speed: number; radius: number; kind: "rock" | "orb" | "frost"; time: number };
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
// What a marked circle is (lightning by default; the Tyrant also leaps and calls meteors).
export type StrikeKind = "lightning" | "leap" | "meteor" | "ice"; // ice: the Frost Wyrm's spikes, out of the ground

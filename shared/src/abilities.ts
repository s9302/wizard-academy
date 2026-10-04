// Class abilities in the battle royale (Phase 12): two per class, on E and R.
// Wizards reshape the arena (a wall, a pillar); Rogues move unseen (a short
// teleport, vanishing); Knights push in and hold on (a charge, fortifying).
// The server does the real work for all of them; these are the numbers.

import type { ClassId } from "./classes.ts";

export type AbilityId = "wall" | "pillar" | "blink" | "stealth" | "charge" | "fortify";

export type AbilityDef = {
  name: string;
  cooldownMs: number;
  durationMs?: number;
  description: string;
};

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  wall: { name: "Stone Wall", cooldownMs: 12_000, durationMs: 15_000, description: "A 4.5 m stone wall where you aim (up to 18 m). Lasts 15 s." },
  pillar: { name: "Earth Pillar", cooldownMs: 14_000, durationMs: 12_000, description: "A 3.5 m pillar rises where you aim. Aim at your feet to ride it up." },
  blink: { name: "Shadow Step", cooldownMs: 9_000, description: "Teleport up to 12 m where you're looking. Not through walls." },
  stealth: { name: "Vanish", cooldownMs: 16_000, durationMs: 4_000, description: "Invisible for 4 s, or until you attack." },
  charge: { name: "Charge", cooldownMs: 10_000, description: "Rush 8 m forward. The first enemy you hit takes 20." },
  fortify: { name: "Fortify", cooldownMs: 18_000, durationMs: 5_000, description: "Take half damage for 5 s." },
};

export const CLASS_ABILITIES: Record<ClassId, [AbilityId, AbilityId]> = {
  wizard: ["wall", "pillar"],
  rogue: ["blink", "stealth"],
  knight: ["charge", "fortify"],
};

// Sizes and reaches (meters).
export const WALL_SIZE: [number, number, number] = [4.5, 2.6, 0.6];
export const PILLAR_SIZE = 1.6;
export const PILLAR_HEIGHT = 3.5;
export const CONJURE_RANGE = 18;
export const BLINK_RANGE = 12;
export const CHARGE_SPEED = 24; // m/s
export const CHARGE_TIME = 0.34; // seconds: about 8 m
export const CHARGE_DAMAGE = 20;
export const FORTIFY_FACTOR = 0.5; // damage multiplier

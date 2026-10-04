// Class abilities in the battle royale (Phase 12): two per class, on E and R.
// Wizards reshape the arena (a wall, a pillar); Rogues move unseen (a short
// teleport, vanishing); Knights push in and hold on (a charge, fortifying).
// The server does the real work for all of them; these are the numbers.
//
// From level 11 (MASTER_LEVEL) each class has more to choose from, and you
// pick which two go on E and R (Esc panel, saved in your loadout). These are
// deliberately over the top. Bots never use them: they keep CLASS_ABILITIES.

import type { ClassId } from "./classes.ts";
import type { Vec3 } from "./protocol.ts";

export type AbilityId =
  | "wall"
  | "pillar"
  | "blink"
  | "stealth"
  | "charge"
  | "fortify"
  // Level 11+
  | "tornado"
  | "flames"
  | "hellpit"
  | "invert"
  | "shockwave"
  | "nullzone"
  | "giant"
  | "chain"
  | "decoys"
  | "glide"
  | "smoke";

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
  charge: { name: "Charge", cooldownMs: 7_000, description: "Rush 11 m forward. Everyone you plow through takes 35, is knocked aside and slowed." },
  fortify: { name: "Fortify", cooldownMs: 13_000, durationMs: 6_000, description: "Heal 25 and take only 30% damage for 6 s. Nothing can slow or shove you." },
  // Wizard, level 11+
  tornado: { name: "Tornado", cooldownMs: 16_000, durationMs: 4_000, description: "A tornado rolls where you aim. Whoever it touches takes 25 and is thrown into the air." },
  flames: { name: "Wall of Flame", cooldownMs: 15_000, durationMs: 7_000, description: "A 12 m line of fire where you aim, for 7 s. Burns anyone in it (24 a second)." },
  hellpit: { name: "Pit to Hell", cooldownMs: 20_000, durationMs: 5_000, description: "The ground opens where you aim, for 5 s: it drags you in, slows you, and burns (36 a second)." },
  invert: { name: "Inversion", cooldownMs: 14_000, durationMs: 5_000, description: "Curse whoever you aim at (30 m): their world turns upside down for 5 s." },
  shockwave: { name: "Shockwave", cooldownMs: 12_000, description: "Blast everyone within 9 m away from you (18 damage, and a long way back)." },
  // Knight, level 11+
  nullzone: { name: "Null Zone", cooldownMs: 20_000, durationMs: 7_000, description: "A 7 m circle where magic dies for 7 s: no spells, no abilities, and spells flying in fizzle." },
  giant: { name: "Giant Form", cooldownMs: 22_000, durationMs: 8_000, description: "Double your size for 8 s: hit 60% harder with more reach, take 35% less damage." },
  chain: { name: "Chain Pull", cooldownMs: 11_000, description: "Hook the first enemy in your aim (20 m) and drag them to you. 12 damage." },
  // Rogue, level 11+
  decoys: { name: "Mirror Images", cooldownMs: 16_000, durationMs: 7_000, description: "Two copies of you run off in different directions for 7 s. One hit breaks a copy." },
  glide: { name: "Glide", cooldownMs: 14_000, durationMs: 9_000, description: "Leap into the air and glide for 9 s: you fall slowly and move faster." },
  smoke: { name: "Smoke Bomb", cooldownMs: 16_000, durationMs: 8_000, description: "A thick cloud where you aim, for 8 s. Anyone inside is hidden from everyone outside." },
};

// The level the new abilities unlock at.
export const MASTER_LEVEL = 11;

// What each class can choose from (the first two are the defaults).
export const CLASS_ABILITY_POOL: Record<ClassId, AbilityId[]> = {
  wizard: ["wall", "pillar", "tornado", "flames", "hellpit", "invert", "shockwave"],
  rogue: ["blink", "stealth", "decoys", "glide", "smoke"],
  knight: ["charge", "fortify", "nullzone", "giant", "chain"],
};
export const MASTER_ABILITIES: AbilityId[] = ["tornado", "flames", "hellpit", "invert", "shockwave", "nullzone", "giant", "chain", "decoys", "glide", "smoke"];

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
export const CHARGE_SPEED = 28; // m/s
export const CHARGE_TIME = 0.4; // seconds: about 11 m
export const CHARGE_DAMAGE = 35;
export const CHARGE_KNOCK = 13; // m/s, sideways out of the way
export const CHARGE_SLOW_MS = 1200;
export const FORTIFY_FACTOR = 0.3; // damage multiplier
export const FORTIFY_HEAL = 25;

// Level 11+ numbers.
export const TORNADO = { speed: 7, radius: 2.2, damage: 25, lift: 14, range: 30 };
export const FLAMES = { length: 12, width: 1.6, dps: 24 };
export const HELLPIT = { radius: 3.6, dps: 36, pull: 3, slow: 0.4 };
export const INVERT_RANGE = 30;
export const SHOCKWAVE = { radius: 9, damage: 18, push: 22, pushTime: 0.4, lift: 7 };
export const NULLZONE_RADIUS = 7;
export const GIANT = { scale: 2, damage: 1.6, reach: 1.5, taken: 0.65 };
export const CHAIN = { range: 20, damage: 12, speed: 26 };
export const DECOYS = { count: 2, speed: 6.5, spread: 0.7 };
export const GLIDE = { lift: 11, fall: 2.2, speed: 1.35 };
export const SMOKE_RADIUS = 5;

// A lasting area an ability leaves on the ground (drawn by the client,
// enforced by the server). Lines (flames) have a yaw and a length; circles a
// radius; a tornado moves along d at TORNADO.speed from p, starting at `time`.
export type FieldKind = "tornado" | "flames" | "hellpit" | "nullzone" | "smoke";
export type FieldInfo = { id: number; kind: FieldKind; owner: number; p: Vec3; r: number; yaw?: number; len?: number; d?: Vec3; time: number; ms: number };

export const fieldCenter = (f: FieldInfo, now: number): Vec3 => {
  if (f.kind !== "tornado" || !f.d) return f.p;
  const t = Math.max(0, Math.min(f.ms, now - f.time)) / 1000;
  return [f.p[0] + f.d[0] * TORNADO.speed * t, f.p[1], f.p[2] + f.d[2] * TORNADO.speed * t];
};

// Is a point (a player's center) inside a field right now?
export function inField(f: FieldInfo, p: Vec3, now: number): boolean {
  const c = fieldCenter(f, now);
  if (Math.abs(p[1] - c[1]) > (f.kind === "smoke" || f.kind === "tornado" ? 4 : 2.2)) return false;
  if (f.kind === "flames") {
    // Along the line (yaw), within half its length; across it, within r.
    const yaw = f.yaw ?? 0;
    const ax = Math.cos(yaw);
    const az = -Math.sin(yaw);
    const dx = p[0] - c[0];
    const dz = p[2] - c[2];
    return Math.abs(dx * ax + dz * az) <= (f.len ?? 0) / 2 && Math.abs(-dx * az + dz * ax) <= f.r;
  }
  return Math.hypot(p[0] - c[0], p[2] - c[2]) <= f.r;
}

// Rogue copies are hittable bodies; their ids sit in the monster range (so a
// hit on one reads like a monster hit to clients) but apart from monsters'.
export const DECOY_ID_BASE = 2_000_000;

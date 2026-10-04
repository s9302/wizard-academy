// Combat numbers shared by client and server: spells, health, pickups, and
// the battle royale's shrinking storm. The server enforces all of them; the
// client uses them to draw spells and show cooldowns.

import type { Vec3, ZoneState } from "./protocol.ts";

export const MAX_HEALTH = 100;
export const MAX_SHIELD = 50;

export type SpellId = "bolt" | "frost" | "spark" | "fireball";

// Which button, and whose cooldown: the three left-click spells share one
// cooldown (you pick one in the Spellbook), so swapping can't fire faster.
export type SpellSlot = "primary" | "fireball";

export type SpellDef = {
  name: string;
  slot: SpellSlot;
  speed: number; // m/s, straight line, no gravity
  range: number; // meters before it fizzles
  radius: number; // the projectile's size, for hitting players
  damage: number; // direct hit
  cooldownMs: number;
  // Fireball: also hurts everyone within splashRadius of where it lands,
  // from splashMax at the center down to splashMin at the edge.
  splashRadius?: number;
  splashMax?: number;
  splashMin?: number;
  // Spark Volley: several projectiles, fanned out sideways by spreadDeg each.
  count?: number;
  spreadDeg?: number;
  // Frost Shard: slows whoever it hits.
  slowMs?: number;
  slowFactor?: number; // movement speed multiplier while slowed
  color: string;
};

export const SPELLS: Record<SpellId, SpellDef> = {
  // Always available. Five hits to take down a full-health wizard.
  bolt: { name: "Arcane Bolt", slot: "primary", speed: 38, range: 50, radius: 0.25, damage: 20, cooldownMs: 550, color: "#b48cff" },
  // Unlocked by Chapter I. Less damage, but the target is slowed.
  frost: {
    name: "Frost Shard",
    slot: "primary",
    speed: 42,
    range: 45,
    radius: 0.22,
    damage: 14,
    cooldownMs: 550,
    slowMs: 1500,
    slowFactor: 0.6,
    color: "#8fe3ff",
  },
  // Unlocked by Chapter II. Strong up close if all three land, weak at range.
  spark: {
    name: "Spark Volley",
    slot: "primary",
    speed: 30,
    range: 20,
    radius: 0.2,
    damage: 9,
    cooldownMs: 750,
    count: 3,
    spreadDeg: 6,
    color: "#ffe066",
  },
  // From a Fire Tome pickup (3 charges): slower, but it explodes.
  fireball: {
    name: "Fireball",
    slot: "fireball",
    speed: 24,
    range: 45,
    radius: 0.35,
    damage: 40,
    cooldownMs: 1000,
    splashRadius: 3.5,
    splashMax: 25,
    splashMin: 8,
    color: "#ff7a2e",
  },
};

export const SPELL_IDS = Object.keys(SPELLS) as SpellId[];

// The direction of each projectile a cast makes (Spark Volley fans out
// sideways around the aim; everything else is one projectile straight ahead).
export function castDirections(spell: SpellId, d: Vec3): Vec3[] {
  const def = SPELLS[spell];
  const count = def.count ?? 1;
  const out: Vec3[] = [];
  for (let k = 0; k < count; k++) {
    const a = ((k - (count - 1) / 2) * (def.spreadDeg ?? 0) * Math.PI) / 180;
    // Rotate around the vertical axis.
    out.push([d[0] * Math.cos(a) + d[2] * Math.sin(a), d[1], -d[0] * Math.sin(a) + d[2] * Math.cos(a)]);
  }
  return out;
}

// The server accepts a cast's starting point if it is this close to where it
// thinks your eyes are (positions arrive 20 times a second, so it lags a bit).
export const CAST_ORIGIN_SLACK = 1.5;

// ---- Pickups ----

export type PickupKind = "tome" | "potion" | "ward";

export const PICKUPS: Record<PickupKind, { name: string; color: string; weight: number }> = {
  tome: { name: "Fire Tome", color: "#ff7a2e", weight: 4 }, // +3 fireball charges
  potion: { name: "Healing Draught", color: "#ff5a8a", weight: 3 }, // +40 health
  ward: { name: "Ward", color: "#5ac8ff", weight: 3 }, // +50 shield (absorbs damage first)
};
export const TOME_CHARGES = 3;
export const MAX_FIREBALL_CHARGES = 6;
export const POTION_HEAL = 40;
export const WARD_SHIELD = 50;
export const PICKUP_REACH = 1.4; // meters, flat distance
export const PICKUP_RESPAWN_MS = 25_000;

// ---- The storm (battle royale zone) ----
//
// The safe circle shrinks in stages. Each stage waits (holdMs) with the next
// circle shown on the ground, then shrinks to it over shrinkMs. Outside the
// circle you take dps damage per second. About 3.5 minutes in all.

export type StormStage = { holdMs: number; shrinkMs: number; radius: number; dps: number };

export const STORM_START_RADIUS = 46; // covers the whole arena
export const STORM_STAGES: StormStage[] = [
  { holdMs: 40_000, shrinkMs: 25_000, radius: 26, dps: 2 },
  { holdMs: 30_000, shrinkMs: 25_000, radius: 14, dps: 4 },
  { holdMs: 25_000, shrinkMs: 20_000, radius: 6, dps: 8 },
  { holdMs: 20_000, shrinkMs: 20_000, radius: 0, dps: 15 },
];
// After the last stage the storm covers everything; this ends it for sure.
export const STORM_FINAL_DPS = 25;

// The safe circle [x, z, radius] at a given server time.
export function stormCircle(zone: ZoneState, now: number): [number, number, number] {
  const span = zone.endsAt - zone.shrinkAt;
  const t = span <= 0 ? (now >= zone.endsAt ? 1 : 0) : Math.min(1, Math.max(0, (now - zone.shrinkAt) / span));
  return [0, 1, 2].map((k) => zone.from[k] + (zone.to[k] - zone.from[k]) * t) as [number, number, number];
}

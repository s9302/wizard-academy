// What players unlock, and how: levels (from XP) and story chapters (from
// clearing trials). Unlocks add options, not power: the new spells are
// alternatives for the same left-click slot, balanced against the Arcane Bolt;
// movement perks help you get around but deal no damage; the rest is looks.
//
// Shared so the client can show what's unlocked and the server can check it
// (an equipped spell or hat must really be unlocked).

import { levelInfo } from "./progression.ts";
import { type ChapterId, chaptersDone } from "./story.ts";

export type Requirement = { level: number } | { chapter: ChapterId };

export type PrimarySpell = "bolt" | "frost" | "spark";
export type Hat = "classic" | "tall" | "starry" | "crown";
export type Robe = "auto" | "crimson" | "emerald" | "midnight" | "ivory" | "gold";

export type Unlock = {
  id: string;
  name: string;
  kind: "spell" | "perk" | "hat" | "robe" | "area";
  requires: Requirement;
  description: string;
};

export const UNLOCKS: Unlock[] = [
  { id: "robe:crimson", name: "Crimson robe", kind: "robe", requires: { level: 2 }, description: "A deep red robe." },
  { id: "perk:doubleJump", name: "Double Jump", kind: "perk", requires: { level: 3 }, description: "Press Space again in mid-air." },
  { id: "robe:emerald", name: "Emerald robe", kind: "robe", requires: { level: 4 }, description: "A green robe." },
  { id: "perk:dash", name: "Blink Dash", kind: "perk", requires: { level: 5 }, description: "Press Q for a quick burst forward (every 2 s)." },
  { id: "hat:tall", name: "Tall hat", kind: "hat", requires: { level: 6 }, description: "More hat." },
  { id: "robe:midnight", name: "Midnight robe", kind: "robe", requires: { level: 7 }, description: "A robe the color of the night sky." },
  { id: "robe:gold", name: "Gold robe", kind: "robe", requires: { level: 10 }, description: "For the truly dedicated." },
  { id: "spell:frost", name: "Frost Shard", kind: "spell", requires: { chapter: 1 }, description: "14 damage and slows whoever it hits for 1.5 s." },
  { id: "area:garden", name: "The Spell Garden", kind: "area", requires: { chapter: 1 }, description: "A walled garden in the hub." },
  { id: "spell:spark", name: "Spark Volley", kind: "spell", requires: { chapter: 2 }, description: "Three sparks in a fan, 9 damage each. Short range." },
  { id: "area:observatory", name: "The Observatory", kind: "area", requires: { chapter: 2 }, description: "Vale's stargazing tower." },
  { id: "hat:starry", name: "Starry hat", kind: "hat", requires: { chapter: 2 }, description: "Stars from the Observatory." },
  { id: "area:sanctum", name: "The Headmaster's Sanctum", kind: "area", requires: { chapter: 3 }, description: "The academy's doors open." },
  { id: "hat:crown", name: "Headmaster's crown", kind: "hat", requires: { chapter: 3 }, description: "Left on a stand in the Sanctum." },
  { id: "robe:ivory", name: "Ivory robe", kind: "robe", requires: { chapter: 3 }, description: "The Headmaster's colors." },
];

// Always available.
const DEFAULTS = ["spell:bolt", "hat:classic", "robe:auto"];

export function requirementText(r: Requirement): string {
  return "level" in r ? `Reach level ${r.level}` : `Complete Chapter ${["I", "II", "III"][r.chapter - 1]}`;
}

// Admins have everything.
export function allUnlocks(): Set<string> {
  return new Set([...DEFAULTS, ...UNLOCKS.map((u) => u.id)]);
}

// What a profile has unlocked (the client's view; the server checks again).
export function unlocksFor(p: { xp: number; bestTimes: Record<string, number>; isAdmin?: boolean }): Set<string> {
  return p.isAdmin ? allUnlocks() : unlockedSet(p.xp, p.bestTimes);
}

export function unlockedSet(xp: number, bestTimes: Record<string, number>): Set<string> {
  const level = levelInfo(xp).level;
  const chapters = chaptersDone(bestTimes);
  const set = new Set(DEFAULTS);
  for (const u of UNLOCKS) {
    const r = u.requires;
    if ("level" in r ? level >= r.level : chapters.includes(r.chapter)) set.add(u.id);
  }
  return set;
}

// Unlocks that come with reaching exactly this level (for "Unlocked!" messages).
export function unlocksAtLevel(level: number): Unlock[] {
  return UNLOCKS.filter((u) => "level" in u.requires && u.requires.level === level);
}

export function unlocksForChapter(chapter: ChapterId): Unlock[] {
  return UNLOCKS.filter((u) => "chapter" in u.requires && u.requires.chapter === chapter);
}

// ---- Loadout: what you've chosen to use and wear ----

export type Loadout = { primary: PrimarySpell; hat: Hat; robe: Robe };
export const DEFAULT_LOADOUT: Loadout = { primary: "bolt", hat: "classic", robe: "auto" };

export const PRIMARY_SPELLS: PrimarySpell[] = ["bolt", "frost", "spark"];
export const HATS: Hat[] = ["classic", "tall", "starry", "crown"];
export const ROBES: Robe[] = ["auto", "crimson", "emerald", "midnight", "ivory", "gold"];
export const ROBE_COLORS: Record<Exclude<Robe, "auto">, string> = {
  crimson: "#a8283a",
  emerald: "#2f9e5a",
  midnight: "#26306b",
  ivory: "#ece3cf",
  gold: "#d9a72b",
};
export const HAT_NAMES: Record<Hat, string> = { classic: "Classic hat", tall: "Tall hat", starry: "Starry hat", crown: "Headmaster's crown" };
export const ROBE_NAMES: Record<Robe, string> = {
  auto: "Your own color",
  crimson: "Crimson",
  emerald: "Emerald",
  midnight: "Midnight",
  ivory: "Ivory",
  gold: "Gold",
};

// Keep only valid, unlocked choices; anything else falls back to the default.
// Used on everything read from the database or sent by a client.
export function sanitizeLoadout(raw: unknown, unlocked: Set<string>): Loadout {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(value: unknown, options: readonly T[], prefix: string, fallback: T): T =>
    typeof value === "string" && (options as readonly string[]).includes(value) && unlocked.has(`${prefix}:${value}`) ? (value as T) : fallback;
  return {
    primary: pick(r.primary, PRIMARY_SPELLS, "spell", DEFAULT_LOADOUT.primary),
    hat: pick(r.hat, HATS, "hat", DEFAULT_LOADOUT.hat),
    robe: pick(r.robe, ROBES, "robe", DEFAULT_LOADOUT.robe),
  };
}

// What other players see of you.
export type Look = { hat: Hat; robe: Robe };

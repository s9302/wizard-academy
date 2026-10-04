// What players unlock, and how: levels (from XP) and story chapters (from
// clearing trials). Unlocks add options, not power: the new spells are
// alternatives for the same left-click slot, balanced against the Arcane Bolt;
// movement perks help you get around but deal no damage; the rest is looks.
//
// Shared so the client can show what's unlocked and the server can check it
// (an equipped spell or hat must really be unlocked).

import { type Appearance, DEFAULT_APPEARANCE, sanitizeAppearance } from "./appearance.ts";
import { type AbilityId, CLASS_ABILITIES, CLASS_ABILITY_POOL, MASTER_LEVEL } from "./abilities.ts";
import { CLASS_IDS, type ClassId } from "./classes.ts";
import { levelInfo } from "./progression.ts";
import { type ChapterId, chaptersDone } from "./story.ts";

export type Requirement = { level: number } | { chapter: ChapterId };

export type PrimarySpell = "bolt" | "frost" | "spark";
export type Hat = "none" | "classic" | "tall" | "starry" | "crown" | "storm" | "tyrant" | "tophat" | "beret" | "hood" | "feathered" | "horned";
export type Robe = "auto" | "crimson" | "emerald" | "midnight" | "ivory" | "gold" | "storm" | "ember";

export type Unlock = {
  id: string;
  name: string;
  kind: "spell" | "perk" | "hat" | "robe" | "area" | "outfit" | "abilities";
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
  { id: "outfit:battlemage", name: "Battlemage armor", kind: "outfit", requires: { level: 8 }, description: "Plate shoulders and a belted coat." },
  { id: "robe:gold", name: "Gold robe", kind: "robe", requires: { level: 10 }, description: "For the truly dedicated." },
  // Over-the-top E/R abilities for each class (battle royale; pick them in the Esc panel).
  { id: "abilities:wizard", name: "Wizard mastery", kind: "abilities", requires: { level: MASTER_LEVEL }, description: "Tornado, Wall of Flame, Pit to Hell, Inversion and Shockwave for E and R." },
  { id: "abilities:knight", name: "Knight mastery", kind: "abilities", requires: { level: MASTER_LEVEL }, description: "Null Zone, Giant Form and Chain Pull for E and R." },
  { id: "abilities:rogue", name: "Rogue mastery", kind: "abilities", requires: { level: MASTER_LEVEL }, description: "Mirror Images, Glide and Smoke Bomb for E and R." },
  { id: "spell:frost", name: "Frost Shard", kind: "spell", requires: { chapter: 1 }, description: "14 damage and slows whoever it hits for 1.5 s." },
  { id: "area:garden", name: "The Spell Garden", kind: "area", requires: { chapter: 1 }, description: "A walled garden in the hub." },
  { id: "spell:spark", name: "Spark Volley", kind: "spell", requires: { chapter: 2 }, description: "Three sparks in a fan, 9 damage each. Short range." },
  { id: "area:observatory", name: "The Observatory", kind: "area", requires: { chapter: 2 }, description: "Vale's stargazing tower." },
  { id: "hat:starry", name: "Starry hat", kind: "hat", requires: { chapter: 2 }, description: "Stars from the Observatory." },
  { id: "area:sanctum", name: "The Headmaster's Sanctum", kind: "area", requires: { chapter: 3 }, description: "The academy's doors open." },
  { id: "hat:crown", name: "Headmaster's crown", kind: "hat", requires: { chapter: 3 }, description: "Left on a stand in the Sanctum." },
  { id: "robe:ivory", name: "Ivory robe", kind: "robe", requires: { chapter: 3 }, description: "The Headmaster's colors." },
  { id: "area:trial5", name: "Trial V", kind: "area", requires: { chapter: 4 }, description: "The portal to the Hollow Stair." },
  { id: "robe:storm", name: "Storm robe", kind: "robe", requires: { chapter: 4 }, description: "The storm's colors." },
  { id: "outfit:archmage", name: "Archmage regalia", kind: "outfit", requires: { chapter: 4 }, description: "A high collar and a long mantle." },
  { id: "area:trial6", name: "Trial VI", kind: "area", requires: { chapter: 5 }, description: "The portal to the Eye of the Storm." },
  { id: "robe:ember", name: "Ember robe", kind: "robe", requires: { chapter: 5 }, description: "Still warm from the hollow." },
  { id: "hat:storm", name: "Stormcaller's hat", kind: "hat", requires: { chapter: 6 }, description: "It crackles." },
  { id: "hat:tyrant", name: "Tyrant's crown", kind: "hat", requires: { chapter: 7 }, description: "Taken off the Storm Tyrant." },
  { id: "area:trial7", name: "Trial VII", kind: "area", requires: { chapter: 6 }, description: "The portal to the Tyrant's Crown." },
];

// Always available.
const DEFAULTS = ["spell:bolt", "hat:classic", "robe:auto", "hat:none", "hat:tophat", "hat:beret", "hat:hood", "hat:feathered", "hat:horned"];

export function requirementText(r: Requirement): string {
  return "level" in r ? `Reach level ${r.level}` : `Complete Chapter ${["I", "II", "III", "IV", "V", "VI", "VII"][r.chapter - 1]}`;
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

// cls: battle royale class (all three are available to everyone). The rest
// of the look (skin, hair, face, outfit) is in appearance.ts.
// abil: each class's chosen E and R abilities (missing: CLASS_ABILITIES).
export type Loadout = { primary: PrimarySpell; hat: Hat; robe: Robe; cls: ClassId; abil?: Partial<Record<ClassId, [AbilityId, AbilityId]>> } & Appearance;
export const DEFAULT_LOADOUT: Loadout = { primary: "bolt", hat: "classic", robe: "auto", cls: "wizard", ...DEFAULT_APPEARANCE };

export const PRIMARY_SPELLS: PrimarySpell[] = ["bolt", "frost", "spark"];
export const HATS: Hat[] = ["none", "classic", "tophat", "beret", "hood", "feathered", "horned", "tall", "starry", "crown", "storm", "tyrant"];
export const ROBES: Robe[] = ["auto", "crimson", "emerald", "midnight", "ivory", "gold", "storm", "ember"];
export const ROBE_COLORS: Record<Exclude<Robe, "auto">, string> = {
  crimson: "#a8283a",
  emerald: "#2f9e5a",
  midnight: "#26306b",
  ivory: "#ece3cf",
  gold: "#d9a72b",
  storm: "#4b3f8f",
  ember: "#b8502a",
};
export const HAT_NAMES: Record<Hat, string> = {
  none: "No hat",
  classic: "Classic hat",
  tophat: "Top hat",
  beret: "Beret",
  hood: "Hood",
  feathered: "Feathered cap",
  horned: "Horned helm",
  tall: "Tall hat",
  starry: "Starry hat",
  crown: "Headmaster's crown",
  storm: "Stormcaller's hat",
  tyrant: "Tyrant's crown",
};
export const ROBE_NAMES: Record<Robe, string> = {
  auto: "Your own color",
  crimson: "Crimson",
  emerald: "Emerald",
  midnight: "Midnight",
  ivory: "Ivory",
  gold: "Gold",
  storm: "Storm",
  ember: "Ember",
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
    cls: typeof r.cls === "string" && (CLASS_IDS as string[]).includes(r.cls) ? (r.cls as ClassId) : DEFAULT_LOADOUT.cls,
    ...sanitizeAbilities(r.abil, unlocked),
    ...sanitizeAppearance(r, unlocked),
  };
}

// Can this class use this ability? (The defaults always; the rest from level 11.)
export function abilityAllowed(cls: ClassId, id: AbilityId, unlocked: Set<string>): boolean {
  if (!CLASS_ABILITY_POOL[cls].includes(id)) return false;
  return CLASS_ABILITIES[cls].includes(id) || unlocked.has(`abilities:${cls}`);
}

// A class's E and R, from a loadout (falling back to the defaults).
export function abilitiesFor(l: Loadout | undefined, cls: ClassId): [AbilityId, AbilityId] {
  return l?.abil?.[cls] ?? CLASS_ABILITIES[cls];
}

// { abil } if any class has a valid pick, else nothing (so a plain loadout stays plain).
function sanitizeAbilities(raw: unknown, unlocked: Set<string>): Pick<Loadout, "abil"> {
  const out: Partial<Record<ClassId, [AbilityId, AbilityId]>> = {};
  if (typeof raw !== "object" || raw === null) return {};
  for (const cls of CLASS_IDS) {
    const pair = (raw as Record<string, unknown>)[cls];
    if (!Array.isArray(pair) || pair.length !== 2 || pair[0] === pair[1]) continue;
    if (pair.every((id) => typeof id === "string" && abilityAllowed(cls, id as AbilityId, unlocked))) out[cls] = [pair[0], pair[1]] as [AbilityId, AbilityId];
  }
  return Object.keys(out).length ? { abil: out } : {};
}

// What other players see of you.
export type Look = { hat: Hat; robe: Robe } & Appearance;
export const DEFAULT_LOOK: Look = { hat: "classic", robe: "auto", ...DEFAULT_APPEARANCE };

export function lookOf(l: Loadout): Look {
  return { hat: l.hat, robe: l.robe, skin: l.skin, hair: l.hair, hairColor: l.hairColor, face: l.face, features: l.features, acc: l.acc, outfit: l.outfit };
}

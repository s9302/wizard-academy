// What players unlock, and how: levels (from XP) and story chapters (from
// clearing trials). Unlocks add options, not power: the new spells are
// alternatives for the same left-click slot, balanced against the Arcane Bolt;
// movement perks help you get around but deal no damage; the rest is looks.
//
// Shared so the client can show what's unlocked and the server can check it
// (an equipped spell or hat must really be unlocked).

import { type HouseId, isHouse } from "./houses.ts";
import { type Appearance, DEFAULT_APPEARANCE, sanitizeAppearance } from "./appearance.ts";
import { ABILITIES, type AbilityId, abilityLevel, CLASS_ABILITIES, CLASS_ABILITY_POOL } from "./abilities.ts";
import { CLASS_IDS, CLASSES, type ClassId } from "./classes.ts";

const CLASS_NAMES = Object.fromEntries(CLASS_IDS.map((c) => [c, CLASSES[c].name])) as Record<ClassId, string>;
import { levelInfo } from "./progression.ts";
import { type ChapterId, chaptersDone } from "./story.ts";

export type Requirement = { level: number } | { chapter: ChapterId };

export type PrimarySpell = "bolt" | "frost" | "spark";
export type Hat = "none" | "classic" | "tall" | "starry" | "crown" | "storm" | "tyrant" | "tophat" | "beret" | "hood" | "feathered" | "horned";
export type Robe = "auto" | "crimson" | "emerald" | "midnight" | "ivory" | "gold" | "storm" | "ember" | "frost" | "sovereign";

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
  { id: "outfit:rogue", name: "Rogue's leathers", kind: "outfit", requires: { level: 3 }, description: "Dark leather, a hood, and a strap of throwing knives." },
  { id: "robe:emerald", name: "Emerald robe", kind: "robe", requires: { level: 4 }, description: "A green robe." },
  { id: "outfit:druid", name: "Druid's leaf mantle", kind: "outfit", requires: { level: 5 }, description: "A robe under a mantle of living leaves, belted with a vine." },
  { id: "perk:dash", name: "Blink Dash", kind: "perk", requires: { level: 5 }, description: "Press Q for a quick burst forward (every 2 s)." },
  { id: "hat:tall", name: "Tall hat", kind: "hat", requires: { level: 6 }, description: "More hat." },
  { id: "robe:midnight", name: "Midnight robe", kind: "robe", requires: { level: 7 }, description: "A robe the color of the night sky." },
  { id: "outfit:monk", name: "Monk's wraps", kind: "outfit", requires: { level: 7 }, description: "Bare-chested, all muscle: a sash, loose trousers and hand wraps." },
  { id: "outfit:battlemage", name: "Battlemage armor", kind: "outfit", requires: { level: 8 }, description: "Plate shoulders and a belted coat." },
  { id: "robe:gold", name: "Gold robe", kind: "robe", requires: { level: 10 }, description: "For the truly dedicated." },
  // Extra E/R abilities, one at a time (pick them in the arena's Esc panel).
  ...Object.entries(CLASS_ABILITY_POOL).flatMap(([cls, pool]) =>
    pool.slice(2).map((id): Unlock => ({
      id: `ability:${id}`,
      name: `${ABILITIES[id].name} (${CLASS_NAMES[cls as ClassId]})`,
      kind: "abilities",
      requires: { level: abilityLevel(id) },
      description: ABILITIES[id].description,
    })),
  ),
  { id: "spell:frost", name: "Frost Shard", kind: "spell", requires: { chapter: 1 }, description: "14 damage and slows whoever it hits for 1.5 s." },
  { id: "area:garden", name: "The Spell Garden", kind: "area", requires: { chapter: 1 }, description: "A walled garden in the hub." },
  { id: "spell:spark", name: "Spark Volley", kind: "spell", requires: { chapter: 2 }, description: "Three sparks in a fan, 9 damage each. Short range." },
  { id: "area:observatory", name: "The Observatory", kind: "area", requires: { chapter: 2 }, description: "Vale's stargazing tower." },
  { id: "hat:starry", name: "Starry hat", kind: "hat", requires: { chapter: 2 }, description: "Stars from the Observatory." },
  { id: "area:sanctum", name: "The Headmaster's Sanctum", kind: "area", requires: { chapter: 3 }, description: "The Sanctum's doors, at the back of the Hall of Trials, open." },
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
  { id: "robe:frost", name: "Wyrmfrost robe", kind: "robe", requires: { chapter: 8 }, description: "Woven from the Frost Wyrm's shed scales." },
  { id: "robe:sovereign", name: "Sovereign robe", kind: "robe", requires: { chapter: 9 }, description: "The Lich's own colors, taken from his throne." },
  { id: "area:trial8", name: "Trial VIII", kind: "area", requires: { chapter: 7 }, description: "The portal to the Frozen Summit." },
  { id: "area:trial9", name: "Trial IX", kind: "area", requires: { chapter: 8 }, description: "The portal to the Hollow Throne." },
];

// Always available.
const DEFAULTS = ["spell:bolt", "hat:classic", "robe:auto", "hat:none", "hat:tophat", "hat:beret", "hat:hood", "hat:feathered", "hat:horned"];

export function requirementText(r: Requirement): string {
  return "level" in r ? `Reach level ${r.level}` : `Complete Chapter ${["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"][r.chapter - 1]}`;
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
export type Loadout = { primary: PrimarySpell; hat: Hat; robe: Robe; cls: ClassId; abil?: Partial<Record<ClassId, [AbilityId, AbilityId]>>; house?: HouseId } & Appearance;
export const DEFAULT_LOADOUT: Loadout = { primary: "bolt", hat: "classic", robe: "auto", cls: "wizard", ...DEFAULT_APPEARANCE };

export const PRIMARY_SPELLS: PrimarySpell[] = ["bolt", "frost", "spark"];
export const HATS: Hat[] = ["none", "classic", "tophat", "beret", "hood", "feathered", "horned", "tall", "starry", "crown", "storm", "tyrant"];
export const ROBES: Robe[] = ["auto", "crimson", "emerald", "midnight", "ivory", "gold", "storm", "ember", "frost", "sovereign"];
export const ROBE_COLORS: Record<Exclude<Robe, "auto">, string> = {
  crimson: "#a8283a",
  emerald: "#2f9e5a",
  midnight: "#26306b",
  ivory: "#ece3cf",
  gold: "#d9a72b",
  storm: "#4b3f8f",
  ember: "#b8502a",
  frost: "#8ccbe8",
  sovereign: "#4a2a6e",
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
  frost: "Wyrmfrost",
  sovereign: "Sovereign",
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
    ...(isHouse(r.house) ? { house: r.house } : {}),
  };
}

// Can this class use this ability? (The first two always; the rest by level.)
export function abilityAllowed(cls: ClassId, id: AbilityId, unlocked: Set<string>): boolean {
  if (!CLASS_ABILITY_POOL[cls].includes(id)) return false;
  return CLASS_ABILITIES[cls].includes(id) || unlocked.has(`ability:${id}`);
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
export type Look = { hat: Hat; robe: Robe; house?: HouseId } & Appearance;

// What a bot wears for its class (players dress themselves): Knights in
// armor, Wizards in robes, Rogues in leathers, and so on.
export const CLASS_LOOK: Record<ClassId, Pick<Look, "outfit" | "hat" | "robe">> = {
  knight: { outfit: "battlemage", hat: "horned", robe: "auto" },
  wizard: { outfit: "robe", hat: "classic", robe: "auto" },
  rogue: { outfit: "rogue", hat: "hood", robe: "midnight" },
  cleric: { outfit: "archmage", hat: "none", robe: "ivory" },
  druid: { outfit: "druid", hat: "none", robe: "emerald" },
  monk: { outfit: "monk", hat: "none", robe: "crimson" },
};
export const DEFAULT_LOOK: Look = { hat: "classic", robe: "auto", ...DEFAULT_APPEARANCE };

export function lookOf(l: Loadout): Look {
  return { hat: l.hat, robe: l.robe, skin: l.skin, hair: l.hair, hairColor: l.hairColor, face: l.face, features: l.features, acc: l.acc, outfit: l.outfit, ...(l.house ? { house: l.house } : {}) };
}

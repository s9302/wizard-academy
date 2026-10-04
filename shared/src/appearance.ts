// How a wizard looks besides hat and robe color: skin, hair, face (an
// expression, any number of features, and one accessory) and outfit.
// Everything here is free except two outfits (see unlocks.ts). Shared so the
// server can check choices and the client can draw them.

// Light to dark, then a few that aren't human (it's a school for wizards).
export const SKINS = [
  "porcelain",
  "ivory",
  "fair",
  "rosy",
  "peach",
  "light",
  "golden",
  "tan",
  "honey",
  "olive",
  "caramel",
  "bronze",
  "brown",
  "chestnut",
  "dark",
  "mahogany",
  "deep",
  "espresso",
  "elfin",
  "sylvan",
  "frost",
  "ember",
] as const;
export type Skin = (typeof SKINS)[number];
export const SKIN_COLORS: Record<Skin, string> = {
  porcelain: "#f6dfd0",
  ivory: "#f3e3c8",
  fair: "#efcfb4",
  rosy: "#efc2b0",
  peach: "#eab894",
  light: "#e3b892",
  golden: "#dcab72",
  tan: "#d29f74",
  honey: "#c99460",
  olive: "#b8875a",
  caramel: "#a8754a",
  bronze: "#9a6a42",
  brown: "#8f5f3c",
  chestnut: "#7a4e31",
  dark: "#6b4429",
  mahogany: "#5c3a24",
  deep: "#4a2e1d",
  espresso: "#3a2316",
  elfin: "#c9d3e6",
  sylvan: "#9cc49a",
  frost: "#b9c9f0",
  ember: "#d98a6a",
};

export const HAIRS = ["short", "long", "ponytail", "bun", "spiky", "curly", "braids", "mohawk", "bald"] as const;
export type Hair = (typeof HAIRS)[number];
export const HAIR_NAMES: Record<Hair, string> = {
  short: "Short",
  long: "Long",
  ponytail: "Ponytail",
  bun: "Bun",
  spiky: "Spiky",
  curly: "Curly",
  braids: "Braids",
  mohawk: "Mohawk",
  bald: "Bald",
};

export const HAIR_COLORS = ["black", "brown", "chestnut", "auburn", "ginger", "blonde", "silver", "white", "violet", "teal"] as const;
export type HairColor = (typeof HAIR_COLORS)[number];
export const HAIR_COLOR_VALUES: Record<HairColor, string> = {
  black: "#1c1714",
  brown: "#4a3020",
  chestnut: "#6e3f22",
  auburn: "#8a3324",
  ginger: "#c2602a",
  blonde: "#e0c06a",
  silver: "#b9bcc6",
  white: "#f0eee8",
  violet: "#7a4fd0",
  teal: "#2a9a96",
};

// The expression (one).
export const FACES = ["smile", "grin", "calm", "surprised", "wink", "fierce", "smirk", "sleepy"] as const;
export type Face = (typeof FACES)[number];
export const FACE_NAMES: Record<Face, string> = {
  smile: "Smile",
  grin: "Big grin",
  calm: "Calm",
  surprised: "Surprised",
  wink: "Wink",
  fierce: "Fierce",
  smirk: "Smirk",
  sleepy: "Sleepy",
};

// Features (any number at once).
export const FEATURES = ["beard", "mustache", "stubble", "freckles", "blush", "scar", "mole"] as const;
export type Feature = (typeof FEATURES)[number];
export const FEATURE_NAMES: Record<Feature, string> = {
  beard: "Beard",
  mustache: "Mustache",
  stubble: "Stubble",
  freckles: "Freckles",
  blush: "Rosy cheeks",
  scar: "Scar",
  mole: "Beauty mark",
};

// An accessory (one, or none).
export const ACCESSORIES = ["none", "spectacles", "round", "sunglasses", "monocle", "eyepatch", "goggles", "earrings"] as const;
export type Accessory = (typeof ACCESSORIES)[number];
export const ACCESSORY_NAMES: Record<Accessory, string> = {
  none: "None",
  spectacles: "Spectacles",
  round: "Round glasses",
  sunglasses: "Sunglasses",
  monocle: "Monocle",
  eyepatch: "Eyepatch",
  goggles: "Goggles",
  earrings: "Earrings",
};

export const OUTFITS = ["robe", "tunic", "cloak", "scholar", "battlemage", "archmage"] as const;
export type Outfit = (typeof OUTFITS)[number];
export const OUTFIT_NAMES: Record<Outfit, string> = {
  robe: "Wizard's robe",
  tunic: "Tunic and boots",
  cloak: "Hooded cloak",
  scholar: "Scholar's vest",
  battlemage: "Battlemage armor",
  archmage: "Archmage regalia",
};
// Outfits that must be unlocked first (ids in unlocks.ts).
export const LOCKED_OUTFITS: Partial<Record<Outfit, string>> = { battlemage: "outfit:battlemage", archmage: "outfit:archmage" };

export type Appearance = { skin: Skin; hair: Hair; hairColor: HairColor; face: Face; features: Feature[]; acc: Accessory; outfit: Outfit };
export const DEFAULT_APPEARANCE: Appearance = { skin: "light", hair: "short", hairColor: "brown", face: "smile", features: [], acc: "none", outfit: "robe" };

// A random look (bots, academy students), from a seed so it stays the same.
export function randomAppearance(seed: number): Appearance {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)];
  return {
    skin: pick(SKINS.slice(0, 18)),
    hair: pick(HAIRS),
    hairColor: pick(HAIR_COLORS.slice(0, 8)),
    face: pick(FACES),
    features: FEATURES.filter(() => r() < 0.15),
    acc: r() < 0.25 ? pick(ACCESSORIES.slice(1)) : "none",
    outfit: pick(["robe", "robe", "tunic", "cloak", "scholar"] as const),
  };
}

// Keep valid choices; anything else falls back to the default. Locked
// outfits need their unlock.
export function sanitizeAppearance(raw: Record<string, unknown>, unlocked: Set<string>): Appearance {
  const one = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
    typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : fallback;
  let outfit = one(raw.outfit, OUTFITS, DEFAULT_APPEARANCE.outfit);
  const needs = LOCKED_OUTFITS[outfit];
  if (needs && !unlocked.has(needs)) outfit = DEFAULT_APPEARANCE.outfit;
  // Saved before faces had features and accessories: "bearded", "freckled"
  // and "spectacled" were faces of their own.
  const features = Array.isArray(raw.features) ? FEATURES.filter((f) => (raw.features as unknown[]).includes(f)) : [];
  let acc = one(raw.acc, ACCESSORIES, DEFAULT_APPEARANCE.acc);
  if (raw.face === "bearded" && !features.includes("beard")) features.push("beard");
  if (raw.face === "freckled" && !features.includes("freckles")) features.push("freckles");
  if (raw.face === "spectacled" && acc === "none") acc = "spectacles";
  return {
    skin: one(raw.skin, SKINS, DEFAULT_APPEARANCE.skin),
    hair: one(raw.hair, HAIRS, DEFAULT_APPEARANCE.hair),
    hairColor: one(raw.hairColor, HAIR_COLORS, DEFAULT_APPEARANCE.hairColor),
    face: one(raw.face, FACES, DEFAULT_APPEARANCE.face),
    features,
    acc,
    outfit,
  };
}

// Battle royale classes: Knight, Rogue, Wizard and Cleric. Each has its own health,
// speed and defense, a main-hand weapon and a backup (swap with 1/2 or the
// mouse wheel). Shared so the client can show and predict them; the server
// enforces every number.
//
// Balance idea: the Knight wins up close and soaks damage but is slow; the
// Rogue wins at range and moves fast but is fragile; the Wizard is in the
// middle, with a spell for range and a staff for close calls; the Cleric
// hits softer than all of them but heals (themselves, and teammates in a
// team round or a boss fight) and smites groups.

export type ClassId = "knight" | "rogue" | "wizard" | "cleric" | "druid" | "monk";
export type Hand = "main" | "backup";
export type WeaponId = "sword" | "shield" | "bow" | "daggers" | "spell" | "staff" | "mace" | "holy" | "thorns" | "sickle" | "fists" | "guard";

export type ClassDef = {
  name: string;
  maxHealth: number;
  speed: number; // movement multiplier
  defense: number; // fraction of incoming damage ignored
  main: WeaponId;
  backup: WeaponId;
  blurb: string;
};

export const CLASSES: Record<ClassId, ClassDef> = {
  knight: {
    name: "Knight",
    maxHealth: 180,
    speed: 0.92,
    defense: 0.15,
    main: "sword",
    backup: "shield",
    blurb: "Tough and slow. Sword up close, shield to block.",
  },
  rogue: {
    name: "Rogue",
    maxHealth: 85,
    speed: 1.12,
    defense: 0,
    main: "bow",
    backup: "daggers",
    blurb: "Fast and fragile. Bow from afar, daggers (double from behind) up close.",
  },
  wizard: {
    name: "Wizard",
    maxHealth: 100,
    speed: 1,
    defense: 0,
    main: "spell",
    backup: "staff",
    blurb: "In between. Your Spellbook spell at range, a staff up close.",
  },
  cleric: {
    name: "Cleric",
    maxHealth: 120,
    speed: 0.97,
    defense: 0.1,
    main: "mace",
    backup: "holy",
    blurb: "The healer. A mace up close, holy light at range; heals and smites.",
  },
  druid: {
    name: "Druid",
    maxHealth: 105,
    speed: 1,
    defense: 0.05,
    main: "thorns",
    backup: "sickle",
    blurb: "Calls beasts to fight for them. Thorns at range, a sickle up close.",
  },
  monk: {
    name: "Monk",
    maxHealth: 90,
    speed: 1.55,
    defense: 0,
    main: "fists",
    backup: "guard",
    blurb: "The fastest class. Lightning fists, a guard that halves damage, dashes and dodges.",
  },
};

export const CLASS_IDS = Object.keys(CLASSES) as ClassId[];

export type MeleeDef = {
  kind: "melee";
  damage: number;
  reach: number; // meters, from your eyes to their body
  arcDeg: number; // how wide in front of you it hits
  cooldownMs: number;
  cleave?: boolean; // hits everyone in the arc (else just the nearest)
  backstab?: number; // damage multiplier when hitting someone from behind
};

export type WeaponDef = {
  name: string;
  // melee: swing; projectile: shoots `projectile` (shared/src/combat.ts SPELLS);
  // spell: the Spellbook spell; shield: blocks, and bashes on click.
  kind: "melee" | "projectile" | "spell" | "shield";
  melee?: MeleeDef;
  projectile?: "arrow" | "holy" | "thorn";
  // Shield: while it's in your hand, damage from in front of you (within
  // blockArcDeg) is cut by `block`, and you move slower.
  block?: number;
  blockArcDeg?: number;
  moveSpeed?: number;
};

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  sword: { name: "Sword", kind: "melee", melee: { kind: "melee", damage: 28, reach: 2.8, arcDeg: 110, cooldownMs: 650, cleave: true } },
  shield: {
    name: "Shield",
    kind: "shield",
    melee: { kind: "melee", damage: 10, reach: 2.3, arcDeg: 90, cooldownMs: 900 }, // a bash
    block: 0.8,
    blockArcDeg: 140,
    moveSpeed: 0.75,
  },
  bow: { name: "Longbow", kind: "projectile", projectile: "arrow" },
  daggers: { name: "Daggers", kind: "melee", melee: { kind: "melee", damage: 14, reach: 2.2, arcDeg: 70, cooldownMs: 350, backstab: 2 } },
  spell: { name: "Spell", kind: "spell" },
  staff: { name: "Staff", kind: "melee", melee: { kind: "melee", damage: 18, reach: 2.6, arcDeg: 90, cooldownMs: 600 } },
  mace: { name: "Mace", kind: "melee", melee: { kind: "melee", damage: 24, reach: 2.6, arcDeg: 100, cooldownMs: 700 } },
  holy: { name: "Holy Light", kind: "projectile", projectile: "holy" },
  thorns: { name: "Thorns", kind: "projectile", projectile: "thorn" },
  sickle: { name: "Sickle", kind: "melee", melee: { kind: "melee", damage: 19, reach: 2.4, arcDeg: 100, cooldownMs: 550 } },
  fists: { name: "Fists", kind: "melee", melee: { kind: "melee", damage: 11, reach: 2.1, arcDeg: 90, cooldownMs: 260 } },
  // The Monk's guard: while it's up, half of every hit is turned aside, from
  // any side, and you keep your speed; click to jab.
  guard: {
    name: "Guard Hand",
    kind: "shield",
    melee: { kind: "melee", damage: 9, reach: 2.1, arcDeg: 80, cooldownMs: 400 },
    block: 0.5,
    blockArcDeg: 360,
  },
};

// Classes bots play (the Cleric's healing is beyond them).
export const BOT_CLASSES: ClassId[] = ["knight", "rogue", "wizard"];

// Swapping hands takes a moment, so it can't be used to skip a cooldown.
export const SWAP_MS = 400;

export function weaponOf(cls: ClassId, hand: Hand): WeaponId {
  return hand === "main" ? CLASSES[cls].main : CLASSES[cls].backup;
}

// Movement multiplier for a class holding a hand (the shield slows you).
export function moveSpeed(cls: ClassId, hand: Hand): number {
  return CLASSES[cls].speed * (WEAPONS[weaponOf(cls, hand)].moveSpeed ?? 1);
}

// Is `toward` (a direction from the target to the attacker, flat) within the
// arc in front of someone facing `yaw`? Yaw 0 faces -Z.
export function inFront(yaw: number, toward: [number, number], arcDeg: number): boolean {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const len = Math.hypot(toward[0], toward[1]);
  if (len < 1e-6) return true;
  return (fx * toward[0] + fz * toward[1]) / len >= Math.cos(((arcDeg / 2) * Math.PI) / 180);
}

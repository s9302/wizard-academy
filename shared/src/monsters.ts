// Monsters you can add to the battle royale (Esc panel: Monsters + / -).
// They hunt whoever is closest, wizards and bots alike, and anyone can
// fight them. Numbers shared so the client can draw health bars and sizes.

import type { SpellId } from "./combat.ts";

export type MonsterKind = "slime" | "wolf" | "golem" | "imp" | "skeleton" | "zombie" | "witch" | "dragon";
export const MONSTER_KINDS: MonsterKind[] = ["slime", "wolf", "skeleton", "zombie", "imp", "witch", "golem", "dragon"];

export type MonsterDef = {
  name: string;
  hp: number;
  speed: number; // m/s
  damage: number;
  reach: number; // meters, from its center to your center
  cooldownMs: number; // between attacks
  windupMs: number; // the attack lands this long after it starts (time to dodge)
  radius: number; // how wide it is (for being hit)
  height: number; // its center's height above the floor
  sight: number; // meters: how far it notices you
  heal: number; // health the wizard who finishes it off gets back
  // A ranged attacker: it throws `spell` at you from up to `range` (needs a
  // clear line), and backs off if you get closer than `keep`.
  ranged?: { spell: SpellId; range: number; keep: number };
};

export const MONSTERS: Record<MonsterKind, MonsterDef> = {
  slime: { name: "Slime", hp: 60, speed: 3.4, damage: 10, reach: 1.7, cooldownMs: 1300, windupMs: 450, radius: 0.75, height: 0.6, sight: 26, heal: 15 },
  wolf: { name: "Shadow Wolf", hp: 45, speed: 6.6, damage: 8, reach: 1.8, cooldownMs: 900, windupMs: 300, radius: 0.6, height: 0.7, sight: 34, heal: 15 },
  imp: { name: "Fire Imp", hp: 40, speed: 4.2, damage: 10, reach: 24, cooldownMs: 1800, windupMs: 550, radius: 0.5, height: 1.3, sight: 30, heal: 15, ranged: { spell: "ember", range: 24, keep: 9 } },
  skeleton: { name: "Skeleton", hp: 50, speed: 4.4, damage: 12, reach: 1.9, cooldownMs: 1000, windupMs: 380, radius: 0.5, height: 0.95, sight: 30, heal: 15 },
  zombie: { name: "Zombie", hp: 120, speed: 2.1, damage: 16, reach: 1.9, cooldownMs: 1500, windupMs: 550, radius: 0.55, height: 0.95, sight: 22, heal: 25 },
  // A witch on her broom: hexes from a distance (they slow you), and she keeps away.
  witch: { name: "Witch", hp: 60, speed: 4, damage: 8, reach: 22, cooldownMs: 2000, windupMs: 650, radius: 0.5, height: 1.4, sight: 30, heal: 20, ranged: { spell: "hex", range: 22, keep: 10 } },
  // A young dragon: big and tough, it breathes balls of fire from mid range.
  dragon: { name: "Dragon", hp: 320, speed: 3.2, damage: 18, reach: 20, cooldownMs: 2400, windupMs: 800, radius: 1.5, height: 1.4, sight: 32, heal: 60, ranged: { spell: "flame", range: 20, keep: 5 } },
  golem: { name: "Stone Golem", hp: 180, speed: 2.5, damage: 22, reach: 2.5, cooldownMs: 2200, windupMs: 700, radius: 1.1, height: 1.4, sight: 24, heal: 40 },
};

export const MAX_MONSTERS = 10;
// Monster ids live far above player ids, so a spell's "hit" id says which.
export const MONSTER_ID_BASE = 1_000_000;
export const isMonsterId = (id: number): boolean => id >= MONSTER_ID_BASE;

// What the client is told, ~10 times a second.
export type MonsterState = {
  id: number;
  kind: MonsterKind;
  p: [number, number, number]; // center
  ry: number;
  hp: number;
  attacking: boolean; // winding up a hit
  owner?: number; // a Druid's beast: whose (it fights for them)
  max?: number; // its full health, when it's tougher than usual (Horde)
};

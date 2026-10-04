// Monsters you can add to the battle royale (Esc panel: Monsters + / -).
// They hunt whoever is closest, wizards and bots alike, and anyone can
// fight them. Numbers shared so the client can draw health bars and sizes.

export type MonsterKind = "slime" | "wolf" | "golem";
export const MONSTER_KINDS: MonsterKind[] = ["slime", "wolf", "golem"];

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
};

export const MONSTERS: Record<MonsterKind, MonsterDef> = {
  slime: { name: "Slime", hp: 60, speed: 3.4, damage: 10, reach: 1.7, cooldownMs: 1300, windupMs: 450, radius: 0.75, height: 0.6, sight: 26, heal: 15 },
  wolf: { name: "Shadow Wolf", hp: 45, speed: 6.6, damage: 8, reach: 1.8, cooldownMs: 900, windupMs: 300, radius: 0.6, height: 0.7, sight: 34, heal: 15 },
  golem: { name: "Stone Golem", hp: 180, speed: 2.5, damage: 22, reach: 2.5, cooldownMs: 2200, windupMs: 700, radius: 1.1, height: 1.4, sight: 24, heal: 40 },
};

export const MAX_MONSTERS = 8;
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
};

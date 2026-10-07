// Turns raw WebSocket text into a typed message, or null if it is malformed.
// Nothing from a client is trusted until it has passed through here.

import { type AbilityId, CLASS_ABILITY_POOL } from "../../shared/src/abilities.ts";
import { SPELL_IDS, type SpellId } from "../../shared/src/combat.ts";
import type { ClientMsg, MoveMsg, Vec3 } from "../../shared/src/protocol.ts";
import { CLASS_IDS, type ClassId } from "../../shared/src/classes.ts";
import { MONSTER_KINDS, type MonsterKind } from "../../shared/src/monsters.ts";
import { allUnlocks, type Hat, HATS, type PrimarySpell, PRIMARY_SPELLS, type Robe, ROBES } from "../../shared/src/unlocks.ts";
import { sanitizeAppearance } from "../../shared/src/appearance.ts";

// The world is small; anything outside this box is garbage or an attack.
const MAX_COORD = 1000;

const ROOM_PATTERN = /^[a-z0-9-]{1,32}$/;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isVec3(v: unknown): v is Vec3 {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => isFiniteNumber(n) && Math.abs(n) <= MAX_COORD)
  );
}

export function parseClientMsg(raw: string): ClientMsg | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const msg = data as Record<string, unknown>;

  switch (msg.t) {
    case "hello": {
      if (typeof msg.room !== "string" || !ROOM_PATTERN.test(msg.room)) return null;
      if (msg.from === undefined) return { t: "hello", room: msg.room };
      if (typeof msg.from !== "string" || !ROOM_PATTERN.test(msg.from)) return null;
      return { t: "hello", room: msg.room, from: msg.from };
    }
    case "move": {
      // Clients wrap yaw into -PI..PI before sending.
      if (!isVec3(msg.p) || !isFiniteNumber(msg.ry) || Math.abs(msg.ry) > 4) return null;
      if (!Number.isSafeInteger(msg.tp) || (msg.tp as number) < 0) return null;
      if (msg.c !== undefined && msg.c !== true) return null;
      const move: MoveMsg = { t: "move", p: [msg.p[0], msg.p[1], msg.p[2]], ry: msg.ry, tp: msg.tp as number };
      if (msg.c) move.c = true;
      return move;
    }
    case "respawn":
      return { t: "respawn" };
    case "restart":
      return { t: "restart" };
    case "bots":
      if (msg.action !== "add" && msg.action !== "remove") return null;
      return { t: "bots", action: msg.action };
    case "attack": {
      if (!isVec3(msg.o) || !isVec3(msg.d) || !Number.isSafeInteger(msg.seq) || (msg.seq as number) < 0) return null;
      const len = Math.hypot(msg.d[0], msg.d[1], msg.d[2]);
      if (len < 0.9 || len > 1.1) return null;
      return { t: "attack", o: [msg.o[0], msg.o[1], msg.o[2]], d: [msg.d[0] / len, msg.d[1] / len, msg.d[2] / len], seq: msg.seq as number };
    }
    case "ability": {
      if (msg.slot !== 0 && msg.slot !== 1) return null;
      if (!isVec3(msg.o) || !isVec3(msg.d)) return null;
      const len = Math.hypot(msg.d[0], msg.d[1], msg.d[2]);
      if (len < 0.9 || len > 1.1) return null;
      return { t: "ability", slot: msg.slot, o: [msg.o[0], msg.o[1], msg.o[2]], d: [msg.d[0] / len, msg.d[1] / len, msg.d[2] / len] };
    }
    case "ready":
      return { t: "ready" };
    case "usePowerup":
      return { t: "usePowerup" };
    case "unstuck":
      return { t: "unstuck" };
    case "chaseSetting":
      if (msg.grapple !== undefined && typeof msg.grapple !== "boolean") return null;
      if (msg.powerups !== undefined && typeof msg.powerups !== "boolean") return null;
      if (msg.grapple === undefined && msg.powerups === undefined) return null;
      return { t: "chaseSetting", grapple: msg.grapple as boolean | undefined, powerups: msg.powerups as boolean | undefined };
    case "grapple": {
      if (!isVec3(msg.d)) return null;
      const len = Math.hypot(msg.d[0], msg.d[1], msg.d[2]);
      if (len < 0.9 || len > 1.1) return null;
      return { t: "grapple", d: [msg.d[0] / len, msg.d[1] / len, msg.d[2] / len] };
    }
    case "chaseMap":
      if (typeof msg.map !== "string" || !ROOM_PATTERN.test(msg.map)) return null;
      return { t: "chaseMap", map: msg.map };
    case "mode":
      if (msg.mode !== "ffa" && msg.mode !== "teams") return null;
      return { t: "mode", mode: msg.mode };
    case "pickTeam":
      if (msg.team !== 0 && msg.team !== 1 && msg.team !== null) return null;
      return { t: "pickTeam", team: msg.team };
    case "botSet": {
      if (!Number.isSafeInteger(msg.id)) return null;
      const out: { t: "botSet"; id: number; cls?: ClassId; team?: 0 | 1 } = { t: "botSet", id: msg.id as number };
      if (msg.cls !== undefined) {
        if (!CLASS_IDS.includes(msg.cls as ClassId)) return null;
        out.cls = msg.cls as ClassId;
      }
      if (msg.team !== undefined) {
        if (msg.team !== 0 && msg.team !== 1) return null;
        out.team = msg.team;
      }
      return out;
    }
    case "vote":
      if (typeof msg.arena !== "string" || !ROOM_PATTERN.test(msg.arena)) return null;
      return { t: "vote", arena: msg.arena };
    case "hand":
      if (msg.hand !== "main" && msg.hand !== "backup") return null;
      return { t: "hand", hand: msg.hand };
    case "class":
      if (!CLASS_IDS.includes(msg.cls as ClassId)) return null;
      return { t: "class", cls: msg.cls as ClassId };
    case "abilities": {
      // Shape only; whether they're this class's and unlocked is checked when used.
      if (!CLASS_IDS.includes(msg.cls as ClassId)) return null;
      const pool = CLASS_ABILITY_POOL[msg.cls as ClassId] as string[];
      if (typeof msg.e !== "string" || typeof msg.r !== "string" || !pool.includes(msg.e) || !pool.includes(msg.r) || msg.e === msg.r) return null;
      return { t: "abilities", cls: msg.cls as ClassId, e: msg.e as AbilityId, r: msg.r as AbilityId };
    }
    case "cast": {
      // Arrows only come from the bow ("attack"), never cast directly.
      if (!SPELL_IDS.includes(msg.spell as SpellId) || msg.spell === "arrow" || msg.spell === "holy" || msg.spell === "thorn" || msg.spell === "ember" || msg.spell === "hex" || msg.spell === "flame" || !isVec3(msg.o) || !isVec3(msg.d)) return null;
      if (!Number.isSafeInteger(msg.seq) || (msg.seq as number) < 0) return null;
      // Direction must be (roughly) a unit vector; the server renormalizes it.
      const len = Math.hypot(msg.d[0], msg.d[1], msg.d[2]);
      if (len < 0.9 || len > 1.1) return null;
      const d: Vec3 = [msg.d[0] / len, msg.d[1] / len, msg.d[2] / len];
      return { t: "cast", spell: msg.spell as SpellId, o: [msg.o[0], msg.o[1], msg.o[2]], d, seq: msg.seq as number };
    }
    case "loadout": {
      // Shape only; whether each choice is unlocked is checked when saving.
      if (!PRIMARY_SPELLS.includes(msg.primary as PrimarySpell)) return null;
      if (!HATS.includes(msg.hat as Hat) || !ROBES.includes(msg.robe as Robe)) return null;
      // Appearance: unknown values fall back to defaults (older clients send none).
      const look = sanitizeAppearance(msg, allUnlocks());
      return { t: "loadout", primary: msg.primary as PrimarySpell, hat: msg.hat as Hat, robe: msg.robe as Robe, ...look };
    }
    case "monsters":
      if (msg.action !== "add" && msg.action !== "remove") return null;
      if (msg.kind !== undefined && msg.kind !== "mixed" && !MONSTER_KINDS.includes(msg.kind as MonsterKind)) return null;
      return { t: "monsters", action: msg.action, kind: (msg.kind as MonsterKind | "mixed" | undefined) ?? "mixed" };
    case "tag":
      if (!Number.isSafeInteger(msg.target) || (msg.target as number) < 1) return null;
      return { t: "tag", target: msg.target as number };
    default:
      return null;
  }
}

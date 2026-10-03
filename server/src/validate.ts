// Turns raw WebSocket text into a typed message, or null if it is malformed.
// Nothing from a client is trusted until it has passed through here.

import type { ClientMsg, Vec3 } from "../../shared/src/protocol.ts";

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
      return { t: "move", p: [msg.p[0], msg.p[1], msg.p[2]], ry: msg.ry, tp: msg.tp as number };
    }
    case "respawn":
      return { t: "respawn" };
    case "restart":
      return { t: "restart" };
    case "bots":
      if (msg.action !== "add" && msg.action !== "remove") return null;
      return { t: "bots", action: msg.action };
    case "tag":
      if (!Number.isSafeInteger(msg.target) || (msg.target as number) < 1) return null;
      return { t: "tag", target: msg.target as number };
    default:
      return null;
  }
}

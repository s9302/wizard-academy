// Levels are plain data shared by client and server. The client turns the
// boxes into meshes and physics colliders; the server only needs the zones
// (checkpoints, finish...) and spawn points to judge the rules.

import type { Vec3 } from "../protocol.ts";

export type Box = {
  pos: Vec3; // center
  size: Vec3; // full width, height, depth
  color: string;
  rot?: Vec3; // euler angles in radians
};

// An axis-aligned box in space, used as a trigger area.
export type Zone = { min: Vec3; max: Vec3 };

export type Checkpoint = {
  zone: Zone;
  respawn: Vec3; // where you reappear after falling (capsule center)
  marker: Vec3; // where the checkpoint crystal floats (client decoration)
};

export type Course = {
  start: Zone; // leaving this starts the timer; walking back in resets it
  checkpoints: Checkpoint[]; // must be reached in order
  finish: Zone;
};

// A doorway to another room (hub only). Walking into the opening takes you
// there; the client detects it, since any room is open to join anyway.
export type Portal = {
  room: string; // room id it leads to (shared/src/rooms.ts)
  pos: Vec3; // center of the opening, at floor level
  yaw: number; // the way its front faces, radians (same convention as spawnYaw)
  color: string;
};

// Opening size, shared by the level geometry, the visuals and inPortal().
export const PORTAL_WIDTH = 3.6;
export const PORTAL_HEIGHT = 4.6;
export const PORTAL_STEP = 0.3; // the stone step in front of and under the opening

export type Level = {
  id: string; // also the room name
  name: string;
  spawn: Vec3; // capsule center; players spread out around it
  spawnSpread: number; // random offset radius, meters
  spawnYaw?: number; // direction you face on joining, radians (0 = north, -Z)
  spawnPoints?: Vec3[]; // if set, players spawn at a random one of these instead
  killY: number; // falling below this height means you fell off
  sky: string;
  boxes: Box[];
  course?: Course; // parkour levels only
  portals?: Portal[]; // the hub only
  pickupSpots?: Vec3[]; // battle royale: where pickups appear
};

// A point relative to a portal: `side` meters to its right (as seen walking
// in), `up` above its floor, `out` in front of it. yaw 0 faces -Z, like the
// camera, so front = (-sin yaw, -cos yaw) and right = (cos yaw, -sin yaw).
export function portalPoint(portal: Portal, side: number, up: number, out: number): Vec3 {
  const s = Math.sin(portal.yaw);
  const c = Math.cos(portal.yaw);
  return [portal.pos[0] + c * side - s * out, portal.pos[1] + up, portal.pos[2] - s * side - c * out];
}

// Is a player (capsule center) inside the portal's opening? A thin slab just
// behind the front face; the back wall stops anyone walking in from behind.
export function inPortal(p: Vec3, portal: Portal): boolean {
  const dx = p[0] - portal.pos[0];
  const dz = p[2] - portal.pos[2];
  const s = Math.sin(portal.yaw);
  const c = Math.cos(portal.yaw);
  const out = -s * dx - c * dz;
  const side = c * dx - s * dz;
  const up = p[1] - portal.pos[1];
  return Math.abs(side) < PORTAL_WIDTH / 2 - 0.2 && out > -0.6 && out < 0.35 && up > 0 && up < PORTAL_HEIGHT;
}

export function inZone(p: Vec3, zone: Zone): boolean {
  return (
    p[0] >= zone.min[0] && p[0] <= zone.max[0] &&
    p[1] >= zone.min[1] && p[1] <= zone.max[1] &&
    p[2] >= zone.min[2] && p[2] <= zone.max[2]
  );
}

// Positions arrive 20 times a second, so a fast player can be on one side of
// a thin zone in one update and past it in the next. Check a few points along
// the way, not just the endpoints.
export function segmentTouchesZone(from: Vec3, to: Vec3, zone: Zone, steps = 6): boolean {
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p: Vec3 = [
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
    ];
    if (inZone(p, zone)) return true;
  }
  return false;
}

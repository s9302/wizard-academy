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

export type Level = {
  id: string; // also the room name
  name: string;
  spawn: Vec3; // capsule center; players spread out around it
  spawnSpread: number; // random offset radius, meters
  spawnYaw?: number; // direction you face on joining, radians (0 = north, -Z)
  killY: number; // falling below this height means you fell off
  sky: string;
  boxes: Box[];
  course?: Course; // parkour levels only
};

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

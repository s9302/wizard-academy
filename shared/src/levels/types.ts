// Levels are plain data shared by client and server. The client turns the
// boxes into meshes and physics colliders; the server only needs the zones
// (checkpoints, finish...) and spawn points to judge the rules.

import type { Vec3 } from "../protocol.ts";
import type { BossKind } from "../bosses.ts";

export type Box = {
  pos: Vec3; // center
  size: Vec3; // full width, height, depth
  color: string;
  rot?: Vec3; // euler angles in radians
  // A magic barrier: only there for players who don't have this unlock yet
  // (e.g. "area:garden"). Movement is client-side, so each player's own
  // world simply leaves out the barriers they've opened.
  gate?: string;
  // A bridge or arch you can also walk under. Server-side bots plan on one
  // floor per spot, so they treat these as not there (they walk under).
  overhead?: boolean;
  // Glows (windows, crystals, lava): drawn unlit and this many times as
  // bright, so the Ultra setting's bloom makes it shine.
  glow?: number;
  // Solid but not drawn: a prop (a tree, say) stands where it is.
  invisible?: boolean;
};

// Decoration the client draws; the server never looks at it. Anything solid
// about a prop is a separate (often invisible) box.
export type PropKind =
  | "tree" // round, leafy
  | "pine"
  | "bush"
  | "rock"
  | "flowers" // a bed of flowers, size = [width, depth]
  | "torch" // a standing torch (pos = its foot); light: also a real light on Ultra
  | "sconce" // a torch on a wall (pos = the flame), facing yaw
  | "lamp" // a lantern on a post (pos = its foot)
  | "banner" // hangs from pos (its top middle), facing yaw; size = [width, height]
  | "cone" // a pointed roof: pos = its base center, size = [radius, height]
  | "water" // animated water surface at pos, size = [width, depth]
  | "fountain" // spray rising from pos
  | "crystal" // a glowing, slowly spinning crystal
  | "window" // stained glass at pos facing yaw, size = [width, height]
  | "student" // an academy student wandering near pos (client-side only)
  | "npc"; // someone to talk to (see `talk`)

export type Prop = {
  kind: PropKind;
  pos: Vec3;
  yaw?: number;
  scale?: number;
  color?: string;
  size?: [number, number];
  light?: boolean;
  // For "npc": their name and look, and the id of their lines (shared/src/npcs.ts).
  name?: string;
  talk?: string;
  look?: string; // an outfit preset id
};

// Something to walk up to and press E at (hub only).
export type Station = {
  id: string;
  kind: "spellbook" | "wardrobe" | "chronicle" | "tablet";
  pos: Vec3; // on the floor in front of it
  label: string;
  tablet?: string; // which lore text (shared/src/story.ts TABLETS)
};

// A floating sign. If `unlock` is set and the player doesn't have it, the
// sign says how to get it.
// onlyLocked: show it only until the unlock (e.g. a portal that has its own sign).
export type Label = { pos: Vec3; title: string; subtitle?: string; color: string; unlock?: string; onlyLocked?: boolean };

// A warm light (indoors, where the sun doesn't reach).
export type PointLightDef = { pos: Vec3; color: string; intensity: number; distance: number };

// An axis-aligned box in space, used as a trigger area.
export type Zone = { min: Vec3; max: Vec3 };

// ---- Arena features (Phase 16) ----

// A ladder against a wall. pos: the bottom middle, at the wall's face, on
// the floor; yaw: the way you face while climbing (toward the wall).
// Walk into it holding W to climb, S to go down, Space to let go.
export type Ladder = { pos: Vec3; height: number; yaw: number; width?: number };
// A teleporter pad on the floor at pos; stepping on it sends you to `to`
// (capsule center), facing yaw. Each pad goes one way: pair them up.
export type Teleporter = { pos: Vec3; to: Vec3; yaw?: number; color?: string };
// A pool of lava or a void on the floor: pos is the middle of its surface.
// Touch it and you're out (or back to the start, outside the arena).
export type Pit = { pos: Vec3; size: [number, number]; kind: "lava" | "void" };
// A jump pad on the floor: throws you straight up at `power` m/s.
export type JumpPad = { pos: Vec3; power: number };

export const TELEPORT_RADIUS = 0.9;
export const PAD_RADIUS = 1.0;
export const CLIMB_SPEED = 3.2;
const FEET = 0.9; // capsule center to feet

// Is a player (capsule center p) on the ladder?
export function onLadder(p: Vec3, l: Ladder): boolean {
  const s = Math.sin(l.yaw);
  const c = Math.cos(l.yaw);
  const dx = p[0] - l.pos[0];
  const dz = p[2] - l.pos[2];
  const out = s * dx + c * dz; // how far in front of the wall (opposite the facing)
  const side = c * dx - s * dz;
  const up = p[1] - FEET - l.pos[1];
  return Math.abs(side) < (l.width ?? 1) / 2 + 0.25 && out > -0.3 && out < 0.95 && up > -0.3 && up < l.height + 0.2;
}

// Standing on a round pad?
export function onPad(p: Vec3, pos: Vec3, radius: number): boolean {
  const feet = p[1] - FEET - pos[1];
  return Math.hypot(p[0] - pos[0], p[2] - pos[2]) < radius && feet > -0.3 && feet < 0.6;
}

// Touching a pit? (A little inside its edge, so brushing the lip is safe.)
export function inPit(p: Vec3, pit: Pit): boolean {
  const feet = p[1] - FEET - pit.pos[1];
  return Math.abs(p[0] - pit.pos[0]) < pit.size[0] / 2 - 0.25 && Math.abs(p[2] - pit.pos[2]) < pit.size[1] / 2 - 0.25 && feet < 0.2 && feet > -3;
}

export type Checkpoint = {
  zone: Zone;
  respawn: Vec3; // where you reappear after falling (capsule center)
  marker: Vec3; // where the checkpoint crystal floats (client decoration)
};

// Something a trial asks of you besides reaching the finish (Phase 16).
// All of a course's tasks must be done before its finish counts.
export type Task =
  // Fly through every one of these glowing orbs (any order).
  | { id: string; kind: "orbs"; label: string; points: Vec3[]; color?: string }
  // Step on these rune plates (pos = plate center, on the floor) in `order`
  // (indexes into points); a wrong one resets the sequence.
  | { id: string; kind: "runes"; label: string; points: Vec3[]; symbols: string[]; order: number[] }
  // Beat this boss (shared/src/bosses.ts) in its arena.
  | { id: string; kind: "boss"; label: string; boss: BossKind; arena: Zone; home: Vec3 };

export type Course = {
  start: Zone; // leaving this starts the timer; walking back in resets it
  checkpoints: Checkpoint[]; // must be reached in order
  finish: Zone;
  tasks?: Task[];
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
  sky: string; // fallback color
  skyStyle?: "day" | "dusk" | "golden" | "night"; // the sky dome preset (client/src/Sky.ts); default day
  boxes: Box[];
  course?: Course; // parkour levels only
  portals?: Portal[]; // the hub only
  pickupSpots?: Vec3[]; // battle royale: where pickups appear
  stations?: Station[]; // the hub only
  labels?: Label[];
  lights?: PointLightDef[];
  props?: Prop[];
  ladders?: Ladder[];
  teleporters?: Teleporter[];
  pits?: Pit[];
  jumpPads?: JumpPad[];
  // Battle royale arenas: size class, and the storm's starting radius and
  // how much to scale its stages (1 = the medium arena).
  arena?: { size: "small" | "medium" | "large"; stormRadius: number; stormScale: number };
  bossFight?: { boss: BossKind; home: Vec3 }; // a boss room (Trial VII): where the boss starts
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

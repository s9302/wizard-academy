// Checks every battle royale arena (shared/src/levels/arenas.ts) and Trial VII:
//  - each spawn point is open floor (not inside anything) the bots can reach;
//  - each pickup sits on a floor the bots can reach;
//  - a walker using the game's real movement (Rapier, the PlayerController)
//    can follow the bots' route from the first spawn to every pickup: up the
//    ramps, onto the towers and roofs. If it can, players and bots can.
//
//   node client/scripts/walk-arenas.ts [arenaId]

import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { ARENAS as ROYALE_ARENAS } from "../../shared/src/levels/arenas.ts";
import { skyrun } from "../../shared/src/levels/parkour.ts";
import { trial7 } from "../../shared/src/levels/trial7.ts";

// The battle royale arenas, and Trial VII (a boss fight in the same kind of arena).
const ARENAS = [...ROYALE_ARENAS, trial7, skyrun];
import type { Level } from "../../shared/src/levels/types.ts";
import type { Vec3 } from "../../shared/src/protocol.ts";
import { NavGrid } from "../../server/src/bots/NavGrid.ts";
import { PlayerController } from "../src/PlayerController.ts";
import type { Input } from "../src/Input.ts";

await RAPIER.init();
const only = process.argv[2];
let failures = 0;
const fail = (what: string) => {
  console.log(`FAIL ${what}`);
  failures++;
};

function world(level: Level): RAPIER.World {
  const w = new RAPIER.World({ x: 0, y: -20, z: 0 });
  for (const box of level.boxes) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(box.rot ?? [0, 0, 0])));
    w.createCollider(
      RAPIER.ColliderDesc.cuboid(box.size[0] / 2, box.size[1] / 2, box.size[2] / 2)
        .setTranslation(...box.pos)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    );
  }
  w.step();
  return w;
}

const DT = 1 / 60;

for (const level of ARENAS) {
  if (only && level.id !== only) continue;
  const grid = new NavGrid(level);
  const w = world(level);
  const start = level.spawnPoints![0];
  let problems = 0;
  const bad = (what: string) => {
    fail(`${level.id}: ${what}`);
    problems++;
  };

  // Spawns: on the floor, not stuck in anything, reachable by bots.
  for (const s of level.spawnPoints!) {
    const floor = grid.floorAt(s[0], s[2]);
    if (Math.abs(s[1] - 1 - floor) > 0.05) bad(`spawn ${s} is not on the floor (floor ${floor})`);
    if (!level.noBots && !grid.findPath([start[0], start[2]], [s[0], s[2]])) bad(`spawn ${s} unreachable for bots`);
    const p = new PlayerController(w, level.killY);
    p.teleport(...s);
    const input = { yaw: 0, pitch: 0, forward: 0, strafe: 0, running: false, consumeJump: () => false, consumeRestart: () => false };
    for (let t = 0; t < 0.5; t += DT) p.step(DT, input as unknown as Input);
    if (Math.hypot(p.position.x - s[0], p.position.z - s[2]) > 0.3 || p.position.y < s[1] - 0.5) bad(`spawn ${s} pushes the player out (${p.position.toArray().map((n) => n.toFixed(1))})`);
  }

  // Pickups: bots can get there, and so can the real movement. (Parkour maps
  // have no bots, and getting there is the parkour: only spawns are checked.)
  for (const pk of level.noBots ? [] : level.pickupSpots!) {
    const floor = grid.floorAt(pk[0], pk[2]);
    if (Math.abs(pk[1] - 0.9 - floor) > 0.05) bad(`pickup ${pk} floats (floor there is ${floor})`);
    // (Ramps only: the walker can't climb ladders, ride pads or teleport.)
    const path = grid.findPath([start[0], start[2]], [pk[0], pk[2]], false);
    const end = path?.at(-1);
    if (!path || !end || Math.hypot(end[0] - pk[0], end[1] - pk[2]) > 1.4) {
      bad(`pickup ${pk} unreachable for bots`);
      continue;
    }
    // (A fresh world each time: no walkers left over from before.)
    if (!walkPath(world(level), level, start, path, pk)) bad(`pickup ${pk}: the real movement couldn't follow the route there`);
  }
  console.log(`${problems ? "FAIL" : "ok  "} ${level.id} (${level.arena?.size}): ${level.spawnPoints!.length} spawns, ${level.pickupSpots!.length} pickups, ${level.boxes.length} boxes`);
}

// Follow the bots' waypoints with the real controller (running, hopping
// ledges when stuck). True if it ends up at the pickup.
function walkPath(w: RAPIER.World, level: Level, from: Vec3, path: [number, number][], goal: Vec3): boolean {
  const player = new PlayerController(w, level.killY);
  player.teleport(...from);
  let jump = false;
  const input = {
    yaw: 0,
    pitch: 0,
    forward: 1,
    strafe: 0,
    running: true,
    consumeJump: () => {
      const j = jump;
      jump = false;
      return j;
    },
    consumeRestart: () => false,
  };
  const points = [...path, [goal[0], goal[2]] as [number, number]];
  let i = 0;
  let lastProgress = 0;
  let best = Infinity;
  let stuckCount = 0;
  let sidestepUntil = 0;
  for (let t = 0; t < 90 && i < points.length; t += DT) {
    const [x, z] = points[i];
    const p = player.position;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < 0.45) {
      i++;
      continue;
    }
    input.forward = 1;
    input.running = d > 1.5;
    input.yaw = Math.atan2(-(x - p.x), -(z - p.z));
    input.strafe = t < sidestepUntil ? (stuckCount % 4 < 2 ? 1 : -1) : 0;
    if (d < best - 0.05) {
      best = d;
      lastProgress = t;
    } else if (t - lastProgress > 0.6) {
      // Stuck: hop (a ledge), or sidestep (a corner), like a person would.
      stuckCount++;
      if (stuckCount % 2) jump = true;
      else sidestepUntil = t + 0.4;
      lastProgress = t;
    }
    if (i > 0 && points[i - 1] && d > best + 0.5) best = d; // new waypoint
    player.step(DT, input as unknown as Input);
    if (player.fellOut) return false;
    const g = player.position;
    if (Math.hypot(g.x - goal[0], g.z - goal[2]) < 1.3 && Math.abs(g.y - goal[1]) < 0.7) return true;
    if (d !== Math.hypot(x - g.x, z - g.z) && i < points.length && Math.hypot(points[i][0] - g.x, points[i][1] - g.z) < 0.45) best = Infinity;
  }
  const g = player.position;
  return Math.hypot(g.x - goal[0], g.z - goal[2]) < 1.3 && Math.abs(g.y - goal[1]) < 0.7;
}

console.log(failures ? `${failures} FAILED` : "ALL PASSED");
process.exit(failures ? 1 : 0);

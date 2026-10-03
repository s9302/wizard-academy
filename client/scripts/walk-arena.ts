// Checks the battle royale arena and the spell-vs-wall math:
//  1. segmentHitsBox (shared/src/levels/geometry.ts, used by the server to
//     stop spells at walls) agrees with Rapier's ray casts on random rotated
//     boxes.
//  2. A bot using the real PlayerController can walk up every tower ramp and
//     onto the dais, where pickups appear.
//  3. Every spawn point and pickup spot is open ground the server-side bots'
//     NavGrid can reach.
//
//   node client/scripts/walk-arena.ts

import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { arena } from "../../shared/src/levels/arena.ts";
import { segmentHitsBox } from "../../shared/src/levels/geometry.ts";
import type { Box } from "../../shared/src/levels/types.ts";
import type { Vec3 } from "../../shared/src/protocol.ts";
import { NavGrid } from "../../server/src/bots/NavGrid.ts";
import { PlayerController } from "../src/PlayerController.ts";
import type { Input } from "../src/Input.ts";

await RAPIER.init();
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
};

function collider(world: RAPIER.World, box: Box): RAPIER.Collider {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(box.rot ?? [0, 0, 0])));
  return world.createCollider(
    RAPIER.ColliderDesc.cuboid(box.size[0] / 2, box.size[1] / 2, box.size[2] / 2)
      .setTranslation(...box.pos)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
  );
}

// ---- 1. Segment vs box, against Rapier ----
{
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  let mismatches = 0;
  const trials = 3000;
  for (let i = 0; i < trials; i++) {
    const box: Box = { pos: [rnd(-3, 3), rnd(-3, 3), rnd(-3, 3)], size: [rnd(0.3, 4), rnd(0.3, 4), rnd(0.3, 4)], color: "#000", rot: [rnd(-1.5, 1.5), rnd(-3, 3), rnd(-1.5, 1.5)] };
    const c = collider(world, box);
    world.step();
    const from: Vec3 = [rnd(-8, 8), rnd(-8, 8), rnd(-8, 8)];
    const to: Vec3 = [rnd(-8, 8), rnd(-8, 8), rnd(-8, 8)];
    const len = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const dir = { x: (to[0] - from[0]) / len, y: (to[1] - from[1]) / len, z: (to[2] - from[2]) / len };
    const hit = c.castRay(new RAPIER.Ray({ x: from[0], y: from[1], z: from[2] }, dir), len, true);
    const mine = segmentHitsBox(from, to, box);
    const theirs = hit < 0 ? null : hit / len; // Rapier returns -1 for a miss
    if ((mine === null) !== (theirs === null) || (mine !== null && theirs !== null && Math.abs(mine - theirs) * len > 0.01)) mismatches++;
    world.removeCollider(c, false);
  }
  check(mismatches === 0, `segmentHitsBox matches Rapier on ${trials} random rotated boxes (${mismatches} mismatches)`);
}

// ---- 2. Walking the arena with the real controller ----
const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
for (const box of arena.boxes) collider(world, box);
world.step();
const input = { yaw: 0, pitch: 0, forward: 1, strafe: 0, running: false, consumeJump: () => false, consumeRestart: () => false };
const player = new PlayerController(world, arena.killY);
const DT = 1 / 60;

function walk(waypoints: [number, number][], seconds = 20): void {
  for (const [x, z] of waypoints) {
    for (let t = 0; t < seconds; t += DT) {
      const p = player.position;
      if (Math.hypot(x - p.x, z - p.z) < 0.3) break;
      input.yaw = Math.atan2(-(x - p.x), -(z - p.z));
      player.step(DT, input as unknown as Input);
    }
  }
}

for (const [sx, sz] of [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
]) {
  // From the middle of the arena to the foot of the ramp, up it, onto the top.
  player.teleport(sx * 15, 1, sz * 30);
  walk([
    [sx * 18, sz * 30],
    [sx * 30, sz * 30],
  ]);
  const p = player.position;
  check(Math.abs(p.x - sx * 30) < 0.5 && p.y > 3.6, `tower (${sx * 30}, ${sz * 30}): walked up the ramp to the top (y=${p.y.toFixed(2)})`);
}
for (const z of [-12, 12]) {
  player.teleport(0, 1, z);
  walk([[0, 0]]);
  check(player.position.y > 1.9, `dais: walked up the ${z < 0 ? "north" : "south"} ramp (y=${player.position.y.toFixed(2)})`);
}

// ---- 3. Spawn points and pickups vs the bots' NavGrid ----
const grid = new NavGrid(arena);
const reachable = (x: number, z: number) => grid.findPath([arena.spawn[0], arena.spawn[2]], [x, z]) !== null;
for (const s of arena.spawnPoints!) {
  const floor = grid.floorAt(s[0], s[2]);
  check(Math.abs(floor) < 0.05 && reachable(s[0], s[2]), `spawn (${s[0]}, ${s[2]}) is open ground bots can reach`);
}
for (const s of arena.pickupSpots!) {
  const floor = grid.floorAt(s[0], s[2]);
  const path = grid.findPath([arena.spawn[0], arena.spawn[2]], [s[0], s[2]]);
  const end = path?.at(-1);
  const close = end && Math.hypot(end[0] - s[0], end[1] - s[2]) < 1.4;
  check(Math.abs(s[1] - 0.9 - floor) < 0.05 && !!close, `pickup (${s[0]}, ${s[1]}, ${s[2]}) sits on the floor and bots can get within reach`);
}

console.log(failures ? `${failures} FAILED` : "ALL PASSED");
process.exit(failures ? 1 : 0);

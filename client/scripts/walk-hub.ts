// Checks the hub's portals with the game's real physics (Rapier, no
// rendering): a bot walks from the spawn to each portal and must trigger it;
// walking at a portal from behind must not (the back wall stops you); and
// the spot where you reappear after coming back must be clear ground,
// outside every portal.
//
//   node client/scripts/walk-hub.ts

import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { PLAYER_HALF_HEIGHT, PLAYER_RADIUS } from "../../shared/src/constants.ts";
import { academy } from "../../shared/src/levels/academy.ts";
import { inPortal, type Portal, portalPoint } from "../../shared/src/levels/types.ts";
import type { Vec3 } from "../../shared/src/protocol.ts";
import { PlayerController } from "../src/PlayerController.ts";
import type { Input } from "../src/Input.ts";

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
for (const box of academy.boxes) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(box.rot ?? [0, 0, 0])));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(box.size[0] / 2, box.size[1] / 2, box.size[2] / 2)
      .setTranslation(...box.pos)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
  );
}
world.step();

const input = {
  yaw: 0,
  pitch: 0,
  forward: 1,
  strafe: 0,
  running: false,
  consumeJump: () => false,
  consumeRestart: () => false,
};
const DT = 1 / 60;
const player = new PlayerController(world, academy.killY);
const portals = academy.portals!;
const pos = (): Vec3 => [player.position.x, player.position.y, player.position.z];
const touching = () => portals.find((p) => inPortal(pos(), p))?.room ?? null;

// Walk through waypoints (x, z); returns the first portal entered, if any.
function walk(waypoints: [number, number][], maxSeconds = 30): string | null {
  for (const [x, z] of waypoints) {
    for (let t = 0; t < maxSeconds; t += DT) {
      const p = player.position;
      if (Math.hypot(x - p.x, z - p.z) < 0.4) break;
      input.yaw = Math.atan2(-(x - p.x), -(z - p.z));
      player.step(DT, input as unknown as Input);
      const room = touching();
      if (room) return room;
    }
  }
  return null;
}

let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
};
const xz = (p: Vec3): [number, number] => [p[0], p[2]];

for (const portal of portals) {
  // From the spawn, to the south edge of the plaza, to the portal's path, and in.
  player.teleport(...academy.spawn);
  const entered = walk([[0, 10], xz(portalPoint(portal, 0, 0, 8)), xz(portalPoint(portal, 0, 0, -1))]);
  check(entered === portal.room, `walk into ${portal.room} from the spawn (entered: ${entered})`);

  // From behind, walking straight at it.
  player.teleport(...portalPoint(portal, 0, 1.2, -3));
  const fromBehind = walk([xz(portalPoint(portal, 0, 0, 2))], 4);
  const out = outOf(portal);
  check(fromBehind === null && out < -0.9, `${portal.room} can't be entered from behind (stopped ${(-out).toFixed(2)} m behind)`);

  // Where you appear when coming back (same formula as server HubRoom).
  const arrival = portalPoint(portal, 0, PLAYER_HALF_HEIGHT + PLAYER_RADIUS + 0.1, 3.5);
  player.teleport(...arrival);
  for (let t = 0; t < 1; t += DT) player.step(DT, { ...input, forward: 0 } as unknown as Input);
  const settled = pos();
  check(
    touching() === null && Math.abs(settled[1] - arrival[1]) < 0.3 && !player.fellOut,
    `${portal.room} arrival spot is clear ground (settled at y=${settled[1].toFixed(2)})`,
  );
}

// How far in front of the portal's centerline the player is (negative = behind).
function outOf(portal: Portal): number {
  const p = player.position;
  return -Math.sin(portal.yaw) * (p.x - portal.pos[0]) - Math.cos(portal.yaw) * (p.z - portal.pos[2]);
}

// The spawn itself must not be inside a portal.
player.teleport(...academy.spawn);
check(touching() === null, "spawn is outside every portal");

console.log(failures ? `${failures} FAILED` : "ALL PASSED");
process.exit(failures ? 1 : 0);

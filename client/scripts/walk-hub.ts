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

// A world as a player sees it: with every barrier (new player), or with
// the barriers they've opened left out.
function makeWorld(open: boolean | ((gate: string) => boolean)): RAPIER.World {
  const isOpen = typeof open === "function" ? open : () => open;
  const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
  for (const box of academy.boxes) {
    if (box.gate && isOpen(box.gate)) continue;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(box.rot ?? [0, 0, 0])));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(box.size[0] / 2, box.size[1] / 2, box.size[2] / 2)
        .setTranslation(...box.pos)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    );
  }
  world.step();
  return world;
}

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
// The portals: everything opened (the Sanctum's are behind its doors).
let player = new PlayerController(makeWorld(true), academy.killY);
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

// Into the academy: round the plaza, up the path and the steps, through
// the great doors into the Hall of Trials (I to III); the Sanctum (IV to
// IX) is on through the hall's inner doors.
const HALL_Z = -39;
const toHall: [number, number][] = [[0, 12], [9, 9], [11, -6], [3, -20], [0, -24], [0, -31]];
const toSanctum: [number, number][] = [...toHall, [0, -47], [0, -54], [0, -63]];
const inAcademy = (p: Portal) => p.pos[2] < -30;
const inSanctum = (p: Portal) => p.pos[2] < -50.5 || p.room === "trial9";

for (const portal of portals) {
  // From the spawn to the south edge of the plaza, around it (the pedestal
  // is in the middle) to the portal's path, and in.
  player.teleport(...academy.spawn);
  const route: [number, number][] = inSanctum(portal)
    ? [...toSanctum, xz(portalPoint(portal, 0, 0, 6)), xz(portalPoint(portal, 0, 0, -1))]
    : inAcademy(portal)
      ? [...toHall, [portal.pos[0] * 0.5, HALL_Z + 2], xz(portalPoint(portal, 0, 0, 6)), xz(portalPoint(portal, 0, 0, -1))]
      : [[0, 10], ...aroundPlaza(portal), xz(portalPoint(portal, 0, 0, 8)), xz(portalPoint(portal, 0, 0, -1))];
  const entered = walk(route);
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

// Points on a 10 m circle around the plaza, from due south to the portal's side.
function aroundPlaza(portal: Portal): [number, number][] {
  const start = Math.PI / 2;
  let delta = Math.atan2(portal.pos[2], portal.pos[0]) - start;
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  const steps = Math.ceil(Math.abs(delta) / (Math.PI / 8));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = start + (delta * i) / Math.max(steps, 1);
    return [10 * Math.cos(a), 10 * Math.sin(a)] as [number, number];
  });
}

// How far in front of the portal's centerline the player is (negative = behind).
function outOf(portal: Portal): number {
  const p = player.position;
  return -Math.sin(portal.yaw) * (p.x - portal.pos[0]) - Math.cos(portal.yaw) * (p.z - portal.pos[2]);
}

// The spawn itself must not be inside a portal.
player.teleport(...academy.spawn);
check(touching() === null, "spawn is outside every portal");

// ---- Story areas and stations ----
// Routes from the spawn: the garden and observatory gates face the plaza
// side of each corner; the sanctum is through the academy doors and on
// through the Hall of Trials' inner doors.
const stations = new Map(academy.stations!.map((st) => [st.id, st]));
const routes: Record<string, [number, number][]> = {
  spellbook: [[0, 12]],
  wardrobe: [[0, 12]],
  chronicle: [[0, 12], [-9, 9], [-11, -2]],
  garden: [[-6, 18], [-20, 27.5], [-27, 27.5]],
  observatory: [[6, 18], [20, 27.5], [28, 27.5], [32, 22], [32, 29.5]],
  sanctum: [...toHall, [0, -47], [0, -56], [-6.5, -56]],
};
const AREAS: Record<string, string> = { garden: "area:garden", observatory: "area:observatory", sanctum: "area:sanctum" };

function reaches(id: string): number {
  const st = stations.get(id)!;
  player.teleport(...academy.spawn);
  walk([...routes[id], [st.pos[0], st.pos[2]]]);
  const p = player.position;
  return Math.hypot(p.x - st.pos[0], p.z - st.pos[2]) + Math.max(0, Math.abs(p.y - 0.9 - st.pos[1]) - 0.3);
}

// Chapters IV-V not done yet: the barriers stop you walking into Trials V
// and VI (everything else open).
player = new PlayerController(makeWorld((g) => g !== "area:trial5" && g !== "area:trial6"), academy.killY);
for (const room of ["trial5", "trial6"]) {
  const portal = academy.portals!.find((p) => p.room === room)!;
  player.teleport(...academy.spawn);
  const entered = walk([...toSanctum, xz(portalPoint(portal, 0, 0, 6)), xz(portalPoint(portal, 0, 0, -1))]);
  check(entered === null, `locked: the barrier keeps you out of ${room} (entered: ${entered})`);
}

// A new player: plaza stations yes, story areas no.
player = new PlayerController(makeWorld(false), academy.killY);
for (const id of stations.keys()) {
  const miss = reaches(id);
  if (AREAS[id]) check(miss > 2.5, `locked: ${id} can't be reached (stopped ${miss.toFixed(1)} m away)`);
  else check(miss < 2.2, `${id} station can be reached (${miss.toFixed(2)} m)`);
}
// Everything opened.
player = new PlayerController(makeWorld(true), academy.killY);
for (const id of Object.keys(AREAS)) {
  const miss = reaches(id);
  check(miss < 2.2, `unlocked: ${id} tablet can be reached (${miss.toFixed(2)} m)`);
}

console.log(failures ? `${failures} FAILED` : "ALL PASSED");
process.exit(failures ? 1 : 0);

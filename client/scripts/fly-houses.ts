// Checks the brooms and the house towers with the game's real physics: from
// the spawn, a rider flies up and in through each tower's arch and lands in
// its common room; walls still stop a broom; and every tower's foot pad and
// room pad are on clear floor.
//
//   node client/scripts/fly-houses.ts

import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { academy } from "../../shared/src/levels/academy.ts";
import { HOUSE_TOWERS, TOWER_FLOOR, TOWER_UPPER } from "../../shared/src/levels/academyHouses.ts";
import { PlayerController } from "../src/PlayerController.ts";
import type { Input } from "../src/Input.ts";

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
for (const box of academy.boxes) {
  if (box.gate) continue;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(box.rot ?? [0, 0, 0])));
  world.createCollider(RAPIER.ColliderDesc.cuboid(box.size[0] / 2, box.size[1] / 2, box.size[2] / 2).setTranslation(...box.pos).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
}
world.step();
const player = new PlayerController(world, academy.killY);
const input = { yaw: 0, pitch: 0, forward: 0, strafe: 0, running: false, ascend: false, descend: false, crouch: false, consumeJump: () => false, consumeDash: () => false };
const DT = 1 / 60;
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
};
const pos = () => player.position;

// Fly to (x, y, z): climb or dive to height first, then level flight to it.
function flyTo(x: number, y: number, z: number, seconds = 30): void {
  for (let t = 0; t < seconds; t += DT) {
    const p = pos();
    const flat = Math.hypot(x - p.x, z - p.z);
    if (flat < 0.4 && Math.abs(y - p.y) < 0.4) break;
    input.yaw = Math.atan2(-(x - p.x), -(z - p.z));
    input.pitch = 0;
    input.forward = Math.abs(y - p.y) > 1.5 && flat > 3 ? 0 : flat > 0.3 ? 1 : 0;
    input.ascend = y - p.y > 0.3;
    input.descend = y - p.y < -0.3;
    player.step(DT, input as unknown as Input);
  }
  input.forward = 0;
  input.ascend = input.descend = false;
}

for (const t of HOUSE_TOWERS) {
  player.setBroom(false);
  player.teleport(...academy.spawn);
  player.setBroom(true);
  const y = TOWER_FLOOR + 1.6;
  const cruise = 42; // above the spires
  flyTo(0, cruise, 25); // up over the plaza
  flyTo(t.x, cruise, t.z + t.face * 11, 40); // out in front of the arch
  flyTo(t.x, y, t.z + t.face * 11);
  flyTo(t.x, y, t.z); // in through the arch
  const p = pos();
  check(Math.abs(p.x - t.x) < 4 && Math.abs(p.z - t.z) < 4 && p.y > TOWER_FLOOR, `${t.house}: flew in through the arch (at ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`);
  // Off the broom: land on the common room floor.
  player.setBroom(false);
  for (let s = 0; s < 1.5; s += DT) player.step(DT, input as unknown as Input);
  check(Math.abs(pos().y - (TOWER_FLOOR + 0.9)) < 0.3, `${t.house}: off the broom, standing on its floor (y ${pos().y.toFixed(2)})`);
  // Walk to the house roll.
  const st = academy.stations!.find((s) => s.house === t.house)!;
  for (let s = 0; s < 8; s += DT) {
    const p = pos();
    if (Math.hypot(st.pos[0] - p.x, st.pos[2] - p.z) < 0.3) break;
    input.yaw = Math.atan2(-(st.pos[0] - p.x), -(st.pos[2] - p.z));
    input.forward = 1;
    player.step(DT, input as unknown as Input);
  }
  input.forward = 0;
  const miss = Math.hypot(st.pos[0] - pos().x, st.pos[2] - pos().z);
  check(miss < 1.5, `${t.house}: walked to the house roll (${miss.toFixed(2)} m)`);
  // Up the stairs to the dormitory: walk to the foot of the flight (by the
  // arch, along the outer wall) and up it.
  const sx = Math.sign(t.x);
  const stairX = t.x + sx * 4.1; // the middle of the flight, across
  const zAt = (w: number) => t.z + t.face * (6 - 0.5 - w);
  const walkTo = (x: number, z: number, seconds = 8) => {
    for (let s = 0; s < seconds; s += DT) {
      const p = pos();
      if (Math.hypot(x - p.x, z - p.z) < 0.3) break;
      input.yaw = Math.atan2(-(x - p.x), -(z - p.z));
      input.forward = 1;
      player.step(DT, input as unknown as Input);
    }
    input.forward = 0;
  };
  walkTo(stairX - sx * 2.5, zAt(0.6));
  walkTo(stairX, zAt(0.6));
  walkTo(stairX, zAt(9.8));
  check(Math.abs(pos().y - (TOWER_UPPER + 0.9)) < 0.3, `${t.house}: walked up the stairs to the dormitory (y ${pos().y.toFixed(2)})`);
  walkTo(t.x - sx * 1, zAt(5));
  check(Math.abs(pos().y - (TOWER_UPPER + 0.9)) < 0.3, `${t.house}: ...and across it (y ${pos().y.toFixed(2)})`);
}

// A broom doesn't go through walls: fly at the academy's facade.
player.setBroom(false);
player.teleport(10, 3, -20);
player.setBroom(true);
flyTo(10, 3, -40, 4);
check(pos().z > -28.2, `walls stop a broom (stopped at z ${pos().z.toFixed(2)}, the facade is at -28)`);

// Teleport pads stand on clear floor: a player dropped there lands on it.
player.setBroom(false);
for (const tp of academy.teleporters ?? []) {
  player.teleport(tp.pos[0], tp.pos[1] + 1.2, tp.pos[2]);
  for (let s = 0; s < 1; s += DT) player.step(DT, input as unknown as Input);
  check(Math.abs(pos().y - (tp.pos[1] + 0.85)) < 0.3, `pad at (${tp.pos.map((v) => v.toFixed(1)).join(", ")}) is clear floor`);
  // ...and where it sends you is too.
  player.teleport(...tp.to);
  for (let s = 0; s < 1; s += DT) player.step(DT, input as unknown as Input);
  check(Math.abs(pos().y - tp.to[1]) < 0.4, `  its arrival spot is clear (settled at y ${pos().y.toFixed(2)})`);
}

console.log(failures ? `${failures} FAILED` : "ALL PASSED");
process.exit(failures ? 1 : 0);

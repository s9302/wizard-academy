// Climbs every ladder in a level with the real PlayerController: starting
// `start` m out from the wall (on whatever floor is there, or the low roof),
// running at the wall, jumping across if there's a gap, holding W. A ladder
// passes when you end up standing at its top.
//
//   node client/scripts/climb-ladders.ts [levelId] [start]

import RAPIER from "@dimforge/rapier3d-compat";
import { LEVELS } from "../../shared/src/levels/index.ts";
import { onLadder } from "../../shared/src/levels/types.ts";
import { PlayerController } from "../src/PlayerController.ts";

const levelId = process.argv[2] ?? "skyrun";
const START = Number(process.argv[3] ?? 3.3);
const level = LEVELS[levelId];
await RAPIER.init();
let fails = 0;
for (const [i, l] of (level.ladders ?? []).entries()) {
  const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
  for (const box of level.boxes) world.createCollider(RAPIER.ColliderDesc.cuboid(box.size[0] / 2, box.size[1] / 2, box.size[2] / 2).setTranslation(...box.pos));
  world.step();
  const input = { yaw: l.yaw, pitch: 0, forward: 1, strafe: 0, running: false, jump: false, consumeJump() { const j = this.jump; this.jump = false; return j; }, consumeRestart: () => false };
  const player = new PlayerController(world, level.killY);
  player.ladders = level.ladders ?? [];
  const ox = Math.sin(l.yaw), oz = Math.cos(l.yaw);
  // Drop in from above the start spot: lands on the low roof.
  const sx = l.pos[0] + ox * START, sz = l.pos[2] + oz * START;
  player.teleport(sx, l.pos[1] + l.height + 3, sz);
  input.forward = 0;
  for (let t = 0; t < 120; t++) player.step(1 / 60, input as never);
  input.forward = 1;
  const topY = l.pos[1] + l.height; // ~1.2 m over the roof
  let jumped = false;
  let best = -Infinity;
  for (let t = 0; t < 60 * 8; t++) {
    const p = player.position;
    const out = (p.x - l.pos[0]) * ox + (p.z - l.pos[2]) * oz;
    if (!jumped && out < START - 0.25) { input.jump = true; jumped = true; }
    player.step(1 / 60, input as never);
    best = Math.max(best, p.y - 0.9);
    if (p.y < level.killY) break;
    const climbing = (level.ladders ?? []).some((x) => onLadder([p.x, p.y, p.z], x));
    if (player.isGrounded && !climbing && p.y - 0.9 > topY - 1.5) {
      // Standing up there? Let go of W for a moment and see.
      input.forward = 0;
      for (let k = 0; k < 30; k++) player.step(1 / 60, input as never);
      break;
    }
  }
  const feet = player.position.y - 0.9;
  const onIt = (level.ladders ?? []).some((x) => onLadder([player.position.x, player.position.y, player.position.z], x));
  const ok = feet > topY - 1.5 && player.isGrounded && !onIt;
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ladder ${i} at (${l.pos[0].toFixed(1)}, ${l.pos[2].toFixed(1)}) floor ${l.pos[1]} height ${l.height.toFixed(1)}: feet ${feet.toFixed(2)} (highest ${best.toFixed(2)}, ladder top ${topY.toFixed(2)})`);
}
console.log(fails ? `${fails} ladder(s) failed` : "all ladders climbed");
process.exit(fails ? 1 : 0);

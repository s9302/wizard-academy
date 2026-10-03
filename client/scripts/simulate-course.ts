// Checks that a parkour course is actually beatable with the game's real
// physics: builds the level's colliders in Rapier (no rendering), then drives
// the real PlayerController with a simple bot that runs at each platform in
// order and jumps when the ground ahead runs out.
//
//   node client/scripts/simulate-course.ts [levelId] [jumpAhead] [aimErrorDeg]
//
// jumpAhead (default 0.6 m) is how far before the edge the bot jumps, and
// aimErrorDeg (default 0) skews its aim. Trying a range of each shows how much
// timing and aiming error a course forgives, i.e. how hard it is.
//
// Prints each platform reached, or where the bot fell. If the bot falls, the
// jump may still be possible for a human, but it's a sign the gap is tight.

import RAPIER from "@dimforge/rapier3d-compat";
import { LEVELS } from "../../shared/src/levels/index.ts";
import { PlayerController } from "../src/PlayerController.ts";
import type { Input } from "../src/Input.ts";

const levelId = process.argv[2] ?? "trial1";
const JUMP_AHEAD = Number(process.argv[3] ?? 0.6);
const AIM_ERROR = (Number(process.argv[4] ?? 0) * Math.PI) / 180;
const level = LEVELS[levelId];
if (!level?.course) throw new Error(`${levelId} is not a parkour level`);

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
for (const box of level.boxes) {
  world.createCollider(RAPIER.ColliderDesc.cuboid(box.size[0] / 2, box.size[1] / 2, box.size[2] / 2).setTranslation(...box.pos));
}
world.step();

// Platforms in course order: 1 m thick boxes (the finish arch is excluded).
const platforms = level.boxes
  .filter((b) => b.size[1] === 1)
  .map((b) => ({ x: b.pos[0], top: b.pos[1] + 0.5, z: b.pos[2], w: b.size[0], d: b.size[2] }));

// A stand-in for keyboard + mouse.
const input = {
  yaw: 0,
  pitch: 0,
  forward: 1,
  strafe: 0,
  running: true,
  jump: false,
  consumeJump() {
    const j = this.jump;
    this.jump = false;
    return j;
  },
  consumeRestart: () => false,
};

const player = new PlayerController(world, level.killY);
player.teleport(...level.spawn);

const DT = 1 / 60;
const onPlatform = (p: (typeof platforms)[number], x: number, y: number, z: number) =>
  Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2 && Math.abs(y - (p.top + 0.9)) < 0.3;

let target = 1; // platform 0 is the start
let time = 0;
// After landing, walk to the middle of the platform first to line up the next
// jump, like a person would (matters for narrow beams).
let centering = false;
while (target < platforms.length && time < 300) {
  const pos = player.position;
  const here = platforms[target - 1];
  if (centering && Math.hypot(here.x - pos.x, here.z - pos.z) < 0.3) centering = false;
  const goal = centering ? here : platforms[target];

  // Face where we're going (slightly off, if aim error is set; centering on a
  // platform always aims true, as a person would correct while walking).
  input.yaw = Math.atan2(-(goal.x - pos.x), -(goal.z - pos.z)) + (centering ? 0 : AIM_ERROR);

  // Run only for long gaps: the shortest edge-to-edge distance between the
  // two platforms (diagonal when they're offset on both axes).
  const prev = platforms[target - 1];
  const gapX = Math.max(0, Math.abs(goal.x - prev.x) - (goal.w + prev.w) / 2);
  const gapZ = Math.max(0, Math.abs(goal.z - prev.z) - (goal.d + prev.d) / 2);
  input.running = !centering && Math.hypot(gapX, gapZ) > 2.5;
  input.forward = centering && Math.hypot(here.x - pos.x, here.z - pos.z) < 1 ? 0.4 : 1; // ease in

  // Jump when standing and there's no ground JUMP_AHEAD m ahead (the edge).
  const ahead = { x: pos.x - Math.sin(input.yaw) * JUMP_AHEAD, y: pos.y, z: pos.z - Math.cos(input.yaw) * JUMP_AHEAD };
  const groundAhead = world.castRay(new RAPIER.Ray(ahead, { x: 0, y: -1, z: 0 }), 1.5, true, undefined, undefined, undefined, undefined);
  if (!centering && player.isGrounded && !groundAhead) input.jump = true;

  player.step(DT, input as unknown as Input);
  time += DT;

  const next = platforms[target];
  if (!centering && onPlatform(next, player.position.x, player.position.y, player.position.z)) {
    console.log(`reached platform ${target} at (${next.x}, ${next.top}, ${next.z})  t=${time.toFixed(2)} s`);
    target++;
    centering = true;
  }
  if (player.fellOut) {
    const from = platforms[target - 1];
    const to = platforms[target];
    console.log(`FELL going from platform ${target - 1} (${from.x}, ${from.top}, ${from.z}) to ${target} (${to.x}, ${to.top}, ${to.z})`);
    process.exit(1);
  }
}
console.log(target >= platforms.length ? `\ncourse complete in ${time.toFixed(2)} s (bot, no mistakes)` : "\ntimed out");
process.exit(target >= platforms.length ? 0 : 1);

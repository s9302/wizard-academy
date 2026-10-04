// Runs Trial I through the real server and checks the parkour rules: the run
// starts when you leave the start platform, checkpoints count only in order,
// the finish counts only after all of them, falling respawns you at your last
// checkpoint, and R (restart) resets the run.
//
//   GAME_PIN=... node server/scripts/parkour-check.ts http://game:8080
//
// It moves in straight lines at a legal speed. (The server checks speed, not
// whether you're standing on something; see the README's anti-cheat notes.)

import WebSocket from "ws";
import { trial1 } from "../../shared/src/levels/trial1.ts";
import { taskStops } from "./courseTasks.ts";
import type { ServerMsg, Vec3 } from "../../shared/src/protocol.ts";
import { signIn } from "./signIn.ts";

const base = (process.argv[2] ?? "http://localhost:8080").replace(/\/$/, "");
const pin = process.env.GAME_PIN;
if (!pin) {
  console.error("Set GAME_PIN in the environment.");
  process.exit(1);
}

const course = trial1.course!;
const SPEED = 7; // m/s, under RUN_SPEED
const STEP_MS = 50;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const cookie = await signIn(base, pin, "test_parkour");

const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
const msgs: ServerMsg[] = [];
let tp = 0;
let pos: Vec3 = [0, 0, 0];
ws.on("message", (data) => {
  const msg = JSON.parse(data.toString()) as ServerMsg;
  msgs.push(msg);
  if (msg.t === "welcome") pos = msg.spawn;
  if (msg.t === "teleport") {
    tp = msg.tp;
    pos = msg.p;
  }
});
await new Promise((r) => ws.on("open", r));
ws.send(JSON.stringify({ t: "hello", room: "trial1" }));
for (let i = 0; i < 100 && !msgs.some((m) => m.t === "welcome"); i++) await sleep(20);

const send = (p: Vec3) => ws.send(JSON.stringify({ t: "move", p, ry: 0, tp }));
const since = (mark: number) => msgs.slice(mark);
const center = (z: { min: Vec3; max: Vec3 }, lift = 0.9): Vec3 => [
  (z.min[0] + z.max[0]) / 2,
  z.min[1] + lift,
  (z.min[2] + z.max[2]) / 2,
];

// Walk in a straight line at SPEED, sending 20 updates per second.
async function walkTo(target: Vec3): Promise<void> {
  const from = pos;
  const dist = Math.hypot(target[0] - from[0], target[2] - from[2]);
  const steps = Math.max(1, Math.ceil(dist / (SPEED * (STEP_MS / 1000))));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    pos = [from[0] + (target[0] - from[0]) * t, from[1] + (target[1] - from[1]) * t, from[2] + (target[2] - from[2]) * t];
    send(pos);
    await sleep(STEP_MS);
  }
  await sleep(150);
}

const cps = course.checkpoints;
const finish = center(course.finish);

// 1. Skipping checkpoint 1: go straight to checkpoint 2, then the finish.
let mark = msgs.length;
await walkTo(cps[1].respawn);
await walkTo(finish);
const skipped = since(mark);
check("leaving the start platform starts the run", skipped.some((m) => m.t === "runStart"));
check("skipping checkpoint 1 means checkpoint 2 doesn't count", !skipped.some((m) => m.t === "checkpoint"));
check("no finish without the checkpoints", !skipped.some((m) => m.t === "finish"));

// 2. Restart (R) puts you back at the start and resets the run.
mark = msgs.length;
ws.send(JSON.stringify({ t: "restart" }));
await sleep(300);
check("restart resets the run and teleports to the start", since(mark).some((m) => m.t === "runReset") && since(mark).some((m) => m.t === "teleport"));
send(pos); // first move after the teleport, still on the start platform
await sleep(100);

// 3. A proper run, with a fall after checkpoint 2.
mark = msgs.length;
await walkTo(cps[0].respawn);
await walkTo(cps[1].respawn);
// Fall off the course, then ask to respawn.
await walkTo([cps[1].respawn[0] + 4, cps[1].respawn[1], cps[1].respawn[2] - 5]);
for (let y = pos[1]; y > trial1.killY - 2; y -= 1.5) {
  pos = [pos[0], y, pos[2]];
  send(pos);
  await sleep(STEP_MS);
}
ws.send(JSON.stringify({ t: "respawn" }));
await sleep(300);
const respawned = since(mark).filter((m): m is Extract<ServerMsg, { t: "teleport" }> => m.t === "teleport").at(-1);
check("falling respawns you at the last checkpoint", JSON.stringify(respawned?.p) === JSON.stringify(cps[1].respawn), JSON.stringify(respawned?.p));
send(pos);
await sleep(100);
await walkTo(cps[2].respawn);
// Phase 16: the finish is sealed until the star orbs are found.
await walkTo(finish);
check("the finish is sealed until the task is done", !since(mark).some((m) => m.t === "finish") && since(mark).some((m) => m.t === "announce" && m.text.startsWith("The way is sealed")));
for (const stop of taskStops(course)) await walkTo(stop);
check("flying through the three orbs completes the task", since(mark).some((m) => m.t === "task" && m.done));
await walkTo(finish);

const run = since(mark);
const reached = run.filter((m) => m.t === "checkpoint").map((m) => (m as Extract<ServerMsg, { t: "checkpoint" }>).reached);
check("checkpoints count in order", JSON.stringify(reached) === "[1,2,3]", JSON.stringify(reached));
const done = run.find((m) => m.t === "finish") as Extract<ServerMsg, { t: "finish" }> | undefined;
check("finishing after all checkpoints records a time", !!done, done ? `${(done.time / 1000).toFixed(2)} s, best ${done.newBest}` : "no finish");
const board = run.filter((m) => m.t === "leaderboard").at(-1) as Extract<ServerMsg, { t: "leaderboard" }> | undefined;
check("the leaderboard shows the time", board?.entries.some((e) => e.name === "test_parkour") ?? false);
check("an announcement goes to the room", run.some((m) => m.t === "announce"));
const xp = msgs.filter((m): m is Extract<ServerMsg, { t: "xp" }> => m.t === "xp");
check("finishing awards XP", xp.length > 0, xp.map((m) => `+${m.amount} ${m.reason}`).join("; "));

ws.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);

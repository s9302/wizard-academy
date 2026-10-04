// Checks chapters IV-VI (Phase 12): each new trial is a real course on the
// server (checkpoints in order, then the finish), its first clear pays the
// right XP, and completes its chapter, which unlocks the next trial's portal
// and the new cosmetics (which can then be worn).
//
// Creates a new test account each run; run it against a test stack:
//   GAME_PIN=... node server/scripts/story-check.ts http://localhost:3000

import WebSocket from "ws";
import { LEVELS } from "../../shared/src/levels/index.ts";
import type { ServerMsg, Vec3 } from "../../shared/src/protocol.ts";
import { unlockedSet } from "../../shared/src/unlocks.ts";
import { signIn } from "./signIn.ts";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const pin = process.env.GAME_PIN;
if (!pin) {
  console.error("Set GAME_PIN in the environment.");
  process.exit(1);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}
async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  for (let t = 0; t < ms; t += 50) {
    if (cond()) return true;
    await sleep(50);
  }
  return cond();
}

const cookie = await signIn(base, pin, `test_s${Date.now() % 1_000_000}`);

async function clear(room: string): Promise<ServerMsg[]> {
  const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
  const msgs: ServerMsg[] = [];
  let pos: Vec3 = [0, 0, 0];
  let tp = 0;
  ws.on("message", (d) => {
    const m = JSON.parse(d.toString()) as ServerMsg;
    msgs.push(m);
    if (m.t === "welcome") pos = m.spawn;
    if (m.t === "teleport") {
      tp = m.tp;
      pos = m.p;
    }
  });
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ t: "hello", room }));
  await waitFor(() => msgs.some((m) => m.t === "welcome"), 5000);
  // Walk (at 7 m/s, through the air: the server has no collision) to each
  // checkpoint in order, then the finish.
  const course = LEVELS[room].course!;
  const center = (z: { min: Vec3; max: Vec3 }): Vec3 => [(z.min[0] + z.max[0]) / 2, z.min[1] + 0.9, (z.min[2] + z.max[2]) / 2];
  for (const target of [...course.checkpoints.map((c) => c.respawn), center(course.finish), center(course.finish)]) {
    const from = pos;
    const steps = Math.max(1, Math.ceil(Math.hypot(target[0] - from[0], target[2] - from[2]) / 0.35));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      pos = [from[0] + (target[0] - from[0]) * t, from[1] + (target[1] - from[1]) * t, from[2] + (target[2] - from[2]) * t];
      ws.send(JSON.stringify({ t: "move", p: pos, ry: 0, tp }));
      await sleep(50);
    }
    await sleep(100);
  }
  await waitFor(() => msgs.some((m) => m.t === "xp"), 3000);
  ws.close();
  return msgs;
}

const xpFor: Record<string, number> = { trial4: 250, trial5: 300, trial6: 400 };
for (const [room, chapter] of [
  ["trial4", 4],
  ["trial5", 5],
  ["trial6", 6],
] as const) {
  const msgs = await clear(room);
  const fin = msgs.find((m) => m.t === "finish");
  const xp = msgs.find((m) => m.t === "xp");
  check(`${room}: the course runs on the server, first clear`, fin?.t === "finish" && fin.firstClear, JSON.stringify(fin));
  check(`${room}: first-clear XP is ${xpFor[room]}`, xp?.t === "xp" && xp.amount === xpFor[room], xp?.t === "xp" ? `${xp.amount}` : "none");
  const me = (await (await fetch(`${base}/api/me`, { headers: { cookie } })).json()) as { xp: number; bestTimes: Record<string, number> };
  const unlocked = unlockedSet(me.xp, me.bestTimes);
  const expect = { 4: ["area:trial5", "robe:storm"], 5: ["area:trial6", "robe:ember"], 6: ["hat:storm"] }[chapter];
  check(`Chapter ${chapter} done: unlocks ${expect.join(", ")}`, expect.every((u) => unlocked.has(u)));
}

// The new cosmetics can be worn (saved in the hub).
const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
const msgs: ServerMsg[] = [];
ws.on("message", (d) => msgs.push(JSON.parse(d.toString()) as ServerMsg));
await new Promise((r) => ws.on("open", r));
ws.send(JSON.stringify({ t: "hello", room: "hub" }));
await waitFor(() => msgs.some((m) => m.t === "welcome"), 5000);
ws.send(JSON.stringify({ t: "loadout", primary: "bolt", hat: "storm", robe: "ember" }));
await waitFor(() => msgs.some((m) => m.t === "loadoutSaved"), 3000);
const saved = msgs.find((m) => m.t === "loadoutSaved");
check("the Stormcaller's hat and Ember robe can be worn", saved?.t === "loadoutSaved" && saved.hat === "storm" && saved.robe === "ember", JSON.stringify(saved));
ws.close();

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);

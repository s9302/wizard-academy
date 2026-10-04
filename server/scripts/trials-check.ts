// Checks Phase 16's trial tasks against the server: Trial II's runes reset
// on a wrong step and open the finish in the right order; Trial III's Bridge
// Golem wakes when you reach its arena, throws things that cost hearts, and
// when it falls the finish opens.
//
//   BOSS_HP_SCALE=0.2 GAME_PIN=... SESSION_SECRET=... node server/src/index.ts
//   GAME_PIN=... node server/scripts/trials-check.ts http://localhost:3000

import WebSocket from "ws";
import { LEVELS } from "../../shared/src/levels/index.ts";
import type { ServerMsg, Vec3 } from "../../shared/src/protocol.ts";
import { signIn } from "./signIn.ts";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const pin = process.env.GAME_PIN!;
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
const cookie = await signIn(base, pin, "test_trials");

async function enter(room: string) {
  const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
  const msgs: ServerMsg[] = [];
  const me = { pos: [0, 0, 0] as Vec3, tp: 0 };
  ws.on("message", (d) => {
    const m = JSON.parse(d.toString()) as ServerMsg;
    msgs.push(m);
    if (m.t === "welcome") me.pos = m.spawn;
    if (m.t === "teleport") {
      me.tp = m.tp;
      me.pos = m.p;
    }
  });
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ t: "hello", room }));
  await waitFor(() => msgs.some((m) => m.t === "welcome"), 5000);
  const walkTo = async (target: Vec3) => {
    const from = me.pos;
    const tp = me.tp;
    const steps = Math.max(1, Math.ceil(Math.hypot(target[0] - from[0], target[1] - from[1], target[2] - from[2]) / 0.3));
    for (let i = 1; i <= steps && me.tp === tp; i++) {
      const t = i / steps;
      me.pos = [from[0] + (target[0] - from[0]) * t, from[1] + (target[1] - from[1]) * t, from[2] + (target[2] - from[2]) * t];
      ws.send(JSON.stringify({ t: "move", p: me.pos, ry: 0, tp: me.tp }));
      await sleep(50);
    }
    await sleep(100);
  };
  return { ws, msgs, me, walkTo };
}

// ---- Trial II: runes ----
{
  const course = LEVELS.trial2.course!;
  const runes = course.tasks![0];
  if (runes.kind !== "runes") throw new Error("trial2 should have runes");
  const t = await enter("trial2");
  for (const cp of course.checkpoints) await t.walkTo(cp.respawn);
  const plate = (i: number): Vec3 => [runes.points[i][0], runes.points[i][1] + 0.9, runes.points[i][2]];
  const center: Vec3 = [(course.finish.min[0] + course.finish.max[0]) / 2, course.finish.min[1] + 0.9, (course.finish.min[2] + course.finish.max[2]) / 2];
  await t.walkTo(center);
  check("Trial II: the finish is sealed without the runes", !t.msgs.some((m) => m.t === "finish"));
  let mark = t.msgs.length;
  await t.walkTo(plate(runes.order[0]));
  await t.walkTo(plate(runes.order[2])); // skipping one
  const wrong = t.msgs.slice(mark).filter((m) => m.t === "task");
  check("...the right first rune lights, a wrong second one resets them", wrong.length === 2 && wrong[1].t === "task" && !!wrong[1].wrong && wrong[1].got.length === 0, JSON.stringify(wrong));
  mark = t.msgs.length;
  for (const i of runes.order) await t.walkTo(plate(i));
  await t.walkTo(center);
  await waitFor(() => t.msgs.some((m) => m.t === "finish"), 3000);
  check("...in the right order they open the way, and the run finishes", t.msgs.slice(mark).some((m) => m.t === "task" && m.done) && t.msgs.some((m) => m.t === "finish"));
  t.ws.close();
}

// ---- Trial III: the Bridge Golem ----
{
  const course = LEVELS.trial3.course!;
  const boss = course.tasks![0];
  if (boss.kind !== "boss") throw new Error("trial3 should have a boss");
  const t = await enter("trial3");
  for (const cp of course.checkpoints) await t.walkTo(cp.respawn);
  await waitFor(() => t.msgs.some((m) => m.t === "boss" && m.state === "fight"), 3000);
  check("Trial III: the golem wakes when you reach its arena", t.msgs.some((m) => m.t === "boss" && m.state === "fight"));
  // Stand still in front of it: something hits you.
  await waitFor(() => t.msgs.some((m) => m.t === "hearts" && m.hearts < 3), 12000);
  check("...its attacks cost hearts", t.msgs.some((m) => m.t === "hearts" && m.hearts < 3));
  check("...and it throws rocks or sends shockwaves", t.msgs.some((m) => m.t === "bossShot" || m.t === "bossWave"));
  const mark = t.msgs.length;
  for (let i = 0; i < 80 && !t.msgs.some((m) => m.t === "task" && m.done); i++) {
    const b = t.msgs.filter((m) => m.t === "boss").at(-1);
    const at = b?.t === "boss" ? b.p : boss.home;
    const o: Vec3 = [t.me.pos[0], t.me.pos[1] + 0.7, t.me.pos[2]];
    const d: Vec3 = [at[0] - o[0], at[1] - o[1], at[2] - o[2]];
    const l = Math.hypot(...d);
    t.ws.send(JSON.stringify({ t: "cast", spell: "bolt", o, d: [d[0] / l, d[1] / l, d[2] / l], seq: i + 1 }));
    t.ws.send(JSON.stringify({ t: "move", p: t.me.pos, ry: 0, tp: t.me.tp }));
    await sleep(500);
  }
  const hits = t.msgs.slice(mark).filter((m) => m.t === "spellEnd" && m.hit === -1).length;
  check("...bolts hit it and it falls", t.msgs.some((m) => m.t === "boss" && m.state === "dead"), `${hits} hits`);
  check("...which completes the task for those in the arena", t.msgs.some((m) => m.t === "task" && m.done));
  const center: Vec3 = [(course.finish.min[0] + course.finish.max[0]) / 2, course.finish.min[1] + 0.9, (course.finish.min[2] + course.finish.max[2]) / 2];
  await t.walkTo(center);
  await waitFor(() => t.msgs.some((m) => m.t === "finish"), 3000);
  check("...and the finish counts", t.msgs.some((m) => m.t === "finish"));
  t.ws.close();
}

console.log(failures ? `${failures} FAILED` : "all checks passed");
process.exit(failures ? 1 : 0);

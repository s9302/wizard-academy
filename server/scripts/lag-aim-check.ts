// Shots land where your screen showed the target. A player strafes at
// 7 m/s; a watcher (admin) sees them the way the game draws others, 120 ms
// in the past, aims at that (leading for the bolt's flight) and fires.
// The server should test each bolt against that view of the target.
//
//   ROYALE_ARENA=arena ROYALE_STORM=off ROUND_READY=on ... node server/src/index.ts
//   ADMIN_USER=... ADMIN_PASSWORD=... GAME_PIN=... node server/scripts/lag-aim-check.ts http://localhost:3000

import WebSocket from "ws";
import { SPELLS } from "../../shared/src/combat.ts";
import { EYE_HEIGHT } from "../../shared/src/constants.ts";
import { lineOfSight } from "../../shared/src/levels/geometry.ts";
import { LEVELS } from "../../shared/src/levels/index.ts";
import type { ServerMsg, Vec3 } from "../../shared/src/protocol.ts";
import { signIn } from "./signIn.ts";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const { GAME_PIN: pin, ADMIN_USER: adminUser, ADMIN_PASSWORD: adminPassword } = process.env;
if (!pin || !adminUser || !adminPassword) {
  console.error("Set GAME_PIN, ADMIN_USER and ADMIN_PASSWORD in the environment.");
  process.exit(2);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const VIEW_MS = 120; // client RemotePlayers INTERP_DELAY_MS
const SPEED = 7;

async function connect(cookie: string, onMsg: (m: ServerMsg) => void): Promise<WebSocket> {
  const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
  ws.on("message", (d) => onMsg(JSON.parse(d.toString()) as ServerMsg));
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ t: "hello", room: "royale" }));
  return ws;
}

// The target: runs back and forth along x.
let tId = 0;
let tPos: Vec3 = [0, 0, 0];
let tTp = 0;
const target = await connect(await signIn(base, pin, "LagTarget"), (m) => {
  if (m.t === "welcome") [tId, tPos] = [m.id, m.spawn];
  if (m.t === "teleport") [tPos, tTp] = [m.p, m.tp];
});
await sleep(800);

// The watcher, standing off to the side with a clear view.
const seen: { time: number; p: Vec3 }[] = [];
const ends: ServerMsg[] = [];
let pos: Vec3 = [0, 0, 0];
const watcher = await connect(await signIn(base, pin, adminUser, adminPassword), (m) => {
  if (m.t === "welcome") pos = m.spawn;
  if (m.t === "moved" && m.id === tId) seen.push({ time: Date.now(), p: m.p });
  if (m.t === "spellEnd") ends.push(m);
});
const send = (m: object) => watcher.send(JSON.stringify(m));
await sleep(800);
send({ t: "class", cls: "knight" });
await sleep(150);
send({ t: "class", cls: "wizard" });
await sleep(300);

const boxes = LEVELS[process.env.ROYALE_ARENA ?? "arena"].boxes;
const home = tPos;
// A stretch of ground the target can run along, and a spot 9 m off it.
let lane = 0;
for (const [dx, dz] of [[1, 0], [0, 1]]) {
  const a: Vec3 = [home[0] - dx * 3, home[1], home[2] - dz * 3];
  const b: Vec3 = [home[0] + dx * 3, home[1], home[2] + dz * 3];
  if (!lineOfSight(a, b, boxes)) continue;
  for (const side of [1, -1]) {
    const w: Vec3 = [home[0] + dz * 9 * side, home[1], home[2] + dx * 9 * side];
    const e: Vec3 = [w[0], w[1] + EYE_HEIGHT, w[2]];
    if (lineOfSight(e, a, boxes) && lineOfSight(e, b, boxes) && lineOfSight(e, home, boxes)) {
      pos = w;
      lane = dx ? 0 : 2;
      break;
    }
  }
  if (pos[1] === home[1]) break;
}
send({ t: "move", p: pos, ry: 0, tp: 0 });
let phase = 0;
let dir = 1;
const runner = setInterval(() => {
  phase += dir * SPEED * 0.05;
  if (Math.abs(phase) >= 3) dir = -dir;
  const p: Vec3 = [...home];
  p[lane] += phase;
  tPos = p;
  target.send(JSON.stringify({ t: "move", p, ry: 0, tp: tTp }));
}, 50);
await sleep(1500);

const onScreen = (ago: number): Vec3 => {
  const want = Date.now() - ago;
  const i = seen.findIndex((h) => h.time > want);
  if (i <= 0) return seen[Math.max(0, i === -1 ? seen.length - 1 : 0)].p;
  const a = seen[i - 1];
  const b = seen[i];
  const k = (want - a.time) / (b.time - a.time || 1);
  return [a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k, a.p[2] + (b.p[2] - a.p[2]) * k];
};

let shots = 0;
let hits = 0;
for (let i = 0; i < 400 && shots < 20; i++) {
  await sleep(20);
  const p = onScreen(VIEW_MS);
  const q = onScreen(VIEW_MS + 60);
  const v = [(p[0] - q[0]) / 0.06, (p[2] - q[2]) / 0.06];
  if (Math.hypot(v[0], v[1]) < SPEED * 0.8) continue; // turning round: skip
  // Only from the middle of the lane, so they don't turn while it flies.
  if (Math.hypot(p[0] - home[0], p[2] - home[2]) > 1) continue;
  const o: Vec3 = [pos[0], pos[1] + EYE_HEIGHT, pos[2]];
  const flight = Math.hypot(p[0] - o[0], p[2] - o[2]) / SPELLS.bolt.speed;
  const at: Vec3 = [p[0] + v[0] * flight, p[1], p[2] + v[1] * flight];
  const d: Vec3 = [at[0] - o[0], at[1] - o[1], at[2] - o[2]];
  const l = Math.hypot(...d);
  const mark = ends.length;
  send({ t: "attack", seq: i + 1, o, d: [d[0] / l, d[1] / l, d[2] / l] });
  shots++;
  await sleep(450 + Math.random() * 300);
  if (ends.slice(mark).some((m) => m.t === "spellEnd" && m.hit === tId)) hits++;
}
clearInterval(runner);
const ok = shots >= 10 && hits >= shots * 0.8;
console.log(`${ok ? "PASS" : "FAIL"}  bolts hit a strafing player where the screen showed them  (${hits}/${shots})`);
target.close();
watcher.close();
process.exit(ok ? 0 : 1);

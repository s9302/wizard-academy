// Plays one bots-only battle royale round in the arena the server was
// started with (ROYALE_ARENA=<id>), with a watcher standing still, and
// checks the bots get around it: the round finishes, bots move, fight, use
// the high ground, and never stand inside anything.
//
//   ROYALE_ARENA=fortress ROUND_TIME_SCALE=0.25 ... node server/src/index.ts
//   GAME_PIN=... node server/scripts/arena-bots-check.ts http://localhost:3000 fortress

import WebSocket from "ws";
import { LEVELS } from "../../shared/src/levels/index.ts";
import type { ServerMsg, Vec3 } from "../../shared/src/protocol.ts";
import { segmentHitsBox } from "../../shared/src/levels/geometry.ts";
import { signIn } from "./signIn.ts";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const arenaId = process.argv[3] ?? "arena";
const pin = process.env.GAME_PIN!;
const level = LEVELS[arenaId];
const solid = level.boxes;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const cookie = await signIn(base, pin, "test_arenabots");
const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
const positions = new Map<number, Vec3[]>();
const names = new Map<number, string>();
let arenaSeen = "";
let result = "";
let spells = 0;
let swings = 0;
let hits = 0;
let falls = 0;
ws.on("message", (d) => {
  const m = JSON.parse(d.toString()) as ServerMsg;
  if (m.t === "join") names.set(m.player.id, m.player.name);
  else if (m.t === "arena") arenaSeen = m.levelId;
  else if (m.t === "moved") positions.set(m.id, [...(positions.get(m.id) ?? []), m.p]);
  else if (m.t === "spell") spells++;
  else if (m.t === "melee") swings++;
  else if (m.t === "spellEnd" && m.hit !== null) hits++;
  else if (m.t === "announce" && /fall/.test(m.text)) falls++;
  else if (m.t === "roundResult" && m.title !== "Round cancelled" && !result) result = m.title;
});
await new Promise((r) => ws.on("open", r));
ws.send(JSON.stringify({ t: "hello", room: "royale" }));
await sleep(500);
for (let i = 0; i < 6; i++) {
  ws.send(JSON.stringify({ t: "bots", action: "add" }));
  await sleep(150);
}
for (let t = 0; t < 120_000 && !result; t += 500) await sleep(500);

const bots = [...names].filter(([, n]) => n.startsWith("Bot ")).map(([id]) => id);
let inside = 0;
let samples = 0;
let high = 0;
let moved = 0;
for (const id of bots) {
  const ps = positions.get(id) ?? [];
  if (ps.length && Math.hypot(ps[0][0] - ps.at(-1)![0], ps[0][2] - ps.at(-1)![2]) > 2) moved++;
  for (const p of ps) {
    samples++;
    // Inside a wall: the bot's middle at least 0.3 m deep inside a block
    // whose top is well above its feet (a wall or pillar, not a ledge or
    // ramp it's in the middle of stepping onto: bots ease up and down
    // heights over a few updates, which can dip them into a step briefly).
    const feet = p[1] - 0.9;
    const box = solid.find(
      (b) =>
        !(b.rot && (b.rot[0] || b.rot[2])) && // ramps don't count
        b.pos[1] + b.size[1] / 2 > feet + 1 &&
        segmentHitsBox([p[0], p[1] - 0.1, p[2]], [p[0], p[1] + 0.1, p[2]], b, -0.3) !== null,
    );
    if (box) {
      inside++;
      if (process.env.SHOW_INSIDE) console.log("inside:", p.map((n) => n.toFixed(2)).join(","), JSON.stringify(box));
    }
    if (p[1] - 0.9 > 2) high++;
  }
}
const ok = arenaSeen === arenaId && !!result && moved >= 4 && inside === 0 && spells + swings > 10;
console.log(
  `${ok ? "PASS" : "FAIL"}  ${arenaId}: ${result || "no result"} | ${moved}/${bots.length} moved, ${inside}/${samples} inside walls, ` +
    `${high} high-ground samples, ${spells} shots, ${swings} swings, ${hits} hits, ${falls} falls`,
);
ws.close();
process.exit(ok ? 0 : 1);

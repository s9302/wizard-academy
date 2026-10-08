// Every ability aimed at a person also works on a bot. A watcher (admin,
// who has every unlock) adds one bot, then aims each one at it: once where
// the bot is now, and once where it was 150 ms ago (about what your screen
// shows, since remote players are drawn a little in the past).
//
//   ROYALE_ARENA=arena ROYALE_STORM=off ROUND_READY=on ... node server/src/index.ts
//   ADMIN_USER=... ADMIN_PASSWORD=... GAME_PIN=... node server/scripts/bot-target-check.ts http://localhost:3000

import WebSocket from "ws";
import type { AbilityId } from "../../shared/src/abilities.ts";
import { EYE_HEIGHT } from "../../shared/src/constants.ts";
import type { ServerMsg, Vec3 } from "../../shared/src/protocol.ts";
import { lineOfSight } from "../../shared/src/levels/geometry.ts";
import { LEVELS } from "../../shared/src/levels/index.ts";
import { signIn } from "./signIn.ts";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const { GAME_PIN: pin, ADMIN_USER: adminUser, ADMIN_PASSWORD: adminPassword } = process.env;
if (!pin || !adminUser || !adminPassword) {
  console.error("Set GAME_PIN, ADMIN_USER and ADMIN_PASSWORD in the environment.");
  process.exit(2);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie: await signIn(base, pin, adminUser, adminPassword) } });
const msgs: ServerMsg[] = [];
let me = 0;
let pos: Vec3 = [0, 0, 0];
let tp = 0;
const bots = new Set<number>();
const track = new Map<number, { time: number; p: Vec3 }[]>();
ws.on("message", (d) => {
  const m = JSON.parse(d.toString()) as ServerMsg;
  msgs.push(m);
  if (m.t === "welcome") [me, pos] = [m.id, m.spawn];
  if (m.t === "teleport") [pos, tp] = [m.p, m.tp];
  if (m.t === "join" && m.player.id !== me) bots.add(m.player.id);
  if (m.t === "moved") track.set(m.id, [...(track.get(m.id) ?? []), { time: Date.now(), p: m.p }].slice(-40));
});
await new Promise((r) => ws.on("open", r));
const send = (m: object) => ws.send(JSON.stringify(m));
send({ t: "hello", room: "royale" });
await sleep(800);
send({ t: "bots", action: "add" });
await sleep(3000);
const bot = [...bots][0];
check("a bot joined and moves", bot !== undefined && (track.get(bot)?.length ?? 0) > 3);

const botAt = (agoMs: number): Vec3 => {
  const list = track.get(bot) ?? [];
  const want = Date.now() - agoMs;
  return (list.findLast((h) => h.time <= want) ?? list[0]).p;
};
const aimAt = (p: Vec3): Vec3 => {
  const e: Vec3 = [pos[0], pos[1] + EYE_HEIGHT, pos[2]];
  const d: Vec3 = [p[0] - e[0], p[1] - e[1], p[2] - e[2]];
  const l = Math.hypot(...d);
  return [d[0] / l, d[1] / l, d[2] / l];
};
// Stand ~8 m from the bot where nothing's in the way (admins aren't
// move-checked, so we can just be there).
const boxes = LEVELS[process.env.ROYALE_ARENA ?? "arena"].boxes;
const closeIn = async () => {
  for (let k = 0; k < 24; k++) {
    const b = botAt(0);
    const a = (k / 24) * Math.PI * 2;
    const at: Vec3 = [b[0] + Math.sin(a) * 8, b[1], b[2] + Math.cos(a) * 8];
    if (!lineOfSight([at[0], at[1] + EYE_HEIGHT, at[2]], b, boxes)) continue;
    pos = at;
    break;
  }
  send({ t: "move", p: pos, ry: 0, tp });
  await sleep(250);
};

type T = { cls: string; e: AbilityId; r: AbilityId; ok: (m: ServerMsg[]) => boolean };
const tests: T[] = [
  { cls: "rogue", e: "assassinate", r: "blink", ok: (m) => m.some((x) => x.t === "effect" && x.kind === "blink" && x.id === me) },
  { cls: "knight", e: "chain", r: "charge", ok: (m) => m.some((x) => x.t === "effect" && x.kind === "chain" && x.id === bot) },
  { cls: "wizard", e: "invert", r: "wall", ok: (m) => m.some((x) => x.t === "effect" && x.kind === "invert" && x.id === bot) },
  { cls: "cleric", e: "judgment", r: "heal", ok: (m) => m.some((x) => x.t === "effect" && x.kind === "judgment" && x.id === bot) },
];
const speeds: number[] = [];
for (const t of tests) {
  for (const ago of [0, 150, 250]) {
    let hits = 0;
    const reasons = new Set<string>();
    for (let i = 0; i < 6; i++) {
      send({ t: "class", cls: t.cls === "wizard" ? "knight" : "wizard" });
      await sleep(120);
      send({ t: "class", cls: t.cls });
      await sleep(120);
      send({ t: "abilities", cls: t.cls, e: t.e, r: t.r });
      await sleep(200);
      await closeIn();
      const list = track.get(bot) ?? [];
      const recent = list.filter((h) => Date.now() - h.time < 500);
      if (recent.length > 1) speeds.push(Math.hypot(recent.at(-1)!.p[0] - recent[0].p[0], recent.at(-1)!.p[2] - recent[0].p[2]) / ((recent.at(-1)!.time - recent[0].time) / 1000 || 1));
      const mark = msgs.length;
      send({ t: "ability", slot: 0, o: [pos[0], pos[1] + EYE_HEIGHT, pos[2]], d: aimAt(botAt(ago)) });
      await sleep(400);
      const got = msgs.slice(mark);
      const fail = got.find((m) => m.t === "abilityFailed");
      if (t.ok(got) && !fail) hits++;
      else if (fail?.t === "abilityFailed") reasons.add(fail.reason);
    }
    check(`${t.e} on a bot, aimed where it was ${ago} ms ago`, hits >= 5, `${hits}/6 ${[...reasons].join("; ")}`);
  }
}

// The case that matters: the bot was moving (over 0.6 m in the last 250 ms)
// and you aimed where you saw it. Judgment (cheap to recast) many times.
{
  let tries = 0;
  let hits = 0;
  for (let i = 0; i < 80 && tries < 15; i++) {
    send({ t: "class", cls: "wizard" });
    await sleep(100);
    send({ t: "class", cls: "cleric" });
    await sleep(100);
    send({ t: "abilities", cls: "cleric", e: "judgment", r: "heal" });
    await sleep(150);
    await closeIn();
    const seen = botAt(250);
    const now = botAt(0);
    if (Math.hypot(now[0] - seen[0], now[2] - seen[2]) < 0.6) continue;
    tries++;
    const mark = msgs.length;
    send({ t: "ability", slot: 0, o: [pos[0], pos[1] + EYE_HEIGHT, pos[2]], d: aimAt(seen) });
    await sleep(300);
    if (msgs.slice(mark).some((x) => x.t === "effect" && x.kind === "judgment" && x.id === bot)) hits++;
  }
  check("a moving bot, aimed where your screen shows it (250 ms ago)", tries >= 5 && hits >= tries * 0.8, `${hits}/${tries}`);
}

console.log(`bot speed when aimed at: avg ${(speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(1)} m/s`);
ws.close();
console.log(failures ? `${failures} FAILED` : "all checks passed");
process.exit(failures ? 1 : 0);

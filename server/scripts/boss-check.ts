// Checks Trial VII, the Storm Tyrant (BossRoom): you can fight it alone; it
// wakes when the fight starts, walks toward you, and its attacks hurt; your
// class's attacks hurt it; players can't hurt each other there; bots fight
// on your side; beating it is a first clear with XP; and if everyone goes
// down, the round ends with a "try again".
//
//   BOSS_HP_SCALE=0.05 ROUND_TIME_SCALE=0.25 GAME_PIN=... SESSION_SECRET=... node server/src/index.ts
//   GAME_PIN=... node server/scripts/boss-check.ts http://localhost:3000

import WebSocket from "ws";
import { EYE_HEIGHT } from "../../shared/src/constants.ts";
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

type BossState = Extract<ServerMsg, { t: "boss" }>;

async function enter(name: string, cls: string) {
  const cookie = await signIn(base, pin, name);
  const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
  const msgs: ServerMsg[] = [];
  const me = { id: 0, pos: [0, 0, 0] as Vec3, tp: 0, boss: null as BossState | null, state: "", hp: 0, seq: 0 };
  ws.on("message", (d) => {
    const m = JSON.parse(d.toString()) as ServerMsg;
    msgs.push(m);
    if (m.t === "welcome") {
      me.id = m.id;
      me.pos = m.spawn;
    }
    if (m.t === "teleport") {
      me.tp = m.tp;
      me.pos = m.p;
    }
    if (m.t === "boss") me.boss = m;
    if (m.t === "round") me.state = m.state;
    if (m.t === "health" && m.id === me.id) me.hp = m.hp;
  });
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ t: "hello", room: "trial7" }));
  await waitFor(() => me.id > 0, 5000);
  ws.send(JSON.stringify({ t: "class", cls }));
  const eye = (): Vec3 => [me.pos[0], me.pos[1] + EYE_HEIGHT, me.pos[2]];
  const aimAt = (p: Vec3): Vec3 => {
    const e = eye();
    const d: Vec3 = [p[0] - e[0], p[1] - e[1], p[2] - e[2]];
    const l = Math.hypot(...d);
    return [d[0] / l, d[1] / l, d[2] / l];
  };
  return {
    ws,
    msgs,
    me,
    since: (i: number) => msgs.slice(i),
    // Stand still where the server put us (keeps the position fresh).
    hold: () => ws.send(JSON.stringify({ t: "move", p: me.pos, ry: 0, tp: me.tp })),
    castAt: (p: Vec3) => ws.send(JSON.stringify({ t: "cast", spell: "bolt", o: eye(), d: aimAt(p), seq: ++me.seq })),
  };
}

const a = await enter("test_boss_a", "wizard");

// ---- Alone: the fight starts, the Tyrant wakes ----
check("one player is enough to start a round", await waitFor(() => a.me.state === "playing", 15000), a.me.state);
check("the Tyrant wakes when the fight starts", await waitFor(() => a.me.boss?.state === "fight", 3000), a.me.boss?.state);
const startHp = a.me.boss?.hp ?? 0;
const startP = a.me.boss?.p ?? [0, 0, 0];

// ---- It walks toward you and attacks ----
let mark = a.msgs.length;
const hurt = await waitFor(() => {
  a.hold();
  return a.me.hp > 0 && a.me.hp < 100;
}, 25000);
check("its attacks hurt", hurt, `hp ${a.me.hp}`);
const attacks = new Set(a.since(mark).filter((m) => m.t === "bossShot" || m.t === "bossWave" || m.t === "bossStrike").map((m) => m.t));
check("...with boulders, shockwaves or marked strikes", attacks.size > 0, [...attacks].join(", "));
const moved = a.me.boss ? Math.hypot(a.me.boss.p[0] - startP[0], a.me.boss.p[2] - startP[2]) : 0;
check("it moves around the arena", moved > 3, `${moved.toFixed(1)} m`);

// ---- Another player can't hurt you here ----
const b = await enter("test_boss_b", "wizard");
await waitFor(() => b.me.id > 0, 3000);
mark = a.msgs.length;
const aHp = a.me.hp;
for (let i = 0; i < 4; i++) {
  b.castAt(a.me.pos);
  await sleep(600);
}
// The server sends a hit's damage straight after the spell's end, so a
// "health" for A right after B's bolt ends on A would be B hurting A.
const seen = a.since(mark);
const bHits = seen.filter((m, i) => m.t === "spellEnd" && m.hit === a.me.id && seen[i + 1]?.t === "health" && (seen[i + 1] as { id: number }).id === a.me.id);
check("players can't hurt each other in a boss fight", bHits.length === 0, `${seen.filter((m) => m.t === "spellEnd" && m.hit === a.me.id).length} bolts reached A, hp ${aHp} -> ${a.me.hp}`);
b.ws.close();

// ---- Bolts hurt it, and it falls: a first clear ----
// In a fresh round, at full health (the waiting above cost a lot of it).
await waitFor(() => a.me.state === "ended", 60000);
await waitFor(() => a.me.state === "playing" && a.me.boss?.state === "fight", 20000);
mark = a.msgs.length;
await waitFor(() => {
  a.hold();
  if (a.me.boss?.state === "fight" && a.me.state === "playing") a.castAt(a.me.boss.p);
  return a.me.boss?.state === "dead" || a.me.state !== "playing";
}, 30000);
const hits = a.since(mark).filter((m) => m.t === "boss" && m.hp < startHp).length;
check("your attacks hurt it", hits > 0);
check("...and it falls", a.me.boss?.state === "dead", `${a.me.boss?.state}, hp ${a.me.boss?.hp}`);
await waitFor(() => a.since(mark).some((m) => m.t === "finish"), 5000);
const finish = a.since(mark).find((m) => m.t === "finish");
check("beating it is a first clear", finish?.t === "finish" && finish.firstClear, JSON.stringify(finish));
const xp = a.since(mark).find((m) => m.t === "xp" && m.reason.startsWith("First clear"));
check("...worth 600 XP", xp?.t === "xp" && xp.amount === 600, JSON.stringify(xp));
await waitFor(() => a.since(mark).some((m) => m.t === "roundResult"), 3000);
const result = a.since(mark).find((m) => m.t === "roundResult");
check("the results say it fell", result?.t === "roundResult" && result.title.includes("fallen"), result?.t === "roundResult" ? result.title : "no result");

// ---- Bots fight on your side ----
await waitFor(() => a.me.state === "countdown" || a.me.state === "playing", 15000);
a.ws.send(JSON.stringify({ t: "bots", action: "add" }));
await waitFor(() => a.me.state === "playing" && a.me.boss?.state === "fight", 15000);
mark = a.msgs.length;
const before = a.me.boss?.hp ?? 0;
const botHit = await waitFor(() => {
  a.hold();
  return (a.me.boss?.hp ?? before) < before;
}, 30000);
check("a bot attacks the Tyrant", botHit, `hp ${before} -> ${a.me.boss?.hp}`);
const botSpells = new Set(a.since(mark).filter((m) => m.t === "spellEnd" && m.hit === a.me.id).map(() => 1));
check("...and never hits you", botSpells.size === 0);
a.ws.send(JSON.stringify({ t: "bots", action: "remove" }));

// ---- Everyone down: try again ----
// Wait for a fresh round (the bot may well have beaten it), then stand still.
await waitFor(() => a.me.state === "ended" || a.me.boss?.state === "dead", 30000);
await waitFor(() => a.me.state === "playing" && a.me.boss?.state === "fight", 20000);
mark = a.msgs.length;
await waitFor(() => {
  a.hold();
  return a.since(mark).some((m) => m.t === "roundResult");
}, 120000);
const lost = a.since(mark).find((m) => m.t === "roundResult");
check("if everyone goes down, it's a try again", lost?.t === "roundResult" && lost.title.includes("Try again"), lost?.t === "roundResult" ? lost.title : "no result");

a.ws.close();
console.log(failures ? `${failures} FAILED` : "all checks passed");
process.exit(failures ? 1 : 0);

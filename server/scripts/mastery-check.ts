// A quick check of the level 11+ abilities (they're not used by bots, so
// bots-check doesn't cover them): each one does its thing without breaking
// the server, and a low-level player can't equip them. An admin has every
// unlock, so the admin plays them.
//
//   ROYALE_ARENA=arena ROYALE_STORM=off ROUND_TIME_SCALE=0.25 ... node server/src/index.ts
//   ADMIN_USER=... ADMIN_PASSWORD=... GAME_PIN=... node server/scripts/mastery-check.ts http://localhost:3000

import WebSocket from "ws";
import type { AbilityId } from "../../shared/src/abilities.ts";
import { EYE_HEIGHT } from "../../shared/src/constants.ts";
import type { ServerMsg, Vec3 } from "../../shared/src/protocol.ts";
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
async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  for (let t = 0; t < ms; t += 50) {
    if (cond()) return true;
    await sleep(50);
  }
  return cond();
}

async function enter(cookie: string) {
  const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
  const msgs: ServerMsg[] = [];
  const me = { id: 0, pos: [0, 0, 0] as Vec3, tp: 0, state: "" };
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
    if (m.t === "round") me.state = m.state;
  });
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ t: "hello", room: "royale" }));
  await waitFor(() => me.id > 0, 5000);
  const send = (m: object) => ws.send(JSON.stringify(m));
  const aimAt = (p: Vec3): Vec3 => {
    const e: Vec3 = [me.pos[0], me.pos[1] + EYE_HEIGHT, me.pos[2]];
    const d: Vec3 = [p[0] - e[0], p[1] - e[1], p[2] - e[2]];
    const l = Math.hypot(...d);
    return [d[0] / l, d[1] / l, d[2] / l];
  };
  return {
    ws,
    me,
    msgs,
    send,
    since: (i: number) => msgs.slice(i),
    // A class (applied right away between rounds; that also resets cooldowns).
    async become(cls: string) {
      send({ t: "class", cls: cls === "wizard" ? "knight" : "wizard" });
      await sleep(150);
      send({ t: "class", cls });
      await sleep(150);
    },
    async equip(cls: string, e: AbilityId, r: AbilityId) {
      const mark = msgs.length;
      send({ t: "abilities", cls, e, r });
      await waitFor(() => msgs.slice(mark).some((m) => m.t === "abilitySet"), 1500);
      return msgs.slice(mark).find((m) => m.t === "abilitySet");
    },
    use(slot: 0 | 1, d: Vec3 = [0, -0.3, -0.95]) {
      const l = Math.hypot(...d);
      send({ t: "ability", slot, o: [me.pos[0], me.pos[1] + EYE_HEIGHT, me.pos[2]], d: [d[0] / l, d[1] / l, d[2] / l] });
    },
    aimAt,
    walkTo: async (target: Vec3) => {
      const from = me.pos;
      const tp = me.tp;
      const steps = Math.max(1, Math.ceil(Math.hypot(target[0] - from[0], target[2] - from[2]) / 0.3));
      for (let i = 1; i <= steps && me.tp === tp; i++) {
        const t = i / steps;
        me.pos = [from[0] + (target[0] - from[0]) * t, from[1] + (target[1] - from[1]) * t, from[2] + (target[2] - from[2]) * t];
        send({ t: "move", p: me.pos, ry: 0, tp: me.tp });
        await sleep(50);
      }
      await sleep(100);
    },
  };
}

const kinds = (list: ServerMsg[], t: string) => list.filter((m) => m.t === t);
const a = await enter(await signIn(base, pin, adminUser, adminPassword));

// ---- Alone (waiting for players): every ability does something ----
await a.become("wizard");
check("an admin (level 11+) can equip the new abilities", (await a.equip("wizard", "tornado", "flames"))?.t === "abilitySet");
let mark = a.msgs.length;
a.use(0);
a.use(1);
await sleep(400);
const f1 = kinds(a.since(mark), "field").map((m) => (m.t === "field" ? m.field.kind : ""));
check("Tornado and Wall of Flame appear", f1.includes("tornado") && f1.includes("flames"), f1.join(", "));

await a.become("wizard");
await a.equip("wizard", "hellpit", "invert");
mark = a.msgs.length;
a.use(0);
a.use(1, [0, 0, -1]);
await sleep(400);
check("Pit to Hell opens", kinds(a.since(mark), "field").some((m) => m.t === "field" && m.field.kind === "hellpit"));
check("Inversion with nobody there misses (and says so)", a.since(mark).some((m) => m.t === "abilityFailed" && m.reason.includes("Missed")));

await a.become("wizard");
await a.equip("wizard", "shockwave", "wall");
mark = a.msgs.length;
a.use(0);
await sleep(300);
check("Shockwave goes off", a.since(mark).some((m) => m.t === "effect" && m.kind === "shockwave"));

await a.become("knight");
await a.equip("knight", "nullzone", "giant");
mark = a.msgs.length;
a.use(0);
a.use(1);
await sleep(400);
check("Null Zone appears", kinds(a.since(mark), "field").some((m) => m.t === "field" && m.field.kind === "nullzone"));
check("Giant Form", a.since(mark).some((m) => m.t === "effect" && m.kind === "giant"));

// (Out of the Null Zone first: it stops the Rogue's magic, as it should.)
check("...and it stops magic inside it", await (async () => {
  await a.become("wizard");
  await a.equip("wizard", "shockwave", "wall");
  const m = a.msgs.length;
  a.use(0);
  await sleep(300);
  return a.since(m).some((x) => x.t === "abilityFailed" && x.reason.includes("Null Zone"));
})());
await sleep(7200);
await a.become("rogue");
await a.equip("rogue", "decoys", "glide");
mark = a.msgs.length;
a.use(0);
a.use(1);
await sleep(600);
const decoys = kinds(a.since(mark), "decoys").at(-1);
check("Mirror Images: two copies", decoys?.t === "decoys" && decoys.list.length === 2, decoys?.t === "decoys" ? `${decoys.list.length}` : "none");
check("Glide", a.since(mark).some((m) => m.t === "effect" && m.kind === "glide"));
await a.become("rogue");
await a.equip("rogue", "smoke", "blink");
mark = a.msgs.length;
a.use(0);
await sleep(300);
check("Smoke Bomb", kinds(a.since(mark), "field").some((m) => m.t === "field" && m.field.kind === "smoke"));

// (Set up for the round below now: class changes mid-round wait for the next one.)
await a.become("wizard");
await a.equip("wizard", "invert", "shockwave");

// ---- A level 1 player can't have them ----
const b = await enter(await signIn(base, pin, "test_mastery_b"));
await sleep(500);
const got = await b.equip("wizard", "tornado", "flames");
check("a level 1 player can't equip them", got?.t !== "abilitySet" || got.e !== "tornado", JSON.stringify(got));

// ---- In a round: they hit people ----
await waitFor(() => a.me.state === "playing", 20000);
await sleep(300);
await b.walkTo([a.me.pos[0] + 3, a.me.pos[1], a.me.pos[2]]);
mark = b.msgs.length;
a.use(0, a.aimAt(b.me.pos));
await sleep(400);
check("Inversion curses whoever you aim at", b.since(mark).some((m) => m.t === "effect" && m.kind === "invert" && m.id === b.me.id));
mark = b.msgs.length;
a.use(1);
await sleep(400);
check("Shockwave throws them back", kinds(b.since(mark), "knock").length > 0);
check("...and hurts them", b.since(mark).some((m) => m.t === "health" && m.id === b.me.id && m.hp < 100));

// ---- The tornado catches them, spins them and carries them ----
await a.equip("wizard", "wall", "tornado");
await sleep(10_800); // R's cooldown (from the shockwave)
await b.walkTo([a.me.pos[0] + 4, a.me.pos[1], a.me.pos[2]]);
mark = b.msgs.length;
a.use(1, a.aimAt(b.me.pos));
await waitFor(() => b.since(mark).some((m) => m.t === "effect" && m.kind === "spin"), 3000);
check("Tornado catches them (and spins their view)", b.since(mark).some((m) => m.t === "effect" && m.kind === "spin" && m.id === b.me.id));
await sleep(1800);
const knocks = kinds(b.since(mark), "knock").length;
check("...carries them along for a while, then flings them", knocks > 10, `${knocks} pushes`);

a.ws.close();
b.ws.close();
console.log(failures ? `${failures} FAILED` : "all checks passed");
process.exit(failures ? 1 : 0);

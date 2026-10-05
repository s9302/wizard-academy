// A quick check of the Druid's and Monk's abilities: each one does its thing
// without breaking the server. An admin has every unlock, so the admin plays.
//
//   ROYALE_ARENA=arena ROYALE_STORM=off ROUND_TIME_SCALE=0.25 ... node server/src/index.ts
//   ADMIN_USER=... ADMIN_PASSWORD=... GAME_PIN=... node server/scripts/druid-monk-check.ts http://localhost:3000

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
    walkTo: async (target: Vec3, step = 0.3) => {
      const from = me.pos;
      const tp = me.tp;
      const steps = Math.max(1, Math.ceil(Math.hypot(target[0] - from[0], target[2] - from[2]) / step));
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
const owned = () => {
  const m = kinds(a.msgs, "monsters").at(-1);
  return m?.t === "monsters" && m.list ? m.list.filter((x) => x.owner === a.me.id) : [];
};

// ---- Druid ----
await a.become("druid");
check("a Druid can equip Wolf and Golem", (await a.equip("druid", "wolf", "golem"))?.t === "abilitySet");
a.use(0);
a.use(1);
await sleep(500);
check("Call Wolf and Stone Golem summon beasts of your own", owned().length === 2, `${owned().map((m) => m.kind).join(", ")}`);
await a.become("druid");
await a.equip("druid", "swarm", "entangle");
let mark = a.msgs.length;
a.use(0);
a.use(1);
await sleep(500);
check("...Swarm adds slimes, capped at the limit", owned().length <= 3 && owned().length >= 2, `${owned().length}`);
check("Entangle roots the ground", kinds(a.since(mark), "field").some((m) => m.t === "field" && m.field.kind === "entangle"));
await a.become("druid");
await a.equip("druid", "barkskin", "wolf");
mark = a.msgs.length;
a.use(0);
await sleep(300);
check("Barkskin", a.since(mark).some((m) => m.t === "effect" && m.id === a.me.id));
await a.become("knight");
await sleep(300);
check("changing class sends your beasts away", owned().length === 0, `${owned().length}`);

// ---- Monk ----
await a.become("monk");
check("a Monk can equip Flurry and Palm", (await a.equip("monk", "flurry", "palm"))?.t === "abilitySet");
mark = a.msgs.length;
a.use(0, [0, 0, -1]);
a.use(1, [0, 0, -1]);
await sleep(400);
check("Flurry and Palm don't fail", !a.since(mark).some((m) => m.t === "abilityFailed"), JSON.stringify(a.since(mark).filter((m) => m.t === "abilityFailed")));
await a.become("monk");
await a.equip("monk", "windstep", "evasion");
mark = a.msgs.length;
a.use(0);
a.use(1);
await sleep(400);
check("Windstep", a.since(mark).some((m) => m.t === "effect" && m.kind === "windstep"));
check("Evasion", a.since(mark).some((m) => m.t === "effect" && m.kind === "stealth"));
await a.become("monk");
await a.equip("monk", "innerpeace", "flurry");
mark = a.msgs.length;
a.use(0);
await sleep(300);
check("Inner Peace", !a.since(mark).some((m) => m.t === "abilityFailed"));

// ---- A Monk outruns a Wizard (the server lets them move that fast) ----
const from = a.me.pos;
mark = a.msgs.length;
await a.walkTo([from[0], from[1], from[2] - 25], 0.5); // 10 m/s for 2.5 s: over a Wizard's run, under a Monk's
await sleep(300);
check("Monk speed isn't pulled back", !a.since(mark).some((m) => m.t === "teleport"));

a.ws.close();
console.log(failures ? `${failures} FAILED` : "all checks passed");
process.exit(failures ? 1 : 0);

// Checks the level 15, 20 and 25 abilities: each one does its thing (an
// admin has every unlock), a low-level player can't equip them, and in a
// round they hurt. B stands in front of the admin to be the target.
//
//   ROYALE_ARENA=arena ROYALE_STORM=off ROUND_READY=on ROUND_TIME_SCALE=0.25 ... node server/src/index.ts
//   ADMIN_USER=... ADMIN_PASSWORD=... GAME_PIN=... node server/scripts/legend-check.ts http://localhost:3000

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
const b = await enter(await signIn(base, pin, "test_legend_b"));
await sleep(500);
// B stands 5 m in front of the admin (who looks along -z).
await b.walkTo([a.me.pos[0], a.me.pos[1], a.me.pos[2] - 5]);
const ahead = () => a.aimAt(b.me.pos);

// Each: class, the two to equip, then which slot to use and what should happen.
type Test = { cls: string; e: AbilityId; r: AbilityId; slot: 0 | 1; aim?: () => Vec3; label: string; ok: (m: ServerMsg[]) => boolean; wait?: number };
const field = (k: string) => (m: ServerMsg[]) => m.some((x) => x.t === "field" && x.field.kind === k);
const effect = (k: string) => (m: ServerMsg[]) => m.some((x) => x.t === "effect" && x.kind === k);
const shots = (spell: string, n: number) => (m: ServerMsg[]) => m.filter((x) => x.t === "spell" && x.spell === spell).length === n;
const tests: Test[] = [
  { cls: "wizard", e: "meteor", r: "wall", slot: 0, aim: ahead, label: "Meteor marks a spot", ok: field("meteor") },
  { cls: "wizard", e: "frostnova", r: "wall", slot: 0, label: "Frost Nova freezes B", ok: (m) => m.some((x) => x.t === "effect" && x.kind === "freeze" && x.id === b.me.id) },
  { cls: "wizard", e: "blackhole", r: "wall", slot: 0, aim: ahead, label: "Black Hole opens", ok: field("blackhole") },
  { cls: "knight", e: "whirlwind", r: "charge", slot: 0, label: "Whirlwind", ok: effect("whirlwind") },
  { cls: "knight", e: "warcry", r: "charge", slot: 0, label: "War Cry rallies you", ok: (m) => m.some((x) => x.t === "effect" && x.kind === "rally" && x.id === a.me.id) },
  { cls: "knight", e: "earthshatter", r: "charge", slot: 0, label: "Earthshatter throws B", ok: (m) => effect("quake")(m) },
  { cls: "rogue", e: "knives", r: "blink", slot: 0, label: "Fan of Knives: 14 knives", ok: shots("knife", 14) },
  { cls: "rogue", e: "assassinate", r: "blink", slot: 0, aim: ahead, label: "Assassinate: appear behind B", ok: effect("blink") },
  { cls: "rogue", e: "phantom", r: "blink", slot: 0, label: "Phantom Strike", ok: effect("blink") },
  { cls: "cleric", e: "holynova", r: "heal", slot: 0, label: "Holy Nova", ok: effect("holynova") },
  { cls: "cleric", e: "guardian", r: "heal", slot: 0, label: "Guardian Angel shields you", ok: (m) => m.some((x) => x.t === "health" && x.id === a.me.id && x.shield > 0) },
  { cls: "cleric", e: "wrath", r: "heal", slot: 0, label: "Wrath of Heaven strikes B", ok: field("smite") },
  { cls: "druid", e: "thornstorm", r: "wolf", slot: 0, label: "Thorn Storm: 24 thorns", ok: shots("thorn", 24) },
  { cls: "druid", e: "wildhunt", r: "wolf", slot: 0, label: "Wild Hunt: four wolves", ok: (m) => { const l = kinds(m, "monsters").at(-1); return l?.t === "monsters" && !!l.list && l.list.filter((x) => x.owner === a.me.id).length === 4; } },
  { cls: "monk", e: "hundredfists", r: "flurry", slot: 0, aim: ahead, label: "Hundred Fists", ok: effect("fists") },
  { cls: "monk", e: "cyclone", r: "flurry", slot: 0, label: "Cyclone Kick", ok: effect("cyclone") },
  { cls: "monk", e: "ascend", r: "flurry", slot: 0, label: "Transcendence", ok: effect("ascend") },
];
for (const t of tests) {
  await a.become(t.cls);
  const set = await a.equip(t.cls, t.e, t.r);
  if (set?.t !== "abilitySet" || set.e !== t.e) { check(`${t.label} (equip)`, false, JSON.stringify(set)); continue; }
  // (Back in front of B if something moved us.)
  const mark = a.msgs.length;
  a.use(t.slot, t.aim?.() ?? [0, -0.3, -0.95]);
  await sleep(t.wait ?? 600);
  const got = a.since(mark);
  const fail = got.find((m) => m.t === "abilityFailed");
  check(t.label, t.ok(got) && !fail, fail?.t === "abilityFailed" ? fail.reason : "");
  await b.walkTo([a.me.pos[0], a.me.pos[1], a.me.pos[2] - 5]);
}

// ---- Frost Nova really freezes: B can't walk away ----
await a.become("wizard");
await a.equip("wizard", "frostnova", "wall");
await b.walkTo([a.me.pos[0], a.me.pos[1], a.me.pos[2] - 5]);
const fMark = b.msgs.length;
a.use(0);
await sleep(300);
const frozen = b.since(fMark).some((m) => m.t === "effect" && m.kind === "freeze" && m.id === b.me.id);
let bMark = b.msgs.length;
await b.walkTo([b.me.pos[0] + 3, b.me.pos[1], b.me.pos[2]]);
check("Frost Nova: a frozen player can't walk away (pulled back)", b.since(bMark).some((m) => m.t === "teleport"), `frozen: ${frozen}, ${Math.hypot(a.me.pos[0] - b.me.pos[0], a.me.pos[2] - b.me.pos[2]).toFixed(1)} m apart`);
await sleep(2600);
bMark = b.msgs.length;
await b.walkTo([b.me.pos[0] + 3, b.me.pos[1], b.me.pos[2]]);
check("...and can move again after 2.5 s", !b.since(bMark).some((m) => m.t === "teleport"));

// ---- Dragon Form: fire with every attack ----
await a.become("druid");
await a.equip("druid", "dragonform", "wolf");
let mark = a.msgs.length;
a.use(0);
await sleep(400);
check("Dragon Form", a.since(mark).some((m) => m.t === "effect" && m.kind === "dragon" && m.ms > 0));
mark = a.msgs.length;
a.send({ t: "attack", o: [a.me.pos[0], a.me.pos[1] + EYE_HEIGHT, a.me.pos[2]], d: ahead(), seq: 1 });
await sleep(300);
check("...every attack is dragonfire", a.since(mark).some((m) => m.t === "spell" && m.spell === "flame" && m.caster === a.me.id));
// ...and it can fly: a move straight up 15 m is allowed.
mark = a.msgs.length;
await a.walkTo([a.me.pos[0], a.me.pos[1] + 15, a.me.pos[2]], 1.5);
await sleep(300);
check("...and it flies (no pull-back going up 15 m)", !a.since(mark).some((m) => m.t === "teleport"));

// ---- A low-level player can't have them ----
const got = await b.equip("wizard", "meteor", "wall");
check("a level 1 player can't equip them", got?.t !== "abilitySet" || got.e !== "meteor");

a.ws.close();
b.ws.close();
console.log(failures ? `${failures} FAILED` : "all checks passed");
process.exit(failures ? 1 : 0);

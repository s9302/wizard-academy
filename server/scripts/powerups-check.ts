// Crouching (a smaller target, in the arena), and powerups (carried, one at
// a time, used with F): only in tag and infection, where anyone can switch
// them off and on. None in the arena any more.
//
//   ROYALE_ARENA=arena ROYALE_STORM=off ROYALE_PICKUPS=all ROUND_TIME_SCALE=0.25 ... node server/src/index.ts
//   GAME_PIN=... node server/scripts/powerups-check.ts http://localhost:3000

import WebSocket from "ws";
import type { AbilityId } from "../../shared/src/abilities.ts";
import { POWERUPS, isPowerup } from "../../shared/src/combat.ts";
import { EYE_HEIGHT } from "../../shared/src/constants.ts";
import type { PickupInfo, ServerMsg, Vec3 } from "../../shared/src/protocol.ts";
import { signIn } from "./signIn.ts";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const pin = process.env.GAME_PIN;
if (!pin) {
  console.error("Set GAME_PIN in the environment.");
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

async function enter(cookie: string, room = "royale") {
  const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
  const msgs: ServerMsg[] = [];
  const me = { id: 0, pos: [0, 0, 0] as Vec3, tp: 0, state: "", held: null as string | null, pickups: [] as PickupInfo[], hp: new Map<number, number>(), powerupsOn: false };
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
    if (m.t === "held") me.held = m.kind;
    if (m.t === "pickups") me.pickups = m.items;
    if (m.t === "health") me.hp.set(m.id, m.hp);
    if (m.t === "chaseSettings") me.powerupsOn = m.powerups;
  });
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ t: "hello", room }));
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
    walkTo: async (target: Vec3, crouch = false) => {
      const from = me.pos;
      const tp = me.tp;
      const steps = Math.max(1, Math.ceil(Math.hypot(target[0] - from[0], target[2] - from[2]) / 0.3));
      for (let i = 1; i <= steps && me.tp === tp; i++) {
        const t = i / steps;
        me.pos = [from[0] + (target[0] - from[0]) * t, from[1] + (target[1] - from[1]) * t, from[2] + (target[2] - from[2]) * t];
        send({ t: "move", p: me.pos, ry: 0, tp: me.tp, ...(crouch ? { c: true } : {}) });
        await sleep(50);
      }
      await sleep(100);
    },
  };
}

const a = await enter(await signIn(base, pin, "test_pw_a"));
const b = await enter(await signIn(base, pin, "test_pw_b"));
await a.become("wizard");
await b.become("wizard");
check("a round starts", await waitFor(() => a.me.state === "playing" && b.me.state === "playing", 40000), a.me.state);
await sleep(500);

// ---- Crouching: a bolt at head height hits someone standing, not someone crouched ----
let seq = 1;
const bolt = async (target: Vec3) => {
  const mark = a.msgs.length;
  a.send({ t: "cast", spell: "bolt", o: [a.me.pos[0], a.me.pos[1] + EYE_HEIGHT, a.me.pos[2]], d: a.aimAt(target), seq: seq++ });
  await waitFor(() => a.since(mark).some((m) => m.t === "spellEnd"), 3000);
  const end = a.since(mark).find((m) => m.t === "spellEnd");
  await sleep(700); // the cooldown
  return end?.t === "spellEnd" ? end.hit : undefined;
};
await b.walkTo([a.me.pos[0], a.me.pos[1], a.me.pos[2] - 5]);
const head: Vec3 = [b.me.pos[0], b.me.pos[1] + 0.75, b.me.pos[2]];
check("a bolt at head height hits someone standing", (await bolt(head)) === b.me.id);
let mark = a.msgs.length;
b.send({ t: "move", p: b.me.pos, ry: 0, tp: b.me.tp, c: true });
await sleep(300);
check("others are told you're crouching", a.since(mark).some((m) => m.t === "moved" && m.id === b.me.id && m.c === true));
check("...and the same bolt flies over you crouched", (await bolt(head)) !== b.me.id);
check("a bolt at your middle still hits you crouched", (await bolt([b.me.pos[0], b.me.pos[1] - 0.3, b.me.pos[2]])) === b.me.id);
b.send({ t: "move", p: b.me.pos, ry: 0, tp: b.me.tp });
await sleep(200);

check("no powerups in the arena", a.me.pickups.length > 0 && !a.me.pickups.some((p) => isPowerup(p.kind)), a.me.pickups.map((p) => p.kind).join(","));
a.ws.close();
b.ws.close();
await sleep(500);

// ---- Powerups in tag ----
const ta = await enter(await signIn(base, pin, "test_pw_a"), "tag");
const tb = await enter(await signIn(base, pin, "test_pw_b"), "tag");
check("tag: a round starts", await waitFor(() => ta.me.state === "playing", 40000), ta.me.state);
check("powerups are on by default", ta.me.powerupsOn);
await waitFor(() => ta.me.pickups.length > 0, 3000);
check("powerups lie about the map", ta.me.pickups.length >= 3 && ta.me.pickups.every((p) => isPowerup(p.kind)), ta.me.pickups.map((p) => p.kind).join(","));
check("...and no Fury Rune (nobody takes damage in tag)", !ta.me.pickups.some((p) => p.kind === "fury"));
const nearest = (who: typeof ta, ok: (k: string) => boolean = () => true) =>
  who.me.pickups.filter((p) => ok(p.kind)).sort((p, q) => Math.hypot(p.p[0] - who.me.pos[0], p.p[2] - who.me.pos[2]) - Math.hypot(q.p[0] - who.me.pos[0], q.p[2] - who.me.pos[2]))[0];
const first = nearest(ta);
if (first) {
  await ta.walkTo([first.p[0], first.p[1], first.p[2]]);
  check("walking into one puts it in your pocket", await waitFor(() => ta.me.held === first.kind, 2000), `${ta.me.held}`);
  check("...and takes it off the map", !ta.me.pickups.some((p) => p.id === first.id));
  const second = nearest(ta);
  if (second) {
    await ta.walkTo([second.p[0], second.p[1], second.p[2]]);
    await sleep(300);
    check("you can only carry one: a second stays where it is", ta.me.held === first.kind && ta.me.pickups.some((p) => p.id === second.id));
  }
  const seen = new Set<string>();
  for (let i = 0; i < 10 && seen.size < 3; i++) {
    if (!ta.me.held) {
      const next = nearest(ta, (k) => !seen.has(k)) ?? nearest(ta);
      if (!next) break;
      await ta.walkTo([next.p[0], next.p[1], next.p[2]]);
      await waitFor(() => !!ta.me.held, 1500);
      if (!ta.me.held) continue;
    }
    const kind = ta.me.held!;
    let mark = ta.msgs.length;
    const markB = tb.msgs.length;
    ta.send({ t: "usePowerup" });
    await waitFor(() => ta.me.held === null, 1500);
    const effect = kind === "cloak" ? "stealth" : kind;
    const got = ta.since(mark).find((m) => m.t === "effect" && m.id === ta.me.id && m.kind === effect);
    check(`F uses a ${kind} once (effect "${effect}")`, ta.me.held === null && got?.t === "effect" && got.ms === POWERUPS[kind as keyof typeof POWERUPS].ms);
    if (kind === "cloak") {
      await ta.walkTo([ta.me.pos[0] + 1.5, ta.me.pos[1], ta.me.pos[2]]);
      check("cloaked: the other player isn't told where you are", !tb.since(markB).some((m) => m.t === "moved" && m.id === ta.me.id));
    }
    seen.add(kind);
    mark = ta.msgs.length;
    ta.send({ t: "usePowerup" });
    await sleep(300);
    // (a cloak lifting, ms 0, when the round ends meanwhile, is fine)
    const again = ta.since(mark).filter((m) => m.t === "effect" && m.id === ta.me.id && m.ms > 0);
    check("...and pressing F again does nothing", !again.length, JSON.stringify(again));
  }
  check("every tag powerup came up (haste, boots, cloak)", seen.size === 3, [...seen].join(","));
}
// Anyone can switch them off (the map empties) and back on.
const pick = nearest(ta);
if (pick) {
  await ta.walkTo([pick.p[0], pick.p[1], pick.p[2]]);
  await waitFor(() => !!ta.me.held, 1500);
}
tb.send({ t: "chaseSetting", powerups: false });
check("switched off: everyone hears", await waitFor(() => ta.me.powerupsOn === false, 2000));
check("...the map is cleared", await waitFor(() => ta.me.pickups.length === 0, 2000));
check("...and pockets are emptied", await waitFor(() => ta.me.held === null, 2000));
ta.send({ t: "usePowerup" });
tb.send({ t: "chaseSetting", powerups: true });
check("switched back on: they're back", await waitFor(() => ta.me.powerupsOn && ta.me.pickups.length > 0, 2000));
ta.ws.close();
tb.ws.close();
console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exit(failures ? 1 : 0);

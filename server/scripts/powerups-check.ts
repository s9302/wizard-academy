// Powerups (carried, one at a time, used with F) and crouching (a smaller
// target). Two test players fight in the arena.
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

async function enter(cookie: string) {
  const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
  const msgs: ServerMsg[] = [];
  const me = { id: 0, pos: [0, 0, 0] as Vec3, tp: 0, state: "", held: null as string | null, pickups: [] as PickupInfo[], hp: new Map<number, number>() };
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

// ---- Powerups ----
const nearest = (who: typeof a, kinds: (k: string) => boolean) =>
  who.me.pickups.filter((p) => kinds(p.kind)).sort((p, q) => Math.hypot(p.p[0] - who.me.pos[0], p.p[2] - who.me.pos[2]) - Math.hypot(q.p[0] - who.me.pos[0], q.p[2] - who.me.pos[2]))[0];
const first = nearest(a, (k) => isPowerup(k as never));
check("powerups are on the map", !!first, a.me.pickups.map((p) => p.kind).join(","));
if (first) {
  await a.walkTo([first.p[0], first.p[1], first.p[2]]);
  check("walking into a powerup puts it in your pocket", await waitFor(() => a.me.held === first.kind, 2000), `${a.me.held}`);
  check("...and takes it off the map", !a.me.pickups.some((p) => p.id === first.id));
  const second = nearest(a, (k) => isPowerup(k as never));
  if (second) {
    await a.walkTo([second.p[0], second.p[1], second.p[2]]);
    await sleep(300);
    check("you can only carry one: a second stays where it is", a.me.held === first.kind && a.me.pickups.some((p) => p.id === second.id));
  }
  // Use them until we've seen every kind (or run out).
  const seen = new Set<string>();
  for (let i = 0; i < 12 && seen.size < 4; i++) {
    if (!a.me.held) {
      const next = nearest(a, (k) => isPowerup(k as never) && !seen.has(k)) ?? nearest(a, (k) => isPowerup(k as never));
      if (!next) break;
      await a.walkTo([next.p[0], next.p[1], next.p[2]]);
      await waitFor(() => !!a.me.held, 1500);
      if (!a.me.held) continue;
    }
    const kind = a.me.held!;
    mark = a.msgs.length;
    a.send({ t: "usePowerup" });
    await waitFor(() => a.me.held === null, 1500);
    const effect = kind === "cloak" ? "stealth" : kind;
    const got = a.since(mark).find((m) => m.t === "effect" && m.id === a.me.id && m.kind === effect);
    check(`F uses a ${kind} once (empty pocket, effect "${effect}")`, a.me.held === null && got?.t === "effect" && got.ms === POWERUPS[kind as keyof typeof POWERUPS].ms);
    seen.add(kind);
    mark = a.msgs.length;
    a.send({ t: "usePowerup" });
    await sleep(300);
    check(`...and pressing F again does nothing`, !a.since(mark).some((m) => m.t === "effect" && m.id === a.me.id));
    if (kind === "fury") {
      await b.walkTo([a.me.pos[0], a.me.pos[1], a.me.pos[2] - 5]);
      const before = a.me.hp.get(b.me.id) ?? 0;
      const hit = await bolt([b.me.pos[0], b.me.pos[1], b.me.pos[2]]);
      const after = a.me.hp.get(b.me.id) ?? 0;
      check("Fury: a 20-damage bolt does 30", hit === b.me.id && before - after === 30, `${before} -> ${after}`);
    }
  }
  check("every kind of powerup came up", seen.size === 4, [...seen].join(","));
}

a.ws.close();
b.ws.close();
console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exit(failures ? 1 : 0);

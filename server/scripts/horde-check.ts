// Checks Horde mode: one player starts it; waves come after a breather; an
// admin (who can't be hurt) clears them with bolts; a cleared wave pays XP
// and brings the fallen back; and when everyone's down, it's over.
//
//   ROUND_TIME_SCALE=0.25 ... node server/src/index.ts
//   ADMIN_USER=... ADMIN_PASSWORD=... GAME_PIN=... node server/scripts/horde-check.ts http://localhost:3000

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
    if (m.t === "monsters" && m.list) monsters = m.list;
  });
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ t: "hello", room: "horde" }));
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

let monsters: { id: number; p: Vec3; owner?: number; max?: number }[] = [];
const kinds = (list: ServerMsg[], t: string) => list.filter((m) => m.t === t);
const horde = (list: ServerMsg[]) => kinds(list, "horde").at(-1) as Extract<ServerMsg, { t: "horde" }> | undefined;
const a = await enter(await signIn(base, pin, adminUser, adminPassword));
const b = await enter(await signIn(base, pin, "test_horde_b"));

check("one player is enough: the fight starts", await waitFor(() => a.me.state === "playing", 25000), a.me.state);
check("...with a breather before wave 1", horde(a.msgs)?.wave === 0 && horde(a.msgs)?.nextAt !== null, JSON.stringify(horde(a.msgs)));
check("wave 1 comes", await waitFor(() => horde(a.msgs)?.wave === 1 && monsters.length > 0, 8000), JSON.stringify(horde(a.msgs)));
check("...with monsters left to beat", (horde(a.msgs)?.left ?? 0) > 0, `${horde(a.msgs)?.left}`);

// B hides far away (on the spawn) and does nothing; A hunts with bolts.
async function hunt(wave: number, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const h = horde(a.msgs);
    if (h && (h.wave > wave || (h.wave === wave && h.nextAt !== null))) return true;
    const wild = monsters.filter((m) => m.owner === undefined);
    if (!wild.length) {
      await sleep(200);
      continue;
    }
    const t = wild.reduce((x, y) => (Math.hypot(y.p[0] - a.me.pos[0], y.p[2] - a.me.pos[2]) < Math.hypot(x.p[0] - a.me.pos[0], x.p[2] - a.me.pos[2]) ? y : x));
    const d = Math.hypot(t.p[0] - a.me.pos[0], t.p[2] - a.me.pos[2]);
    if (d > 6) {
      const k = (d - 4) / d;
      await a.walkTo([a.me.pos[0] + (t.p[0] - a.me.pos[0]) * k, t.p[1] + 1.5, a.me.pos[2] + (t.p[2] - a.me.pos[2]) * k], 1.2);
    }
    a.send({ t: "cast", spell: "bolt", o: [a.me.pos[0], a.me.pos[1] + EYE_HEIGHT, a.me.pos[2]], d: a.aimAt(t.p), seq: Date.now() });
    await sleep(450);
  }
  return false;
}
let mark = b.msgs.length;
// (B gets knocked down by the first slime that reaches them, so the clear should bring B back.)
b.send({ t: "class", cls: "monk" }); // fewest hit points
const aliveIds = () => (kinds(a.msgs, "alive").at(-1) as Extract<ServerMsg, { t: "alive" }> | undefined)?.ids ?? [];
const bDown = waitFor(() => !aliveIds().includes(b.me.id), 90000);
await bDown;
check("(B goes down during wave 1)", !aliveIds().includes(b.me.id), JSON.stringify(aliveIds()));
check("the admin clears wave 1", await hunt(1, 90000), JSON.stringify(horde(a.msgs)));
check("...and whoever went down is back", await waitFor(() => aliveIds().includes(b.me.id), 2000), JSON.stringify(aliveIds()));
check("...a cleared wave pays XP", await waitFor(() => b.since(mark).some((m) => m.t === "xp" && m.reason.startsWith("Wave 1")), 2000));
check("...and there's a breather before wave 2", horde(a.msgs)?.nextAt !== null);
check("wave 2 comes, with wolves", await waitFor(() => horde(a.msgs)?.wave === 2 && monsters.length > 0, 10000));

// Now A goes; B is left alone with wave 2 and goes down: it's over.
a.ws.close();
mark = b.msgs.length;
const over = await waitFor(() => b.since(mark).some((m) => m.t === "roundResult"), 120000);
const result = b.since(mark).find((m) => m.t === "roundResult");
check("when everyone's down, it's over", over && result?.t === "roundResult" && result.title.includes("Overrun on wave 2"), result?.t === "roundResult" ? result.title : "no result");
check("...and it says how many waves you survived", result?.t === "roundResult" && result.lines[0] === "You survived 1 wave.", result?.t === "roundResult" ? result.lines[0] : "");

b.ws.close();
console.log(failures ? `${failures} FAILED` : "all checks passed");
process.exit(failures ? 1 : 0);

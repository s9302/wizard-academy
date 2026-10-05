// Checks a Knight's Null Zone: it breaks up a Wizard's tornado, and no magic
// reaches anyone inside it (a Pit to Hell can be opened over it but doesn't
// touch them; Inversion fails; Shockwave doesn't throw them). And that the
// Druid's Imp Swarm calls three fire imps that throw fire at enemies, never
// at the Druid. An admin plays (every unlock).
//
//   ROYALE_ARENA=arena ROUND_READY=on ROYALE_STORM=off ROUND_TIME_SCALE=0.25 ... node server/src/index.ts
//   ADMIN_USER=... ADMIN_PASSWORD=... GAME_PIN=... node server/scripts/nullzone-imps-check.ts http://localhost:3000

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
const b = await enter(await signIn(base, pin, "test_nz_b"));
const owned = () => {
  const m = kinds(a.msgs, "monsters").at(-1);
  return m?.t === "monsters" && m.list ? m.list.filter((x) => x.owner === a.me.id) : [];
};
// ---- Null Zone: tornadoes break up; no magic reaches anyone inside ----
// B stands inside the zone (2 m from its middle).
const z0 = a.me.pos;
await b.walkTo([z0[0] + 2, z0[1], z0[2]]);
await a.become("knight");
await a.equip("knight", "nullzone", "giant");
a.use(0);
await sleep(300);
await a.walkTo([z0[0], z0[1], z0[2] + 13]);
await a.become("wizard");
await a.equip("wizard", "tornado", "hellpit");
let mark = a.msgs.length;
a.use(0, a.aimAt([z0[0], z0[1], z0[2]])); // roll it at the zone
await waitFor(() => a.since(mark).some((m) => m.t === "fieldEnd"), 3000);
const tor = a.since(mark).find((m) => m.t === "field" && m.field.kind === "tornado");
const ended = tor?.t === "field" ? a.since(mark).find((m) => m.t === "fieldEnd" && m.id === tor.field.id) : undefined;
check("a tornado rolled at a Null Zone breaks up there", !!ended && a.since(mark).some((m) => m.t === "announce" && m.text.includes("breaks up")), JSON.stringify(a.since(mark).filter((m) => m.t === "announce").map((m) => m.t === "announce" && m.text)));
mark = a.msgs.length;
let bMark = b.msgs.length;
a.use(1, a.aimAt([b.me.pos[0], b.me.pos[1] - 0.95, b.me.pos[2]])); // a pit right under B
await sleep(1200);
check("a Pit to Hell can be opened over a Null Zone", a.since(mark).some((m) => m.t === "field" && m.field.kind === "hellpit") && !a.since(mark).some((m) => m.t === "abilityFailed"));
check("...but it can't touch someone inside the zone (no drag, no slow)", !b.since(bMark).some((m) => (m.t === "slowed" && m.id === b.me.id) || m.t === "knock"));
await a.become("wizard");
await a.equip("wizard", "invert", "shockwave");
mark = a.msgs.length;
a.use(0, a.aimAt(b.me.pos));
await sleep(400);
check("Inversion can't curse someone inside a Null Zone", a.since(mark).some((m) => m.t === "abilityFailed" && m.reason.includes("Null Zone")), JSON.stringify(a.since(mark).filter((m) => m.t === "abilityFailed")));
// Shockwave from just outside the zone's edge: B inside isn't thrown.
await a.walkTo([z0[0] + 2, z0[1], z0[2] + 8]);
bMark = b.msgs.length;
a.use(1);
await sleep(400);
check("Shockwave from outside doesn't throw someone inside", !b.since(bMark).some((m) => m.t === "knock"));
await sleep(6500); // the zone fades
bMark = b.msgs.length;
await a.become("wizard");
await a.equip("wizard", "invert", "shockwave");
a.use(1);
await sleep(400);
check("...and once the zone is gone, it does", b.since(bMark).some((m) => m.t === "knock"));

// ---- Imp Swarm ----
await a.become("druid");
await a.equip("druid", "swarm", "wolf");
await b.walkTo([a.me.pos[0], a.me.pos[1], a.me.pos[2] - 12]);
a.use(0);
await sleep(500);
check("Imp Swarm calls three fire imps of your own", owned().length === 3 && owned().every((m) => m.kind === "imp"), owned().map((m) => m.kind).join(","));
const imps = new Set(owned().map((m) => m.id));
mark = a.msgs.length;
await sleep(8000);
const bolts = a.since(mark).filter((m) => m.t === "spell" && imps.has(m.caster)).map((m) => (m.t === "spell" ? m.id : 0));
const ends = a.since(mark).filter((m) => m.t === "spellEnd" && bolts.includes(m.id));
check("...they throw fire at the enemy", ends.some((m) => m.t === "spellEnd" && m.hit === b.me.id), `${bolts.length} bolts, hits ${ends.map((m) => m.t === "spellEnd" && m.hit).join(",")}`);
check("...and never at you", !ends.some((m) => m.t === "spellEnd" && m.hit === a.me.id));
a.ws.close();
b.ws.close();
console.log(failures ? `${failures} FAILED` : "all checks passed");
process.exit(failures ? 1 : 0);

// Brooms and houses in the hub: a broom's climb and speed are accepted in
// the academy (and others are told you're on one), the same move on foot
// is refused; joining a house saves it, shows it to others, and a later
// Wardrobe save without a house keeps it.
//
// Creates test accounts, so run it against a test stack, never production.
//
//   GAME_PIN=... node server/scripts/houses-check.ts http://localhost:3000

import WebSocket from "ws";
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

async function enter(name: string) {
  const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie: await signIn(base, pin, name) } });
  const msgs: ServerMsg[] = [];
  const me = { id: 0, pos: [0, 0, 0] as Vec3, tp: 0, loadout: null as Record<string, unknown> | null };
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
    if (m.t === "loadoutSaved") me.loadout = m as unknown as Record<string, unknown>;
  });
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ t: "hello", room: "hub" }));
  await waitFor(() => me.id > 0, 5000);
  const send = (m: object) => ws.send(JSON.stringify(m));
  // Straight up (and along) at the given speeds for `seconds`, 20 moves a second.
  const travel = async (up: number, along: number, seconds: number, broom: boolean) => {
    const tp = me.tp;
    for (let i = 0; i < seconds * 20 && me.tp === tp; i++) {
      me.pos = [me.pos[0], me.pos[1] + up / 20, me.pos[2] - along / 20];
      send({ t: "move", p: me.pos, ry: 0, tp: me.tp, ...(broom ? { b: true } : {}) });
      await sleep(50);
    }
    await sleep(200);
    return me.tp === tp; // not snapped back
  };
  return { ws, me, msgs, send, travel, since: (i: number) => msgs.slice(i) };
}

const a = await enter("test_house_a");
const b = await enter("test_house_b");
let mark = b.msgs.length;
check("on a broom: climbing 12 m/s for 2 s is fine (looking up, Shift)", await a.travel(12, 0, 2, true));
check("...so is 17 m/s along (Shift)", await a.travel(0, 17, 1.5, true));
check("others are told you're on a broom", b.since(mark).some((m) => m.t === "moved" && m.id === a.me.id && m.b === true));
check("on foot, the same climb is refused", !(await a.travel(12, 0, 2, false)));

// Houses.
a.send({ t: "loadout", primary: "bolt", hat: "classic", robe: "auto", house: "ravenhand" });
check("joining a house saves it", await waitFor(() => a.me.loadout?.house === "ravenhand", 3000), JSON.stringify(a.me.loadout?.house));
mark = b.msgs.length;
await sleep(1200); // the hub only saves loadouts so often
a.send({ t: "loadout", primary: "bolt", hat: "tophat", robe: "auto" });
check("a Wardrobe save without a house keeps it", await waitFor(() => a.me.loadout?.hat === "tophat", 3000) && a.me.loadout?.house === "ravenhand");
check("others see your house on your look", b.since(mark).some((m) => m.t === "look" && m.id === a.me.id && (m.look as { house?: string }).house === "ravenhand"));
a.send({ t: "loadout", primary: "bolt", hat: "classic", robe: "auto", house: "hogwarts" });
await sleep(500);
check("an unknown house is refused", a.me.loadout?.house === "ravenhand");

a.ws.close();
b.ws.close();
console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exit(failures ? 1 : 0);

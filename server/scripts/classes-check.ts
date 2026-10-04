// Checks battle royale classes (Phase 10): class health and defense, picking
// a class (right away between rounds, next round mid-round, saved to the
// account), hands (a Wizard's spell only from the spell hand, the swap
// delay), the sword's reach, cleave and walls, the Knight's shield (blocks
// from the front, not from behind), the Rogue's backstab and arcing arrows.
//
// It's written for The Ruins (positions of walls and pickups), so pin the
// battle royale to it with ROYALE_ARENA=arena. Needs shortened rounds:
//   ROYALE_ARENA=arena ROUND_TIME_SCALE=0.25 GAME_PIN=... SESSION_SECRET=... node server/src/index.ts
//   GAME_PIN=... node server/scripts/classes-check.ts http://localhost:3000
//
// Creates test accounts, so run it against a test stack, never production.

import WebSocket from "ws";
import { CLASSES, WEAPONS } from "../../shared/src/classes.ts";
import { SPELLS } from "../../shared/src/combat.ts";
import { EYE_HEIGHT } from "../../shared/src/constants.ts";
import type { RoundState, ServerMsg, Vec3 } from "../../shared/src/protocol.ts";
import { signIn } from "./signIn.ts";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const pin = process.env.GAME_PIN;
if (!pin) {
  console.error("Set GAME_PIN in the environment.");
  process.exit(1);
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
const polar = (r: number, deg: number): [number, number] => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];

const names = ["test_cls1", "test_cls2", "test_cls3", "test_cls4"];
const cookies = await Promise.all(names.map((n) => signIn(base, pin, n)));

class Fighter {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  id = 0;
  pos: Vec3 = [0, 0, 0];
  ry = 0;
  tp = 0;
  state: RoundState | null = null;
  hp = new Map<number, { hp: number; max: number }>();
  closed = false;
  private seq = 0;
  constructor(cookie: string) {
    this.ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
    this.ws.on("open", () => this.send({ t: "hello", room: "royale" }));
    this.ws.on("close", () => (this.closed = true));
    this.ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerMsg;
      this.msgs.push(msg);
      if (msg.t === "welcome") {
        this.id = msg.id;
        this.pos = msg.spawn;
      } else if (msg.t === "teleport") {
        this.tp = msg.tp;
        this.pos = msg.p;
      } else if (msg.t === "round") this.state = msg.state;
      // hp here is health plus any Ward shield: walking around, a test wizard
      // may pick up a Ward, which absorbs damage before health does.
      else if (msg.t === "health") this.hp.set(msg.id, { hp: msg.hp + msg.shield, max: msg.max });
    });
  }
  send(msg: object): void {
    this.ws.send(JSON.stringify(msg));
  }
  get eye(): Vec3 {
    return [this.pos[0], this.pos[1] + EYE_HEIGHT, this.pos[2]];
  }
  since<T extends ServerMsg["t"]>(t: T, mark: number): Extract<ServerMsg, { t: T }>[] {
    return this.msgs.slice(mark).filter((m) => m.t === t) as Extract<ServerMsg, { t: T }>[];
  }
  // Face a point (the server reads facing from moves).
  face(x: number, z: number): void {
    this.ry = Math.atan2(-(x - this.pos[0]), -(z - this.pos[2]));
    this.send({ t: "move", p: this.pos, ry: this.ry, tp: this.tp });
  }
  async walkTo(x: number, z: number): Promise<void> {
    for (let i = 0; i < 600; i++) {
      const dx = x - this.pos[0];
      const dz = z - this.pos[2];
      const dist = Math.hypot(dx, dz);
      const step = Math.min(0.45, dist);
      this.pos = dist < 1e-6 ? [x, 0.9, z] : [this.pos[0] + (dx / dist) * step, 0.9, this.pos[2] + (dz / dist) * step];
      this.send({ t: "move", p: this.pos, ry: this.ry, tp: this.tp });
      await sleep(50);
      if (dist <= 0.45) return;
    }
  }
  dirTo(p: Vec3): Vec3 {
    const o = this.eye;
    const d: Vec3 = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
    const len = Math.hypot(...d);
    return [d[0] / len, d[1] / len, d[2] / len];
  }
  attackAt(p: Vec3): void {
    this.send({ t: "attack", o: this.eye, d: this.dirTo(p), seq: ++this.seq });
  }
  cast(spell: string, d: Vec3): void {
    this.send({ t: "cast", spell, o: this.eye, d, seq: ++this.seq });
  }
}

// ---- Picking classes before the round ----
const a = new Fighter(cookies[0]); // Knight
await waitFor(() => a.id > 0, 5000);
let mark = a.msgs.length;
a.send({ t: "class", cls: "knight" });
await waitFor(() => a.since("equip", mark).some((m) => m.id === a.id && m.cls === "knight"), 2000);
check("picking Knight between rounds applies right away", a.since("equip", mark).some((m) => m.id === a.id && m.cls === "knight"));
check(`...with the Knight's ${CLASSES.knight.maxHealth} health`, a.hp.get(a.id)?.max === CLASSES.knight.maxHealth, JSON.stringify(a.hp.get(a.id)));

const b = new Fighter(cookies[1]); // Rogue
const c = new Fighter(cookies[2]); // Wizard
await waitFor(() => b.id > 0 && c.id > 0, 5000);
b.send({ t: "class", cls: "rogue" });
c.send({ t: "class", cls: "wizard" });
check("the round starts", await waitFor(() => a.state === "playing", 15_000), `state=${a.state}`);
await sleep(300);
check(
  "each class has its own health (140 / 85 / 100)",
  a.hp.get(a.id)?.max === 140 && a.hp.get(b.id)?.max === 85 && a.hp.get(c.id)?.max === 100,
  JSON.stringify([...a.hp.entries()]),
);

// ---- Mid-round class change waits for the next round ----
mark = c.msgs.length;
c.send({ t: "class", cls: "rogue" });
await sleep(300);
check("changing class mid-round waits for the next round", c.since("announce", mark).some((m) => m.text.includes("next round")) && !c.since("equip", mark).some((m) => m.id === c.id && m.cls === "rogue"));
c.send({ t: "class", cls: "wizard" }); // and back, for the rest of the test

// ---- A Wizard's spell only from the spell hand; the swap delay ----
mark = c.msgs.length;
c.send({ t: "hand", hand: "backup" }); // the staff
await sleep(500);
c.cast("bolt", [0, -1, 0]);
await sleep(300);
check("a Wizard holding the staff can't cast their spell", c.since("spell", mark).length === 0);
c.send({ t: "hand", hand: "main" });
c.cast("bolt", [0, -1, 0]); // straight away: still swapping
await sleep(250);
check("right after swapping back, still can't (swap delay)", c.since("spell", mark).length === 0);
await sleep(400);
c.cast("bolt", [0, -1, 0]);
check("after the swap, the spell works", await waitFor(() => c.since("spell", mark).length === 1, 1000));

// Everyone into the open middle of the arena (inside the ring of walls).
await Promise.all([a.walkTo(...polar(12, 0)), b.walkTo(...polar(12, 22)), c.walkTo(...polar(12, 200))]);

// ---- The sword: reach ----
a.face(b.pos[0], b.pos[2]);
b.face(a.pos[0], a.pos[2]);
await sleep(700);
mark = a.msgs.length;
a.attackAt(b.pos); // 4.5 m away
await waitFor(() => a.since("melee", mark).length > 0, 1000);
check("a sword swing from 4.5 m misses (reach ~2.8 m)", a.since("melee", mark)[0]?.hits.length === 0, JSON.stringify(a.since("melee", mark)[0]));
await a.walkTo(b.pos[0] - (b.pos[0] - a.pos[0]) * 0.55, b.pos[2] - (b.pos[2] - a.pos[2]) * 0.55); // ~2 m from B
a.face(b.pos[0], b.pos[2]);
await sleep(700);
mark = a.msgs.length;
const bBefore = a.hp.get(b.id)!.hp;
a.attackAt(b.pos);
await waitFor(() => a.since("melee", mark).length > 0, 1000);
check("a sword swing in reach hits", a.since("melee", mark)[0]?.hits.includes(b.id) ?? false);
check(`...for ${WEAPONS.sword.melee!.damage} (a Rogue has no defense)`, await waitFor(() => a.hp.get(b.id)!.hp === bBefore - WEAPONS.sword.melee!.damage, 1000), `${bBefore} -> ${a.hp.get(b.id)!.hp}`);

// ---- The Knight's shield: blocks from the front, not from behind ----
a.send({ t: "hand", hand: "backup" });
b.send({ t: "hand", hand: "backup" }); // daggers
a.face(b.pos[0], b.pos[2]);
b.face(a.pos[0], a.pos[2]);
await sleep(700);
mark = a.msgs.length;
let aBefore = a.hp.get(a.id)!.hp;
b.attackAt(a.pos);
await waitFor(() => a.since("melee", mark).length > 0, 1000);
const daggers = WEAPONS.daggers.melee!.damage;
const blockedHit = Math.max(1, Math.round(daggers * (1 - CLASSES.knight.defense) * (1 - WEAPONS.shield.block!)));
check("daggers into a raised shield: blocked", a.since("melee", mark)[0]?.blocked.includes(a.id) ?? false);
check(`...the Knight takes only ${blockedHit} instead of ${daggers}`, await waitFor(() => a.hp.get(a.id)!.hp === aBefore - blockedHit, 1000), `${aBefore} -> ${a.hp.get(a.id)!.hp}`);

// B circles behind A (A keeps facing where B was) and stabs again.
const behind: [number, number] = [a.pos[0] - (b.pos[0] - a.pos[0]) * 0.8, a.pos[2] - (b.pos[2] - a.pos[2]) * 0.8];
const keepFacing: [number, number] = [b.pos[0], b.pos[2]];
await b.walkTo(...behind);
a.face(...keepFacing);
b.face(a.pos[0], a.pos[2]);
await sleep(500);
mark = a.msgs.length;
aBefore = a.hp.get(a.id)!.hp;
b.attackAt(a.pos);
await waitFor(() => a.since("melee", mark).length > 0, 1000);
const stab = a.since("melee", mark)[0];
const backstab = Math.round(daggers * WEAPONS.daggers.melee!.backstab! * (1 - CLASSES.knight.defense));
check("from behind: not blocked, and it's a backstab", !!stab && !stab.blocked.includes(a.id) && stab.backstabs.includes(a.id), JSON.stringify(stab));
check(`...double damage: ${backstab} (after the Knight's defense)`, await waitFor(() => a.hp.get(a.id)!.hp === aBefore - backstab, 1000), `${aBefore} -> ${a.hp.get(a.id)!.hp}`);

// ---- The sword doesn't cut through walls ----
// The full-height ring wall at 22.5 degrees, radius 16: A inside, C just outside.
a.send({ t: "hand", hand: "main" });
await Promise.all([a.walkTo(...polar(15.1, 22.5)), c.walkTo(...polar(16.9, 22.5))]);
a.face(c.pos[0], c.pos[2]);
await sleep(700);
mark = a.msgs.length;
a.attackAt(c.pos);
await waitFor(() => a.since("melee", mark).length > 0, 1000);
check("a sword swing through a wall misses (1.8 m away, wall between)", a.since("melee", mark)[0]?.hits.length === 0, JSON.stringify(a.since("melee", mark)[0]));

// ---- Arrows arc, and hit ----
b.send({ t: "hand", hand: "main" }); // the bow
await Promise.all([b.walkTo(...polar(12, 120)), c.walkTo(...polar(12, 165))]); // ~9 m apart, open ground
b.face(c.pos[0], c.pos[2]);
await sleep(600);
mark = b.msgs.length;
const cBefore = b.hp.get(c.id)!.hp;
b.attackAt([c.pos[0], c.pos[1] + 0.3, c.pos[2]]);
await waitFor(() => b.since("spellEnd", mark).length > 0, 2000);
const shot = b.since("spell", mark)[0];
check("the bow shoots an arrow", shot?.spell === "arrow");
check("...which hits", b.since("spellEnd", mark)[0]?.hit === c.id, JSON.stringify(b.since("spellEnd", mark)[0]));
check(`...for ${SPELLS.arrow.damage}`, await waitFor(() => b.hp.get(c.id)!.hp === cBefore - SPELLS.arrow.damage, 1000), `${cBefore} -> ${b.hp.get(c.id)!.hp}`);
await sleep(1000);
mark = b.msgs.length;
b.send({ t: "attack", o: b.eye, d: [0, 0.05, -1].map((n) => n / Math.hypot(0, 0.05, 1)), seq: 99 }); // flat, out across the arena
await waitFor(() => b.since("spellEnd", mark).length > 0, 3000);
const landed = b.since("spellEnd", mark)[0];
check("a flat arrow drops (hits lower than it started)", !!landed && landed.p[1] < b.eye[1] - 0.5, JSON.stringify(landed?.p));

// ---- Arrows can't be cast directly ----
{
  const d = new Fighter(cookies[3]);
  await waitFor(() => d.id > 0, 5000);
  d.cast("arrow", [1, 0, 0]);
  check("casting 'arrow' directly is rejected (only the bow fires them)", await waitFor(() => d.closed, 2000));
}

// ---- The class is saved ----
const me = (await (await fetch(`${base}/api/me`, { headers: { cookie: cookies[0] } })).json()) as { loadout: { cls: string } };
check("the chosen class is saved to the account", me.loadout.cls === "knight", JSON.stringify(me.loadout));

for (const f of [a, b, c]) f.ws.close();
console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);

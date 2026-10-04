// Plays a battle royale round against the server with three fake wizards and
// checks the combat rules: no casting in the countdown, cooldowns, the server
// ignoring a faked cast origin, spells stopping at the ground and at walls,
// hits and damage, elimination and spectating, pickups, fireball splash,
// storm damage, the winner, and XP.
//
// It's written for The Ruins (positions of walls and pickups), so pin the
// battle royale to it with ROYALE_ARENA=arena. Needs shortened rounds (the storm's first wait is 10 s at 0.25):
//   ROYALE_ARENA=arena ROUND_TIME_SCALE=0.25 GAME_PIN=... SESSION_SECRET=... node server/src/index.ts
//   GAME_PIN=... node server/scripts/royale-check.ts http://localhost:3000
//
// Creates test accounts, so run it against a test stack, never production.

import WebSocket from "ws";
import { SPELLS, stormCircle } from "../../shared/src/combat.ts";
import { EYE_HEIGHT } from "../../shared/src/constants.ts";
import { arena } from "../../shared/src/levels/arena.ts";
import type { PickupInfo, RoundState, ServerMsg, Vec3, ZoneState } from "../../shared/src/protocol.ts";
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

const cookies = await Promise.all(["test_royale1", "test_royale2", "test_royale3", "test_royale4"].map((u) => signIn(base, pin, u)));
const COOLDOWN = SPELLS.bolt.cooldownMs + 80;

class Wizard {
  ws: WebSocket;
  id = 0;
  pos: Vec3 = [0, 0, 0];
  tp = 0;
  state: RoundState | null = null;
  msgs: ServerMsg[] = [];
  alive: number[] = [];
  hp = new Map<number, number>();
  pickups: PickupInfo[] = [];
  zone: ZoneState | null = null;
  charges = 0;
  closed = false;
  private seq = 0;

  constructor(cookie: string, room: string) {
    this.ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
    this.ws.on("open", () => this.send({ t: "hello", room }));
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
      else if (msg.t === "alive") this.alive = msg.ids;
      // Health plus any Ward shield (a Ward picked up on the way absorbs damage first).
      else if (msg.t === "health") this.hp.set(msg.id, msg.hp + msg.shield);
      else if (msg.t === "pickups") this.pickups = msg.items;
      else if (msg.t === "zone") this.zone = msg.zone;
      else if (msg.t === "charges") this.charges = msg.fireball;
    });
  }

  send(msg: object): void {
    this.ws.send(JSON.stringify(msg));
  }

  get eye(): Vec3 {
    return [this.pos[0], this.pos[1] + EYE_HEIGHT, this.pos[2]];
  }

  // Walk at a legal speed (9 m/s; the server allows ~10) to a point on the ground.
  async walkTo(x: number, z: number, y = 0.9): Promise<void> {
    for (let i = 0; i < 600; i++) {
      const dx = x - this.pos[0];
      const dz = z - this.pos[2];
      const dist = Math.hypot(dx, dz);
      const step = Math.min(0.45, dist);
      this.pos = dist < 1e-6 ? [x, y, z] : [this.pos[0] + (dx / dist) * step, y, this.pos[2] + (dz / dist) * step];
      this.send({ t: "move", p: this.pos, ry: 0, tp: this.tp });
      await sleep(50);
      if (dist <= 0.45) return;
    }
  }

  cast(spell: "bolt" | "fireball", d: Vec3, o: Vec3 = this.eye): void {
    const len = Math.hypot(...d);
    this.send({ t: "cast", spell, o, d: d.map((n) => n / len), seq: ++this.seq });
  }

  // Aim from our eyes at a point.
  castAt(spell: "bolt" | "fireball", target: Vec3): void {
    const o = this.eye;
    this.cast(spell, [target[0] - o[0], target[1] - o[1], target[2] - o[2]]);
  }

  since(n: number): ServerMsg[] {
    return this.msgs.slice(n);
  }
}

const polar = (r: number, deg: number): [number, number] => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];

// ---- Malformed casts are rejected before they reach a room ----
{
  for (const bad of [
    { t: "cast", spell: "meteor", o: [0, 1, 0], d: [1, 0, 0], seq: 1 },
    { t: "cast", spell: "bolt", o: [0, 1, 0], d: [5, 0, 0], seq: 1 },
    { t: "cast", spell: "bolt", o: [0, 1e9, 0], d: [1, 0, 0], seq: 1 },
  ]) {
    const w = new Wizard(cookies[3], "royale");
    await waitFor(() => w.id > 0, 3000);
    w.send(bad);
    check(`malformed cast is rejected: ${JSON.stringify(bad).slice(0, 60)}`, await waitFor(() => w.closed, 2000));
  }
}

const [a, b, c] = [new Wizard(cookies[0], "royale"), new Wizard(cookies[1], "royale"), new Wizard(cookies[2], "royale")];
await waitFor(() => a.id > 0 && b.id > 0 && c.id > 0, 5000);

// ---- Countdown: no casting yet ----
check("a round counts down once 2+ wizards are in", await waitFor(() => a.state === "countdown", 10_000), `state=${a.state}`);
let mark = a.msgs.length;
a.cast("bolt", [1, 0, 0]);
await sleep(300);
check("casting during the countdown is ignored", !a.since(mark).some((m) => m.t === "spell"));

check("the round starts", await waitFor(() => a.state === "playing", 10_000));
await waitFor(() => a.alive.length === 3 && a.pickups.length > 0, 2000);
check("everyone starts alive at 100 health", a.alive.length === 3 && [a, b, c].every((w) => a.hp.get(w.id) === 100));
check("pickups appear at every pickup spot (ROYALE_PICKUPS=all)", a.pickups.length === arena.pickupSpots!.length, `${a.pickups.length}`);
check("the storm starts", !!a.zone && a.zone.from[2] > 40);

// ---- Spells hit the ground; cooldowns hold ----
mark = a.msgs.length;
a.cast("bolt", [0, -1, 0]);
a.cast("bolt", [0, -1, 0]); // straight away: still on cooldown
await sleep(400);
const spells = a.since(mark).filter((m) => m.t === "spell");
const ends = a.since(mark).filter((m) => m.t === "spellEnd");
check("a second cast inside the cooldown is ignored", spells.length === 1, `${spells.length} spells`);
const groundHit = ends[0]?.t === "spellEnd" ? ends[0] : null;
check("a bolt cast straight down stops at the ground", !!groundHit && groundHit.hit === null && Math.abs(groundHit.p[1]) < 0.2, JSON.stringify(groundHit?.p));

// ---- A faked origin is replaced by the server's idea of where you are ----
await sleep(COOLDOWN);
mark = a.msgs.length;
a.cast("bolt", [0, 1, 0], [a.eye[0] + 10, a.eye[1], a.eye[2]]);
await waitFor(() => a.since(mark).some((m) => m.t === "spell"), 1000);
const spoofed = a.since(mark).find((m) => m.t === "spell");
check(
  "a cast from 10 m away from yourself starts at your eyes instead",
  spoofed?.t === "spell" && Math.hypot(spoofed.o[0] - a.eye[0], spoofed.o[2] - a.eye[2]) < 0.01,
  spoofed?.t === "spell" ? JSON.stringify(spoofed.o) : "no spell",
);

// ---- Walls stop spells ----
// The ring of broken walls: the one at 22.5 degrees is full height. A stands
// inside it, B right behind it.
const [ax, az] = polar(13, 22.5);
const [bx, bz] = polar(19.5, 22.5);
await Promise.all([a.walkTo(ax, az), b.walkTo(bx, bz), c.walkTo(...polar(13, 200))]);
await sleep(COOLDOWN);
mark = a.msgs.length;
a.castAt("bolt", b.pos);
await waitFor(() => a.since(mark).some((m) => m.t === "spellEnd"), 2000);
const blocked = a.since(mark).find((m) => m.t === "spellEnd");
const blockedR = blocked?.t === "spellEnd" ? Math.hypot(blocked.p[0], blocked.p[2]) : 0;
check("a bolt at someone behind a wall hits the wall", blocked?.t === "spellEnd" && blocked.hit === null && Math.abs(blockedR - 15.6) < 0.3, `stopped at r=${blockedR.toFixed(2)}`);
check("...and does no damage", a.hp.get(b.id) === 100);

// ---- Hits and damage ----
await b.walkTo(...polar(13, 37.5)); // out from behind the wall, in plain sight of A
await sleep(COOLDOWN);
mark = a.msgs.length;
const bBeforeBolt = a.hp.get(b.id) ?? 100;
a.castAt("bolt", b.pos);
await waitFor(() => a.since(mark).some((m) => m.t === "spellEnd"), 2000);
const hit = a.since(mark).find((m) => m.t === "spellEnd");
check("a bolt at someone in the open hits them", hit?.t === "spellEnd" && hit.hit === b.id);
check(`...for ${SPELLS.bolt.damage} damage`, await waitFor(() => a.hp.get(b.id) === bBeforeBolt - SPELLS.bolt.damage, 1000), `${bBeforeBolt} -> ${a.hp.get(b.id)}`);

// ---- Elimination and spectating ----
for (let i = 0; i < 4; i++) {
  await sleep(COOLDOWN);
  a.castAt("bolt", b.pos);
}
check("five bolts take a wizard out", await waitFor(() => !a.alive.includes(b.id), 2000), `B hp=${a.hp.get(b.id)}`);
check("everyone hears who blasted whom", a.msgs.some((m) => m.t === "announce" && m.text.includes("blasted")));
check("the round goes on with 2 left", a.state === "playing" && a.alive.length === 2);
mark = b.msgs.length;
b.cast("bolt", [1, 0, 0]);
await sleep(400);
check("an eliminated wizard can't cast", !b.since(mark).some((m) => m.t === "spell"));

// ---- Pickups ----
// (Not the tower tops: a test walker can't jump 3 m, and the server would reject it.)
const want = a.pickups.filter((p) => p.kind === "tome" && p.p[1] < 2.5).sort((p, q) => Math.hypot(p.p[0] - a.pos[0], p.p[2] - a.pos[2]) - Math.hypot(q.p[0] - a.pos[0], q.p[2] - a.pos[2]))[0];
if (!want) {
  check("a Fire Tome to test with (none spawned this time; rerun)", false);
} else {
  const before = a.pickups.length;
  await a.walkTo(want.p[0], want.p[2], want.p[1]);
  await waitFor(() => a.charges > 0, 1500);
  // (3 per tome; 6 if the walk there crossed a second one.)
  check("walking into a Fire Tome gives fireball charges", a.charges === 3 || a.charges === 6, `charges=${a.charges}`);
  check("...and it disappears for everyone", c.pickups.length === before - 1 && !c.pickups.some((p) => p.id === want.id));
}

// ---- Fireball splash ----
if (a.charges > 0) {
  // C stands at 200 degrees inside the ring of walls; A goes to 240 degrees,
  // ~9 m away with nothing between, and throws a fireball at the ground 1.5 m
  // short of C.
  await a.walkTo(...polar(13, 240));
  const dx = c.pos[0] - a.pos[0];
  const dz = c.pos[2] - a.pos[2];
  const d = Math.hypot(dx, dz);
  const cBefore = a.hp.get(c.id)!;
  const chargesBefore = a.charges;
  await sleep(300);
  a.castAt("fireball", [c.pos[0] - (dx / d) * 1.5, 0, c.pos[2] - (dz / d) * 1.5]);
  check("a fireball near someone hurts them (splash)", await waitFor(() => (a.hp.get(c.id) ?? 100) <= cBefore - SPELLS.fireball.splashMin!, 2000), `C ${cBefore} -> ${a.hp.get(c.id)}`);
  check("fireballs use up a charge", a.charges === chargesBefore - 1, `${chargesBefore} -> ${a.charges}`);
}

// ---- The storm ----
// Wait for the first shrink to finish, then stand C outside the circle.
// (Each stage's message starts the next stage, so: wait for the circle to be smaller.)
check("the storm shrinks to the next circle", await waitFor(() => !!a.zone && a.zone.from[2] < 40, 30_000));
const zone = a.zone!;
const [zx, zz, zr] = stormCircle(zone, Date.now());
const away = Math.atan2(c.pos[2] - zz, c.pos[0] - zx);
await c.walkTo(zx + Math.cos(away) * (zr + 4), zz + Math.sin(away) * (zr + 4));
const stormBefore = a.hp.get(c.id)!;
await sleep(2300);
const lost = stormBefore - (a.hp.get(c.id) ?? 0);
check("standing outside the safe circle hurts", lost >= zone.dps * 2, `lost ${lost} in 2.3 s at ${zone.dps}/s`);

// ---- The winner ----
await c.walkTo(...polar(13, 200)); // back in A's sight
await sleep(200);
for (let i = 0; i < 12 && a.alive.includes(c.id); i++) {
  await sleep(COOLDOWN);
  a.castAt("bolt", c.pos);
}
const result = await waitFor(() => a.msgs.some((m) => m.t === "roundResult"), 5000);
const res = a.msgs.find((m) => m.t === "roundResult");
check("the last wizard standing wins", result && res?.t === "roundResult" && res.title.includes("last wizard standing"), res?.t === "roundResult" ? res.title : "");
check("results list everyone with eliminations", res?.t === "roundResult" && res.lines.length === 3 && res.lines[0].includes("2 eliminations"), res?.t === "roundResult" ? res.lines.join(" | ") : "");
await waitFor(() => a.msgs.some((m) => m.t === "xp"), 3000);
const xp = a.msgs.find((m) => m.t === "xp");
check("the winner gets XP: played + win + 2 eliminations", xp?.t === "xp" && xp.amount === 20 + 75 + 2 * 15, xp?.t === "xp" ? `${xp.amount} (${xp.reason})` : "none");

for (const w of [a, b, c]) w.ws.close();
console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);

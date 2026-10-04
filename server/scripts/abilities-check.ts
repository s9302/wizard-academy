// Checks class abilities (Phase 12) against the server: the Wizard's Stone
// Wall (blocks spells, can't go on top of someone) and Earth Pillar (lifts
// you), the Rogue's Shadow Step (teleports, not through walls) and Vanish
// (nobody receives your position until you attack), the Knight's Fortify
// (half damage) and Charge (allowed past the speed check, hits the first
// enemy in the way); cooldowns; bad messages.
//
// Written for The Ruins:
//   ROYALE_ARENA=arena ROYALE_STORM=off ROUND_TIME_SCALE=0.25 GAME_PIN=... SESSION_SECRET=... node server/src/index.ts
//   GAME_PIN=... node server/scripts/abilities-check.ts http://localhost:3000

import WebSocket from "ws";
import { ABILITIES, BLINK_RANGE, CHARGE_DAMAGE, FORTIFY_FACTOR, PILLAR_HEIGHT } from "../../shared/src/abilities.ts";
import { CLASSES } from "../../shared/src/classes.ts";
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
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

const cookies = await Promise.all(["test_abil1", "test_abil2", "test_abil3", "test_abil4"].map((n) => signIn(base, pin, n)));

class P {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  id = 0;
  pos: Vec3 = [0, 0, 0];
  tp = 0;
  state: RoundState | null = null;
  hp = new Map<number, number>(); // health + Ward shield
  closed = false;
  private seq = 0;
  constructor(cookie: string) {
    this.ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
    this.ws.on("open", () => this.send({ t: "hello", room: "royale" }));
    this.ws.on("close", () => (this.closed = true));
    this.ws.on("message", (data) => {
      const m = JSON.parse(data.toString()) as ServerMsg;
      this.msgs.push(m);
      if (m.t === "welcome") {
        this.id = m.id;
        this.pos = m.spawn;
      } else if (m.t === "teleport") {
        this.tp = m.tp;
        this.pos = m.p;
      } else if (m.t === "round") this.state = m.state;
      else if (m.t === "health") this.hp.set(m.id, m.hp + m.shield);
    });
  }
  send(m: object): void {
    this.ws.send(JSON.stringify(m));
  }
  get eye(): Vec3 {
    return [this.pos[0], this.pos[1] + EYE_HEIGHT, this.pos[2]];
  }
  since<T extends ServerMsg["t"]>(t: T, mark: number): Extract<ServerMsg, { t: T }>[] {
    return this.msgs.slice(mark).filter((m) => m.t === t) as Extract<ServerMsg, { t: T }>[];
  }
  ability(slot: 0 | 1, d: Vec3): void {
    this.send({ t: "ability", slot, o: this.eye, d: norm(d) });
  }
  cast(d: Vec3): void {
    this.send({ t: "cast", spell: "bolt", o: this.eye, d: norm(d), seq: ++this.seq });
  }
  step(p: Vec3): void {
    this.pos = p;
    this.send({ t: "move", p, ry: 0, tp: this.tp });
  }
  async walkTo(x: number, z: number): Promise<void> {
    for (let i = 0; i < 600; i++) {
      const dx = x - this.pos[0];
      const dz = z - this.pos[2];
      const d = Math.hypot(dx, dz);
      const s = Math.min(0.45, d);
      this.step(d < 1e-6 ? [x, 0.9, z] : [this.pos[0] + (dx / d) * s, 0.9, this.pos[2] + (dz / d) * s]);
      await sleep(50);
      if (d <= 0.45) return;
    }
  }
  async hold(ms: number): Promise<void> {
    for (let t = 0; t < ms; t += 50) {
      this.step(this.pos);
      await sleep(50);
    }
  }
}

const w = new P(cookies[0]); // Wizard
await waitFor(() => w.id > 0, 5000);
w.send({ t: "class", cls: "wizard" });
const r = new P(cookies[1]); // Rogue
const k = new P(cookies[2]); // Knight
await waitFor(() => r.id > 0 && k.id > 0, 5000);
r.send({ t: "class", cls: "rogue" });
k.send({ t: "class", cls: "knight" });
check("the round starts", await waitFor(() => w.state === "playing", 15_000));
await sleep(300);
// Into the open middle of the arena, inside the ring of walls.
await Promise.all([w.walkTo(...polar(11, 0)), r.walkTo(...polar(11, 120)), k.walkTo(...polar(11, 240))]);

// ---- Stone Wall ----
let mark = w.msgs.length;
w.ability(0, [-1, -0.35, 0]); // toward the middle, at the ground ~4 m away
await waitFor(() => w.since("conjure", mark).length > 0, 2000);
const wall = w.since("conjure", mark)[0];
check("Stone Wall: a wall goes up where you aim", !!wall && wall.box.size[0] === 4.5 && Math.abs(wall.box.pos[0] - (w.pos[0] - 4.5)) < 1.5, JSON.stringify(wall?.box.pos));
check(`...for ${ABILITIES.wall.durationMs! / 1000} s`, !!wall && Math.abs(wall.ms - ABILITIES.wall.durationMs!) < 200);
mark = w.msgs.length;
w.cast([-1, 0, 0]); // straight through where the wall is
await waitFor(() => w.since("spellEnd", mark).length > 0, 2000);
const stopped = w.since("spellEnd", mark)[0];
check("...and it stops spells", !!stopped && Math.abs(stopped.p[0] - (w.pos[0] - 4.5)) < 1.5, JSON.stringify(stopped?.p));
mark = w.msgs.length;
w.ability(0, [-1, -0.35, 0]);
await sleep(400);
check("using it again straight away does nothing (cooldown)", w.since("conjure", mark).length === 0);

// A wall on top of someone: refused, cooldown not spent.
await Promise.all([r.walkTo(w.pos[0] - 4, w.pos[2] - 6), w.hold(1500)]);
await sleep(ABILITIES.wall.cooldownMs + 300);
mark = w.msgs.length;
// Aim just past their feet: walls come back half a meter from where you aim
// (so they don't sink into what you hit), which puts this one right on them.
{
  const [hx, hz] = [r.pos[0] - w.pos[0], r.pos[2] - w.pos[2]];
  const h = Math.hypot(hx, hz);
  const past: Vec3 = [r.pos[0] + (hx / h) * 0.5, r.pos[1] - 0.9, r.pos[2] + (hz / h) * 0.5];
  w.ability(0, norm([past[0] - w.eye[0], past[1] - w.eye[1], past[2] - w.eye[2]]));
}
await waitFor(() => w.since("abilityFailed", mark).length + w.since("conjure", mark).length > 0, 2000);
check("a wall can't be put on top of someone", w.since("abilityFailed", mark).length === 1 && w.since("conjure", mark).length === 0, JSON.stringify(w.since("abilityFailed", mark)[0]));

// ---- Earth Pillar under your own feet ----
mark = w.msgs.length;
const floorY = w.pos[1] - 0.9;
w.ability(1, [0, -1, 0]);
await waitFor(() => w.since("teleport", mark).length > 0, 2000);
check("Earth Pillar at your feet lifts you onto it", Math.abs(w.pos[1] - (floorY + PILLAR_HEIGHT + 0.95)) < 0.1, `y=${w.pos[1]}`);
await w.hold(300);
w.step([w.pos[0], floorY + 0.9, w.pos[2]]); // and hop down (a fall, but a short one)
await w.hold(300);

// ---- Shadow Step ----
await r.walkTo(...polar(11, 120));
await r.hold(300);
mark = r.msgs.length;
const before = r.pos;
const away = norm([-before[0], 0, -before[2]]); // toward the middle (open, but the dais is in the way)
r.ability(0, [away[2], 0, -away[0]]); // sideways along the ring: open ground
await waitFor(() => r.since("teleport", mark).length + r.since("abilityFailed", mark).length > 0, 2000);
if (r.since("abilityFailed", mark).length) console.log("     (refused:", r.since("abilityFailed", mark)[0].reason, "at", r.pos, ")");
const jumped = Math.hypot(r.pos[0] - before[0], r.pos[2] - before[2]);
check(`Shadow Step moves you up to ${BLINK_RANGE} m`, jumped > 8 && jumped <= BLINK_RANGE + 0.5, `${jumped.toFixed(1)} m`);

// ---- Vanish ----
await sleep(200);
mark = k.msgs.length;
r.ability(1, [1, 0, 0]);
await waitFor(() => k.since("effect", mark).some((e) => e.kind === "stealth" && e.ms > 0), 2000);
check("Vanish: everyone hears you vanished", k.since("effect", mark).some((e) => e.id === r.id && e.kind === "stealth"));
const hidden = k.msgs.length;
await r.walkTo(r.pos[0] + 2, r.pos[2]);
await r.hold(500);
check("...and while hidden, nobody receives where you are", !k.since("moved", hidden).some((m) => m.id === r.id));
mark = k.msgs.length;
r.cast([0, -1, 0]); // attacking ends it
await waitFor(() => k.since("effect", mark).some((e) => e.id === r.id && e.kind === "stealth" && e.ms === 0), 2000);
check("...attacking ends it, and your position comes back", k.since("effect", mark).some((e) => e.id === r.id && e.ms === 0) && k.since("moved", mark).some((m) => m.id === r.id));

// ---- Fortify ----
await Promise.all([w.walkTo(...polar(11, 300)), k.walkTo(...polar(11, 260)), r.hold(4000)]);
await sleep(600);
mark = w.msgs.length;
k.ability(1, [1, 0, 0]);
await waitFor(() => w.since("effect", mark).some((e) => e.id === k.id && e.kind === "fortify"), 2000);
const kBefore = w.hp.get(k.id)!;
w.cast(norm([k.pos[0] - w.pos[0], k.pos[1] - w.pos[1], k.pos[2] - w.pos[2]]));
const fortified = Math.round(SPELLS.bolt.damage * (1 - CLASSES.knight.defense) * FORTIFY_FACTOR);
check(`Fortify: a bolt does only ${fortified} to a fortified Knight`, await waitFor(() => w.hp.get(k.id) === kBefore - fortified, 2000), `${kBefore} -> ${w.hp.get(k.id)}`);

// ---- Charge ----
await sleep(ABILITIES.fortify.durationMs! + 200);
await w.hold(300);
mark = k.msgs.length;
const wBefore = k.hp.get(w.id)!;
k.ability(0, norm([w.pos[0] - k.pos[0], 0, w.pos[2] - k.pos[2]]));
await sleep(100);
// Rush at the wizard at charge speed (about 1.2 m per move, 20 moves a second).
for (let i = 0; i < 12; i++) {
  const dx = w.pos[0] - k.pos[0];
  const dz = w.pos[2] - k.pos[2];
  const d = Math.hypot(dx, dz);
  if (d < 0.8) break;
  const s = Math.min(1.15, d - 0.6);
  k.step([k.pos[0] + (dx / d) * s, 0.9, k.pos[2] + (dz / d) * s]);
  await sleep(50);
}
await k.hold(400);
check("Charge: the rush isn't snapped back as too fast", !k.since("teleport", mark).length);
check(`...and the first enemy in the way takes ${CHARGE_DAMAGE}`, await waitFor(() => k.hp.get(w.id) === wBefore - CHARGE_DAMAGE, 1500), `${wBefore} -> ${k.hp.get(w.id)}`);
check("...shown as a hit", k.since("melee", mark).some((m) => m.id === k.id && m.hits.includes(w.id)));

// ---- Bad messages ----
{
  const x = new P(cookies[3]);
  await waitFor(() => x.id > 0, 5000);
  x.send({ t: "ability", slot: 2, o: x.eye, d: [1, 0, 0] });
  check("an ability slot that doesn't exist is rejected", await waitFor(() => x.closed, 2000));
}

for (const p of [w, r, k]) p.ws.close();
console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);

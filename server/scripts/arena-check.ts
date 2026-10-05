// Checks Phase 11's arena features: the vote between rounds (one arena of
// each size on offer, plus a fourth, the winner loads, spawns are in it, the storm fits
// it), no fall damage, and landing on someone (hurts them, bounces you).
//
// The server has no collision for movement (by design), so the test
// "climbs" by sending moves straight up at a legal speed.
//
//   ROUND_TIME_SCALE=0.25 GAME_PIN=... SESSION_SECRET=... node server/src/index.ts
//   GAME_PIN=... node server/scripts/arena-check.ts http://localhost:3000
//
// Creates test accounts; run it against a fresh test server (it expects the
// battle royale room to be empty when it starts).

import WebSocket from "ws";
import { LEVELS } from "../../shared/src/levels/index.ts";
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

const cookies = await Promise.all(["test_arena1", "test_arena2"].map((n) => signIn(base, pin, n)));

class P {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  id = 0;
  pos: Vec3 = [0, 0, 0];
  tp = 0;
  state: RoundState | null = null;
  hp = new Map<number, number>(); // health + Ward shield
  constructor(cookie: string) {
    this.ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
    this.ws.on("open", () => this.send({ t: "hello", room: "royale" }));
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
  last<T extends ServerMsg["t"]>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    return [...this.msgs].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined;
  }
  since<T extends ServerMsg["t"]>(t: T, mark: number): Extract<ServerMsg, { t: T }>[] {
    return this.msgs.slice(mark).filter((m) => m.t === t) as Extract<ServerMsg, { t: T }>[];
  }
  // Move vertically at `speed` m/s (20 moves a second) to height y.
  async moveY(y: number, speed: number): Promise<void> {
    const step = speed / 20;
    while (Math.abs(this.pos[1] - y) > 1e-6) {
      const dy = Math.max(-step, Math.min(step, y - this.pos[1]));
      this.pos = [this.pos[0], this.pos[1] + dy, this.pos[2]];
      this.send({ t: "move", p: this.pos, ry: 0, tp: this.tp });
      await sleep(50);
    }
  }
  async hold(ms: number): Promise<void> {
    for (let t = 0; t < ms; t += 50) {
      this.send({ t: "move", p: this.pos, ry: 0, tp: this.tp });
      await sleep(50);
    }
  }
  async walkTo(x: number, z: number): Promise<void> {
    for (let i = 0; i < 400; i++) {
      const dx = x - this.pos[0];
      const dz = z - this.pos[2];
      const d = Math.hypot(dx, dz);
      if (d < 0.05) return;
      const s = Math.min(0.35, d);
      this.pos = [this.pos[0] + (dx / d) * s, this.pos[1], this.pos[2] + (dz / d) * s];
      this.send({ t: "move", p: this.pos, ry: 0, tp: this.tp });
      await sleep(50);
    }
  }
}

// ---- The vote ----
const a = new P(cookies[0]);
await waitFor(() => !!a.last("arenaVote")?.options.length, 5000);
const offer = a.last("arenaVote")!;
const sizes = offer.options.map((id) => LEVELS[id]?.arena?.size);
check("a vote opens with four arenas: one of each size, and one more", sizes.length === 4 && sizes.slice(0, 3).join(",") === "small,medium,large" && new Set(offer.options).size === 4, offer.options.join(", "));
const pick = offer.options[0]; // the small one
a.send({ t: "vote", arena: pick });
await waitFor(() => a.last("arenaVote")?.votes[pick] === 1, 2000);
check("the vote is counted for everyone to see", a.last("arenaVote")?.votes[pick] === 1);
a.send({ t: "vote", arena: "not-an-arena" });
await sleep(300);
check("a vote for something not on offer is ignored", a.last("arenaVote")?.votes[pick] === 1 && a.ws.readyState === WebSocket.OPEN);

const b = new P(cookies[1]); // two players: the countdown starts, the vote closes
check("when the countdown starts, the winner loads", await waitFor(() => a.last("arena")?.levelId === pick, 8000), `arena=${a.last("arena")?.levelId}`);
const level = LEVELS[pick];
await waitFor(() => a.state === "playing", 15_000);
await sleep(300);
const spawns = level.spawnPoints!.map((s) => s.join(","));
check(`everyone spawns in ${level.name}`, spawns.includes(a.pos.join(",")) && spawns.includes(b.pos.join(",")), `${a.pos} / ${b.pos}`);
check(`the storm fits the arena (starts at ${level.arena!.stormRadius} m)`, a.last("zone")?.zone?.from[2] === level.arena!.stormRadius, JSON.stringify(a.last("zone")?.zone?.from));

// ---- Fall damage ----
const floor = a.pos[1];
await a.moveY(floor + 8, 5); // up 8 m (a tower, as far as the server knows)
await a.hold(400);
let before = b.hp.get(a.id)!;
let mark = a.msgs.length;
await a.moveY(floor, 16); // and drop
await a.hold(400);
const lost = before - (b.hp.get(a.id) ?? before);
check("an 8 m fall doesn't hurt (no fall damage)", lost === 0, `lost ${lost}`);
await a.moveY(floor + 8, 5);
await a.hold(400);
before = b.hp.get(a.id)!;
await a.moveY(floor, 3); // walking down, like a ramp
await a.hold(400);
check("coming down 8 m slowly (a ramp) doesn't", b.hp.get(a.id) === before, `${before} -> ${b.hp.get(a.id)}`);

// ---- Landing on someone ----
await Promise.all([a.walkTo(b.pos[0], b.pos[2]), b.hold(3000)]);
await a.moveY(b.pos[1] + 6, 5);
await Promise.all([a.hold(300), b.hold(300)]);
mark = a.msgs.length;
const aBefore = a.hp.get(a.id)!;
const bBefore = a.hp.get(b.id)!;
await Promise.all([a.moveY(b.pos[1], 16), b.hold(1200)]);
await Promise.all([a.hold(400), b.hold(400)]);
const bLost = bBefore - (a.hp.get(b.id) ?? bBefore);
check("landing on someone hurts them (25 + 3 per meter)", bLost >= 25 && bLost <= 55, `B lost ${bLost}`);
check("...you bounce off", a.since("bounce", mark).length === 1);
check("...and take no fall damage yourself", a.hp.get(a.id) === aBefore, `${aBefore} -> ${a.hp.get(a.id)}`);
check("...and everyone hears about it", a.since("announce", mark).some((m) => m.text.includes("landed on")));

// ---- The vote reopens after the round ----
a.ws.close();
check("after the round, a new vote opens", await waitFor(() => (b.since("arenaVote", 0).at(-1)?.options.length ?? 0) === 4 && b.state === "waiting", 15_000), `state=${b.state}`);
b.ws.close();

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);

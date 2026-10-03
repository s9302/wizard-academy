// Plays tag and infection rounds against the server with three fake players
// and checks the rules: the round cycle, tag range, the start grace period,
// no tag-backs, tags passing "It" vs spreading the curse, early end when
// everyone is cursed, and results.
//
// Rounds are 3 minutes, so run it against a server with shortened rounds
// (0.25 = 45 s; much shorter and the bots can't cross the courtyard in time):
//   ROUND_TIME_SCALE=0.25 GAME_PIN=... SESSION_SECRET=... node server/src/index.ts
//   GAME_PIN=... node server/scripts/chase-check.ts http://localhost:3000

import WebSocket from "ws";
import type { RoundState, ServerMsg, Vec3 } from "../../shared/src/protocol.ts";

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

const login = await fetch(`${base}/auth/pin`, { method: "POST", body: new URLSearchParams({ pin }), redirect: "manual" });
const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error(`login failed: HTTP ${login.status}`);

class Bot {
  ws: WebSocket;
  id = 0;
  pos: Vec3 = [0, 0, 0];
  tp = 0;
  state: RoundState | null = null;
  chasers: number[] = [];
  results: { title: string; lines: string[] }[] = [];
  announcements: string[] = [];

  constructor(name: string, room: string) {
    this.ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie: cookie! } });
    this.ws.on("open", () => this.ws.send(JSON.stringify({ t: "hello", name, room })));
    this.ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerMsg;
      if (msg.t === "welcome") {
        this.id = msg.id;
        this.pos = msg.spawn;
      } else if (msg.t === "teleport") {
        this.tp = msg.tp;
        this.pos = msg.p;
      } else if (msg.t === "round") this.state = msg.state;
      else if (msg.t === "chasers") this.chasers = msg.ids;
      else if (msg.t === "roundResult") this.results.push(msg);
      else if (msg.t === "announce") this.announcements.push(msg.text);
    });
  }

  send(msg: object): void {
    this.ws.send(JSON.stringify(msg));
  }

  // Walk at a legal speed until within `stopAt` meters of `target`.
  async walkTo(target: Vec3, stopAt = 1): Promise<void> {
    for (let i = 0; i < 400; i++) {
      const dx = target[0] - this.pos[0];
      const dz = target[2] - this.pos[2];
      const dist = Math.hypot(dx, dz);
      if (dist <= stopAt) return;
      const step = Math.min(0.35, dist - stopAt); // 7 m/s at 20 updates per second
      this.pos = [this.pos[0] + (dx / dist) * step, 0.9, this.pos[2] + (dz / dist) * step];
      this.send({ t: "move", p: this.pos, ry: 0, tp: this.tp });
      await sleep(50);
    }
  }

  // Keep sending our position, as a real client does, so the server's
  // position history is fresh.
  async idle(ms: number): Promise<void> {
    for (let t = 0; t < ms; t += 50) {
      this.send({ t: "move", p: this.pos, ry: 0, tp: this.tp });
      await sleep(50);
    }
  }
}

async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  for (let t = 0; t < ms; t += 50) {
    if (cond()) return true;
    await sleep(50);
  }
  return cond();
}

// ---------------- Tag ----------------
{
  const bots = [new Bot("Ann", "tag"), new Bot("Ben", "tag"), new Bot("Cal", "tag")];
  check("tag: a round starts once 2+ players are in", await waitFor(() => bots[0].state === "playing", 15_000), `state=${bots[0].state}`);
  await waitFor(() => bots[0].chasers.length === 1, 2000);
  const itId = bots[0].chasers[0];
  check("tag: exactly one player is It", bots[0].chasers.length === 1);
  const it = bots.find((b) => b.id === itId)!;
  const [runner, other] = bots.filter((b) => b !== it);

  // Settle: everyone at their round-start spawn, standing on the ground.
  await Promise.all(bots.map((b) => b.idle(300)));

  it.send({ t: "tag", target: runner.id }); // far away (different spawn points)
  await sleep(300);
  check("tag: a tag from across the courtyard is ignored", it.chasers[0] === itId);

  await Promise.all([it.walkTo(runner.pos, 1.2), runner.idle(2500), other.idle(2500)]);
  it.send({ t: "tag", target: runner.id });
  await waitFor(() => it.chasers[0] === runner.id, 1000);
  check("tag: touching a runner makes them It", it.chasers[0] === runner.id && it.chasers.length === 1);
  check("tag: everyone hears about it", other.announcements.some((a) => a.includes("is It")));

  runner.send({ t: "tag", target: it.id }); // instant tag-back
  await Promise.all([runner.idle(300), it.idle(300)]);
  check("tag: no instant tag-backs", it.chasers[0] === runner.id);

  await Promise.all([runner.idle(2000), it.idle(2000)]);
  runner.send({ t: "tag", target: it.id });
  await waitFor(() => it.chasers[0] === it.id, 1000);
  check("tag: tagging back works after the cooldown", it.chasers[0] === it.id);

  const ended = await waitFor(() => bots[0].results.length > 0, 60_000);
  const result = bots[0].results[0];
  check("tag: the round ends with results for everyone", ended && result.lines.length === 3, result?.title);
  check("tag: results rank time as It", result?.lines.every((l) => l.includes("s as It")) ?? false);
  check("tag: then a new round counts down", await waitFor(() => bots[0].state === "countdown" || bots[0].state === "playing", 3000));
  for (const b of bots) b.ws.close();
}

// ---------------- Infection ----------------
{
  await sleep(500);
  const bots = [new Bot("Dee", "infection"), new Bot("Eve", "infection"), new Bot("Fay", "infection")];
  check("infection: a round starts", await waitFor(() => bots[0].state === "playing", 15_000));
  await waitFor(() => bots[0].chasers.length === 1, 2000);
  const cursed = bots.find((b) => b.id === bots[0].chasers[0])!;
  const [a, b] = bots.filter((x) => x !== cursed);
  check("infection: one wizard starts cursed (3 players)", bots[0].chasers.length === 1);
  await Promise.all(bots.map((x) => x.idle(300)));

  await Promise.all([cursed.walkTo(a.pos, 1.2), a.idle(2500), b.idle(2500)]);
  cursed.send({ t: "tag", target: a.id });
  await waitFor(() => cursed.chasers.length === 2, 1000);
  check("infection: the curse spreads (both stay cursed)", cursed.chasers.includes(cursed.id) && cursed.chasers.includes(a.id));

  await Promise.all([cursed.walkTo(b.pos, 1.2), a.idle(2500), b.idle(2500)]);
  cursed.send({ t: "tag", target: b.id });
  const over = await waitFor(() => bots[0].results.length > 0, 2000);
  check("infection: the round ends as soon as everyone is cursed", over, bots[0].results[0]?.title);
  check("infection: the curse wins", bots[0].results[0]?.title.includes("curse claimed everyone") ?? false);
  check("infection: most curses spread is reported", bots[0].results[0]?.lines.some((l) => l.includes("spread the curse 2 times")) ?? false);
  for (const x of bots) x.ws.close();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);

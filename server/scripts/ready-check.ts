// Checks the ready vote: in the battle royale a round doesn't start until
// more than half the players have voted (Enter), and a vote can be taken
// back; the boss fight waits for its one player too.
//
//   ROUND_READY=on ROUND_TIME_SCALE=0.25 ... node server/src/index.ts
//   GAME_PIN=... node server/scripts/ready-check.ts http://localhost:3000

import WebSocket from "ws";
import type { ServerMsg } from "../../shared/src/protocol.ts";
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

function join(cookie: string, room: string) {
  const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
  const me = { id: 0, state: "", ready: [] as number[], needed: 0, lineup: [] as { id: number; bot: boolean; cls: string; team: 0 | 1 | null }[], next: "", teams: null as [number[], number[]] | null, equips: new Map<number, string>() };
  ws.on("message", (d) => {
    const m = JSON.parse(d.toString()) as ServerMsg;
    if (m.t === "welcome") me.id = m.id;
    if (m.t === "round") me.state = m.state;
    if (m.t === "lineup") {
      me.lineup = m.players;
      me.next = m.next;
    }
    if (m.t === "teams") me.teams = m.teams;
    if (m.t === "equip") me.equips.set(m.id, m.cls);
    if (m.t === "readyState") {
      me.ready = m.ids;
      me.needed = m.needed;
    }
  });
  ws.on("open", () => ws.send(JSON.stringify({ t: "hello", room })));
  return { ws, me, ready: () => ws.send(JSON.stringify({ t: "ready" })), send: (m: object) => ws.send(JSON.stringify(m)) };
}

const [ca, cb] = await Promise.all([signIn(base, pin, "test_ready_a"), signIn(base, pin, "test_ready_b")]);

// ---- Battle royale: two players, both must vote ----
const a = join(ca, "royale");
const b = join(cb, "royale");
await waitFor(() => a.me.id > 0 && b.me.id > 0 && a.me.needed === 2, 5000);
await sleep(1500);
check("two players: the round waits for votes", a.me.state === "waiting", a.me.state);
check("...it needs 2 of 2 (more than half)", a.me.needed === 2, `${a.me.needed}`);
a.ready();
await waitFor(() => a.me.ready.length === 1, 2000);
await sleep(1000);
check("one vote isn't enough", a.me.state === "waiting" && a.me.ready.length === 1, `${a.me.state}, ${a.me.ready.length} votes`);
a.ready(); // take it back
await waitFor(() => a.me.ready.length === 0, 2000);
check("a vote can be taken back", a.me.ready.length === 0);
// ---- Teams: the mode switch, picking teams, a bot's class and team ----
a.send({ t: "mode", mode: "teams" });
check("the mode switch sets Teams for the next round", await waitFor(() => a.me.next === "teams", 2000), a.me.next);
a.send({ t: "pickTeam", team: 1 });
b.send({ t: "pickTeam", team: 1 });
a.send({ t: "bots", action: "add" });
await waitFor(() => a.me.lineup.some((p) => p.bot), 3000);
const botId = a.me.lineup.find((p) => p.bot)!.id;
a.send({ t: "botSet", id: botId, cls: "cleric", team: 0 });
check("a bot's class and team can be set", await waitFor(() => { const e = a.me.lineup.find((p) => p.id === botId); return e?.cls === "cleric" && e.team === 0; }, 2000));
a.ready();
b.ready();
check("both votes: the countdown starts", await waitFor(() => a.me.state === "countdown" || a.me.state === "playing", 3000), a.me.state);
check("...and the votes are cleared for next time", await waitFor(() => a.me.ready.length === 0, 2000));
await waitFor(() => !!a.me.teams, 8000);
const t = a.me.teams;
check("everyone is on the team they picked (both people Blue, the bot Red)", !!t && t[1].includes(a.me.id) && t[1].includes(b.me.id) && t[0].includes(botId), JSON.stringify(t));
check("...and the bot plays a Cleric", a.me.equips.get(botId) === "cleric", a.me.equips.get(botId));
a.ws.close();
b.ws.close();

// ---- The boss fight: one player, one vote ----
await sleep(300);
const c = join(ca, "trial7");
await waitFor(() => c.me.id > 0 && c.me.needed === 1, 5000);
await sleep(1500);
check("the boss fight waits for its player to vote", c.me.state === "waiting", c.me.state);
c.ready();
check("...then it starts", await waitFor(() => c.me.state === "countdown" || c.me.state === "playing", 3000), c.me.state);
c.ws.close();

console.log(failures ? `${failures} FAILED` : "all checks passed");
process.exit(failures ? 1 : 0);

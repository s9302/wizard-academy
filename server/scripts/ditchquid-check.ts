// Ditchquid: two players are put on opposite teams; flying into the ball
// grabs it; a throw through the other team's hoop scores 10 (one carried
// through doesn't); a jinx knocks the ball loose and slows; and bots play a
// whole match (they fly, grab, throw, and now and then score). A carrier
// who's just caught it can't be knocked loose for DQ.ball.holdMs.
//
// Creates test accounts, so run it against a test stack, never production.
//
//   ROUND_TIME_SCALE=0.25 GAME_PIN=... SESSION_SECRET=... node server/src/index.ts
//   GAME_PIN=... node server/scripts/ditchquid-check.ts http://localhost:3000

import WebSocket from "ws";
import { DQ } from "../../shared/src/ditchquid.ts";
import { EYE_HEIGHT } from "../../shared/src/constants.ts";
import { ditchfield } from "../../shared/src/levels/ditchfield.ts";
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
  const me = { id: 0, pos: [0, 0, 0] as Vec3, tp: 0, state: "", team: -1, ball: null as { p: Vec3; carrier: number | null } | null, score: [0, 0] };
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
    if (m.t === "dqTeams") me.team = m.teams[0].includes(me.id) ? 0 : m.teams[1].includes(me.id) ? 1 : -1;
    if (m.t === "dqBall") me.ball = { p: m.p, carrier: m.carrier };
    if (m.t === "dqScore") me.score = m.score;
  });
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ t: "hello", room: "ditchquid" }));
  await waitFor(() => me.id > 0, 5000);
  const send = (m: object) => ws.send(JSON.stringify(m));
  // Fly in a straight line at broom speed (moves 20 times a second).
  const flyTo = async (target: Vec3, speed = 10) => {
    const from = me.pos;
    const tp = me.tp;
    const steps = Math.max(1, Math.ceil(Math.hypot(target[0] - from[0], target[1] - from[1], target[2] - from[2]) / (speed / 20)));
    for (let i = 1; i <= steps && me.tp === tp; i++) {
      const t = i / steps;
      me.pos = [from[0] + (target[0] - from[0]) * t, from[1] + (target[1] - from[1]) * t, from[2] + (target[2] - from[2]) * t];
      send({ t: "move", p: me.pos, ry: 0, tp: me.tp, b: true });
      await sleep(50);
    }
    await sleep(100);
  };
  return { ws, me, msgs, send, flyTo, since: (i: number) => msgs.slice(i) };
}

const a = await enter("test_dq_a");
const b = await enter("test_dq_b");
check("a match starts", await waitFor(() => a.me.state === "playing" && b.me.state === "playing", 30000), a.me.state);
check("the two players are on opposite teams", a.me.team >= 0 && b.me.team >= 0 && a.me.team !== b.me.team, `${a.me.team} / ${b.me.team}`);
await waitFor(() => !!a.me.ball, 2000);

// Fly to the ball: it's yours.
await a.flyTo([a.me.ball!.p[0], a.me.ball!.p[1] - 0.2, a.me.ball!.p[2]]);
check("flying into the ball grabs it", await waitFor(() => a.me.ball?.carrier === a.me.id, 2000), JSON.stringify(a.me.ball));

// Carry it through an enemy hoop: no goal.
const theirs = ditchfield.ditchquid!.hoops.filter((h) => h.team !== a.me.team);
const hoop = theirs[1];
const side = Math.sign(-hoop.pos[0]); // from the hoop back toward midfield
await a.flyTo([hoop.pos[0] + side * 6, hoop.pos[1] - 0.2, hoop.pos[2]], 16);
await a.flyTo([hoop.pos[0] - side * 2, hoop.pos[1] - 0.2, hoop.pos[2]], 8);
await sleep(300);
check("carrying it through a hoop doesn't score", a.me.score[0] === 0 && a.me.score[1] === 0, JSON.stringify(a.me.score));

// Back out in front and throw it through.
await a.flyTo([hoop.pos[0] + side * 8, hoop.pos[1] - 0.2, hoop.pos[2]], 8);
const eye: Vec3 = [a.me.pos[0], a.me.pos[1] + EYE_HEIGHT, a.me.pos[2]];
const tt = Math.abs(hoop.pos[0] - eye[0]) / DQ.ball.speed;
const aim: Vec3 = [hoop.pos[0], hoop.pos[1] + 0.5 * DQ.ball.gravity * tt * tt, hoop.pos[2]];
const l = Math.hypot(aim[0] - eye[0], aim[1] - eye[1], aim[2] - eye[2]);
let mark = a.msgs.length;
a.send({ t: "dqThrow", d: [(aim[0] - eye[0]) / l, (aim[1] - eye[1]) / l, (aim[2] - eye[2]) / l] });
check("a throw through the other team's hoop scores 10", await waitFor(() => a.me.score[a.me.team] === DQ.goalPoints, 3000), JSON.stringify(a.me.score));
check("...the goal is announced", a.since(mark).some((m) => m.t === "dqGoal" && m.by === a.me.id));
check("...and the ball goes back to midfield", await waitFor(() => a.me.ball?.carrier === null && Math.hypot(a.me.ball.p[0], a.me.ball.p[2]) < 1, 2000), JSON.stringify(a.me.ball?.p));

// A jinx knocks the ball loose.
await waitFor(() => false, DQ.resetMs * 0.25 + 300); // the reset (scaled in test rooms)
await a.flyTo([a.me.ball!.p[0], a.me.ball!.p[1] - 0.2, a.me.ball!.p[2]], 14);
await waitFor(() => a.me.ball?.carrier === a.me.id, 3000);
await sleep(DQ.ball.holdMs); // just caught: a jinx can't knock it loose yet
await b.flyTo([a.me.pos[0] + 8, a.me.pos[1], a.me.pos[2]], 18);
const bEye: Vec3 = [b.me.pos[0], b.me.pos[1] + EYE_HEIGHT, b.me.pos[2]];
const to: Vec3 = [a.me.pos[0] - bEye[0], a.me.pos[1] - bEye[1], a.me.pos[2] - bEye[2]];
const tl = Math.hypot(...to);
mark = b.msgs.length;
b.send({ t: "dqJinx", o: bEye, d: [to[0] / tl, to[1] / tl, to[2] / tl] });
check("a jinx hits the carrier", await waitFor(() => b.since(mark).some((m) => m.t === "dqJinxEnd" && m.hit === a.me.id), 2000));
check("...and knocks the ball loose", await waitFor(() => a.me.ball?.carrier !== a.me.id, 1000), JSON.stringify(a.me.ball));
mark = b.msgs.length;
b.send({ t: "dqJinx", o: bEye, d: [to[0] / tl, to[1] / tl, to[2] / tl] });
await sleep(400);
check("jinxes have a cooldown", !b.since(mark).some((m) => m.t === "dqJinxCast"));
// (Teleports at the start of the round are expected; a rejected move would
// be a teleport back after play began.)
const playStart = (who: typeof a) => who.msgs.findIndex((m) => m.t === "round" && m.state === "playing");
check("nobody's moves were rejected (brooms are allowed here)", !a.since(playStart(a)).some((m) => m.t === "teleport") && !b.since(playStart(b)).some((m) => m.t === "teleport"));

// Bots: a whole match with four of them.
b.ws.close();
for (let i = 0; i < 4; i++) {
  a.send({ t: "bots", action: "add" });
  await sleep(1100);
}
await waitFor(() => a.me.state === "ended", 120000);
mark = a.msgs.length;
await waitFor(() => a.me.state === "playing", 30000);
const ballPositions: Vec3[] = [];
const carriers = new Set<number>();
const start = Date.now();
while (a.me.state === "playing" && Date.now() - start < 120000) {
  if (a.me.ball) {
    ballPositions.push(a.me.ball.p);
    if (a.me.ball.carrier !== null) carriers.add(a.me.ball.carrier);
  }
  await sleep(200);
}
const travelled = ballPositions.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - ballPositions[i - 1][0], p[2] - ballPositions[i - 1][2]) : 0), 0);
const casts = a.since(mark).filter((m) => m.t === "dqJinxCast").length;
const goals = a.since(mark).filter((m) => m.t === "dqGoal").length;
check("bots grab the ball", carriers.size >= 2, `${carriers.size} different carriers`);
check("...move it around the pitch", travelled > 150, `${travelled.toFixed(0)} m`);
check("...cast jinxes, but not constantly", casts > 3 && casts < 4 * 60, `${casts} in ${((Date.now() - start) / 1000).toFixed(0)} s`);
check("...and score", goals > 0, `${goals} goals`);
const result = a.since(mark).find((m) => m.t === "roundResult");
console.log(`      result: ${result?.t === "roundResult" ? `${result.title} / ${result.lines.join(" / ")}` : "none"}`);

a.ws.close();
console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exit(failures ? 1 : 0);

// Checks that the server's in-game protections work: legit movement passes,
// cheats are snapped back or kicked, respawn is only allowed when falling,
// and message floods are cut off. Run it after changing MoveCheck or limits.
//
//   GAME_PIN=... node server/scripts/security-check.ts http://game:8080
//
// Uses 4 connections, one after another, in the playground room.

import WebSocket from "ws";
import type { ServerMsg, Vec3 } from "../../shared/src/protocol.ts";
import { signIn } from "./signIn.ts";

const base = (process.argv[2] ?? "http://localhost:8080").replace(/\/$/, "");
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

const cookie = await signIn(base, pin, "test_security");

class TestClient {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  tp = 0;
  spawn: Vec3 | null = null;
  closed: string | null = null;

  constructor(name: string) {
    this.ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
    this.ws.on("open", () => this.ws.send(JSON.stringify({ t: "hello", room: "playground" })));
    this.ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerMsg;
      this.msgs.push(msg);
      if (msg.t === "welcome") this.spawn = msg.spawn;
      if (msg.t === "teleport") this.tp = msg.tp;
    });
    this.ws.on("close", (code, reason) => (this.closed = `${code} ${reason}`));
  }

  async ready(): Promise<Vec3> {
    for (let i = 0; i < 100 && !this.spawn; i++) await sleep(20);
    if (!this.spawn) throw new Error("no welcome");
    return this.spawn;
  }

  move(p: Vec3): void {
    this.ws.send(JSON.stringify({ t: "move", p, ry: 0, tp: this.tp }));
  }

  teleports(): Extract<ServerMsg, { t: "teleport" }>[] {
    return this.msgs.filter((m): m is Extract<ServerMsg, { t: "teleport" }> => m.t === "teleport");
  }
}

// 1-2. Legit running, then a lag burst.
{
  const c = new TestClient("Legit");
  const [sx, , sz] = await c.ready();
  let x = sx;
  for (let i = 0; i < 40; i++) {
    x += 8 * 0.05; // run speed, 20 updates per second
    c.move([x, 0.9, sz]);
    await sleep(50);
  }
  await sleep(200);
  check("running at full speed is accepted", c.teleports().length === 0);

  await sleep(1000);
  for (let i = 0; i < 20; i++) {
    x += 8 * 0.05;
    c.move([x, 0.9, sz]); // one second of movement arriving all at once
  }
  await sleep(200);
  check("a 1 s lag burst is accepted", c.teleports().length === 0);
  c.ws.close();
}

// 3-4. Teleport cheat: snapped back, then kicked when repeated.
{
  const c = new TestClient("Teleporter");
  const spawn = await c.ready();
  c.move([spawn[0] + 50, spawn[1], spawn[2]]);
  await sleep(200);
  const back = c.teleports()[0]?.p;
  check("a 50 m teleport is snapped back", JSON.stringify(back) === JSON.stringify(spawn));
  for (let i = 0; i < 6 && !c.closed; i++) {
    c.move([spawn[0] + 50 + i, spawn[1], spawn[2]]);
    await sleep(150);
  }
  await sleep(300);
  check("repeated cheating gets kicked", c.closed?.includes("Movement rejected") ?? false, c.closed ?? "still open");
}

// 5-7. Flying, and respawn rules.
{
  const c = new TestClient("Flyer");
  const spawn = await c.ready();
  c.move([spawn[0], spawn[1] + 10, spawn[2]]);
  await sleep(200);
  check("flying 10 m straight up is snapped back", c.teleports().length === 1);

  const before = c.teleports().length;
  c.ws.send(JSON.stringify({ t: "respawn" }));
  await sleep(200);
  check("respawn while standing is ignored", c.teleports().length === before);

  let y = spawn[1];
  while (y > -25) {
    y -= 2;
    c.move([spawn[0], y, spawn[2]]);
    await sleep(50);
  }
  c.ws.send(JSON.stringify({ t: "respawn" }));
  await sleep(200);
  const last = c.teleports().at(-1)?.p;
  check("respawn after falling works", c.teleports().length === before + 1 && (last?.[1] ?? -99) > 0);
  c.ws.close();
}

// 8. Message flood.
{
  const c = new TestClient("Flooder");
  const spawn = await c.ready();
  for (let i = 0; i < 200; i++) c.move(spawn);
  await sleep(300);
  check("200 messages at once gets kicked", c.closed?.includes("Too many messages") ?? false, c.closed ?? "still open");
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);

// Checks the hub (Phase 6): a plain hello lands you at the hub spawn; coming
// back from a room (hello.from) puts you in front of that room's portal,
// facing the plaza; the portal signs get live player counts; and a junk
// "from" is ignored or rejected rather than trusted.
//
// Creates test accounts, so run it against a test stack, never production.
//
//   GAME_PIN=... node server/scripts/hub-check.ts http://localhost:3000

import WebSocket from "ws";
import { academy } from "../../shared/src/levels/academy.ts";
import type { ClientMsg, ServerMsg } from "../../shared/src/protocol.ts";
import { signIn } from "./signIn.ts";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const pin = process.env.GAME_PIN;
if (!pin) {
  console.error("Set GAME_PIN in the environment.");
  process.exit(1);
}

type Client = { socket: WebSocket; messages: ServerMsg[]; closed: Promise<void>; send: (msg: ClientMsg | Record<string, unknown>) => void };

function connect(cookie: string): Promise<Client> {
  const socket = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie, origin: base } });
  const messages: ServerMsg[] = [];
  socket.on("message", (data) => messages.push(JSON.parse(data.toString()) as ServerMsg));
  const closed = new Promise<void>((resolve) => socket.on("close", () => resolve()));
  const send = (msg: ClientMsg | Record<string, unknown>) => socket.send(JSON.stringify(msg));
  return new Promise((resolve, reject) => {
    socket.on("open", () => resolve({ socket, messages, closed, send }));
    socket.on("error", reject);
  });
}

async function waitFor<T extends ServerMsg["t"]>(c: Client, t: T, ms = 4000): Promise<Extract<ServerMsg, { t: T }> | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const found = c.messages.find((m) => m.t === t);
    if (found) return found as Extract<ServerMsg, { t: T }>;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
};

const alice = await signIn(base, pin, "hubcheck1");
const bob = await signIn(base, pin, "hubcheck2");

// 1. Plain hello: the hub spawn, and the portal counts right away.
let a = await connect(alice);
a.send({ t: "hello", room: "hub" });
let welcome = await waitFor(a, "welcome");
const [sx, , sz] = academy.spawn;
check(!!welcome && Math.hypot(welcome.spawn[0] - sx, welcome.spawn[2] - sz) <= academy.spawnSpread + 0.01 && welcome.yaw === undefined, "plain hello lands at the hub spawn");
const firstCounts = await waitFor(a, "roomCounts");
check(firstCounts?.counts.hub === 1 && firstCounts.counts.tag === 0, `counts on joining: ${JSON.stringify(firstCounts?.counts)}`);

// 2. Someone joins tag: the hub's signs update within a few seconds.
const b = await connect(bob);
b.send({ t: "hello", room: "tag" });
await waitFor(b, "welcome");
a.messages.length = 0;
const updated = await waitFor(a, "roomCounts", 5000);
check(updated?.counts.tag === 1, `counts after a player enters tag: ${JSON.stringify(updated?.counts)}`);
b.socket.close();
await b.closed;

// 3. Coming back from tag: in front of the tag portal, facing away from it.
a.socket.close();
await a.closed;
a = await connect(alice);
a.send({ t: "hello", room: "hub", from: "tag" });
welcome = await waitFor(a, "welcome");
const tagPortal = academy.portals!.find((p) => p.room === "tag")!;
const out = welcome ? -Math.sin(tagPortal.yaw) * (welcome.spawn[0] - tagPortal.pos[0]) - Math.cos(tagPortal.yaw) * (welcome.spawn[2] - tagPortal.pos[2]) : NaN;
check(!!welcome && Math.abs(out - 3.5) < 0.01 && welcome.yaw === tagPortal.yaw, `back from tag: ${out.toFixed(2)} m in front of its portal, facing the plaza`);
a.socket.close();
await a.closed;

// 4. A room with no portal: the normal spawn.
a = await connect(alice);
a.send({ t: "hello", room: "hub", from: "nowhere" });
welcome = await waitFor(a, "welcome");
check(!!welcome && welcome.yaw === undefined, "unknown 'from' falls back to the normal spawn");
a.socket.close();
await a.closed;

// 5. Malformed 'from' (not a room-id string): rejected like any bad message.
a = await connect(alice);
a.send({ t: "hello", room: "hub", from: { evil: true } });
const kicked = await Promise.race([a.closed.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 3000))]);
check(kicked && !a.messages.some((m) => m.t === "welcome"), "malformed 'from' gets the connection closed");

console.log(failures ? `${failures} FAILED` : "ALL PASSED");
process.exit(failures ? 1 : 0);

// A test bot that joins and walks in circles, so you can check that other
// players show up and move smoothly without needing a second person.
// It logs in with the PIN like a browser would.
//
//   GAME_PIN=... node server/scripts/bot.ts http://game:8080 [count] [room]

import WebSocket from "ws";
import { NET_INTERVAL_MS, WALK_SPEED } from "../../shared/src/constants.ts";
import type { ClientMsg, ServerMsg, Vec3 } from "../../shared/src/protocol.ts";

const base = (process.argv[2] ?? "http://localhost:8080").replace(/\/$/, "");
const count = Number(process.argv[3] ?? 1);
const room = process.argv[4] ?? "playground";
const pin = process.env.GAME_PIN;
if (!pin) {
  console.error("Set GAME_PIN in the environment.");
  process.exit(1);
}

async function login(): Promise<string> {
  const res = await fetch(`${base}/auth/pin`, {
    method: "POST",
    body: new URLSearchParams({ pin: pin! }),
    redirect: "manual",
  });
  const cookie = res.headers.get("set-cookie");
  if (res.status !== 303 || !cookie) throw new Error(`login failed: HTTP ${res.status}`);
  return cookie.split(";")[0];
}

function runBot(index: number, cookie: string): void {
  const socket = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
  const send = (msg: ClientMsg) => socket.send(JSON.stringify(msg));
  const radius = 3 + index;
  let angle = 0;
  let center: [number, number] = [0, 0];
  let y = 0.9;
  let tp = 0;
  let timer: NodeJS.Timeout | undefined;

  // Put the circle's center where the given point lies on the circle, so the
  // bot starts walking from exactly where the server put it.
  const startAt = (p: Vec3) => {
    center = [p[0] - Math.cos(angle) * radius, p[2] - Math.sin(angle) * radius];
    y = 0.9; // standing on the ground
  };

  socket.on("open", () => send({ t: "hello", name: `Bot ${index + 1}`, room }));

  socket.on("message", (data) => {
    const msg = JSON.parse(data.toString()) as ServerMsg;
    if (msg.t === "welcome") {
      console.log(`bot ${index + 1} joined as #${msg.id} with ${msg.players.length} others`);
      startAt(msg.spawn);
      timer = setInterval(() => {
        // Walk around the circle at walking speed, facing the direction of travel.
        angle += (WALK_SPEED / radius) * (NET_INTERVAL_MS / 1000);
        const x = center[0] + Math.cos(angle) * radius;
        const z = center[1] + Math.sin(angle) * radius;
        // Moving along the tangent (-sin, cos); an avatar at yaw ry faces
        // (-sin ry, -cos ry), which matches when ry = PI - angle (wrapped).
        const facing = Math.atan2(Math.sin(Math.PI - angle), Math.cos(Math.PI - angle));
        send({ t: "move", p: [x, y, z], ry: facing, tp });
      }, NET_INTERVAL_MS);
    } else if (msg.t === "teleport") {
      tp = msg.tp;
      startAt(msg.p);
    } else if (msg.t === "error") {
      console.log(`bot ${index + 1} error: ${msg.message}`);
    }
  });

  socket.on("unexpected-response", (_req, res) => console.log(`bot ${index + 1} refused: HTTP ${res.statusCode}`));
  socket.on("close", () => {
    clearInterval(timer);
    console.log(`bot ${index + 1} disconnected`);
  });
}

const cookie = await login();
for (let i = 0; i < count; i++) runBot(i, cookie);

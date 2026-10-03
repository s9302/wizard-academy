// A test bot that joins and walks in circles, so you can check that other
// players show up and move smoothly without needing a second person.
//
//   node server/scripts/bot.ts ws://game:8080/ws [count]

import WebSocket from "ws";
import { NET_INTERVAL_MS, WALK_SPEED } from "../../shared/src/constants.ts";
import type { ClientMsg, ServerMsg } from "../../shared/src/protocol.ts";

const url = process.argv[2] ?? "ws://localhost:3000/ws";
const count = Number(process.argv[3] ?? 1);

function runBot(index: number): void {
  const socket = new WebSocket(url);
  const send = (msg: ClientMsg) => socket.send(JSON.stringify(msg));
  const radius = 4 + index * 2;
  let angle = (index * Math.PI) / 2;
  let timer: NodeJS.Timeout | undefined;

  socket.on("open", () => send({ t: "hello", name: `Bot ${index + 1}` }));

  socket.on("message", (data) => {
    const msg = JSON.parse(data.toString()) as ServerMsg;
    if (msg.t === "welcome") {
      console.log(`bot ${index + 1} joined as #${msg.id} with ${msg.players.length} others`);
      timer = setInterval(() => {
        // Walk around a circle at walking speed, facing the direction of travel.
        angle += (WALK_SPEED / radius) * (NET_INTERVAL_MS / 1000);
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        // Moving along the circle's tangent (-sin, cos); an avatar at yaw ry faces
        // (-sin ry, -cos ry), which matches when ry = PI - angle.
        const facing = Math.PI - angle;
        send({ t: "move", p: [x, 0.9, z], ry: facing });
      }, NET_INTERVAL_MS);
    } else if (msg.t === "error") {
      console.log(`bot ${index + 1} error: ${msg.message}`);
    }
  });

  socket.on("close", () => {
    clearInterval(timer);
    console.log(`bot ${index + 1} disconnected`);
  });
}

for (let i = 0; i < count; i++) runBot(i);

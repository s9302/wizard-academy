// Entry point: an HTTP server (health check only) with the WebSocket server
// attached at /ws. Caddy sits in front and serves the client files.

import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { MAX_MESSAGE_BYTES } from "../../shared/src/constants.ts";
import { Connection } from "./Connection.ts";
import { RoomManager } from "./RoomManager.ts";
import { parseClientMsg } from "./validate.ts";

const PORT = Number(process.env.PORT ?? 3000);
const HELLO_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 15_000;

const rooms = new RoomManager();
const connections = new Set<Connection>();

const http = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok\n");
    return;
  }
  res.writeHead(404).end();
});

// maxPayload makes ws drop any single message larger than this before parsing.
const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: MAX_MESSAGE_BYTES });

wss.on("connection", (socket, req) => {
  const ip = req.socket.remoteAddress ?? "unknown";
  const conn = new Connection(socket, ip);
  connections.add(conn);

  // The first message must be "hello" within a few seconds, or we hang up.
  const helloTimer = setTimeout(() => conn.kick("No hello received."), HELLO_TIMEOUT_MS);

  socket.on("pong", () => (conn.alive = true));

  socket.on("message", (data, isBinary) => {
    if (isBinary) return conn.kick("Binary messages are not accepted.");
    const msg = parseClientMsg(data.toString());
    if (!msg) return conn.kick("Malformed message.");

    if (!conn.room) {
      if (msg.t !== "hello") return conn.kick("Expected hello.");
      if (conn.name) return; // already joined once, ignore repeats
      clearTimeout(helloTimer);
      conn.name = msg.name;
      rooms.joinDefault(conn);
      return;
    }
    conn.room.handleMessage(conn, msg);
  });

  socket.on("close", () => {
    clearTimeout(helloTimer);
    connections.delete(conn);
    rooms.disconnect(conn);
  });

  socket.on("error", (err) => console.warn(`socket error #${conn.id}:`, err.message));
});

// Heartbeat: ping every client; any that didn't answer the previous ping is gone
// (closed laptop, lost wifi) and gets terminated so its avatar disappears.
setInterval(() => {
  for (const conn of connections) {
    if (!conn.alive) {
      conn.socket.terminate();
      continue;
    }
    conn.alive = false;
    conn.socket.ping();
  }
}, HEARTBEAT_MS);

http.listen(PORT, () => console.log(`game server listening on :${PORT}`));

function shutdown(): void {
  console.log("shutting down");
  for (const socket of wss.clients) socket.close(1001, "Server restarting");
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

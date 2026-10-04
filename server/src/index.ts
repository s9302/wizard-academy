// Entry point: an HTTP server for the PIN gate, with the WebSocket server
// attached at /ws. Caddy sits in front, serves the client files, and asks
// /auth/check before serving anything.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { MAX_MESSAGE_BYTES } from "../../shared/src/constants.ts";
import { accountFromRequest } from "./accounts.ts";
import { handleApi } from "./api.ts";
import { clientIp, hasValidSession, originAllowed, PIN_CSS, pinMatches, pinPage, sessionCookie } from "./auth.ts";
import { config } from "./config.ts";
import { migrate, waitForDb } from "./db.ts";
import { Connection } from "./Connection.ts";
import { rateLimitKey, SlidingWindowLimiter } from "./limits.ts";
import { RoomManager } from "./RoomManager.ts";
import { parseClientMsg } from "./validate.ts";

const HELLO_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 15_000;
const MAX_CONNECTIONS = 64;
// Friends playing from the same house share one public IP, so this is
// generous: a whole room's worth.
const MAX_CONNECTIONS_PER_IP = 16;
const MAX_FORM_BYTES = 1024;

// Failed PIN attempts: 5 per IP (or IPv6 /64) per 15 minutes. The global cap
// stops someone with many addresses from guessing in parallel; if it trips,
// new logins pause for a while but anyone already in keeps playing.
const PIN_WINDOW_MS = 15 * 60 * 1000;
const pinFailures = new SlidingWindowLimiter(5, PIN_WINDOW_MS);
const pinFailuresGlobal = new SlidingWindowLimiter(100, PIN_WINDOW_MS);
setInterval(() => pinFailures.sweep(), 60_000).unref();

// The database must be up and current before rooms (leaderboards) start.
await waitForDb();
await migrate();
const rooms = new RoomManager();
const connections = new Set<Connection>();
// One live connection per account: joining from a second tab or device
// disconnects the first (otherwise extra tabs would multiply XP).
const byAccount = new Map<number, Connection>();
const connectionsPerIp = new Map<string, number>();

// ---- HTTP ----

function sendHtml(res: ServerResponse, status: number, html: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, no-transform", ...headers });
  res.end(html);
}

function readForm(req: IncomingMessage): Promise<URLSearchParams | null> {
  return new Promise((resolve) => {
    let body = "";
    let tooBig = false;
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      if (tooBig) return; // keep draining, but stop storing
      body += chunk;
      if (body.length > MAX_FORM_BYTES) {
        tooBig = true;
        body = "";
      }
    });
    req.on("end", () => resolve(tooBig ? null : new URLSearchParams(body)));
    req.on("error", () => resolve(null));
  });
}

async function handlePinPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!originAllowed(req)) return sendHtml(res, 403, pinPage("Request blocked."));
  const form = await readForm(req);
  if (!form) return sendHtml(res, 413, pinPage("Request too large."), { connection: "close" });

  // From here to recording the result there is no await, so many parallel
  // requests can't all slip past the limit before any failure is counted.
  const ip = clientIp(req);
  const key = rateLimitKey(ip);
  const wait = Math.max(pinFailures.retryAfterMs(key), pinFailuresGlobal.retryAfterMs("all"));
  if (wait > 0) {
    const minutes = Math.ceil(wait / 60_000);
    return sendHtml(res, 429, pinPage(`Too many wrong PINs. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`), {
      "retry-after": String(Math.ceil(wait / 1000)),
    });
  }

  const guess = form.get("pin") ?? "";
  if (guess && guess.length <= 64 && pinMatches(guess)) {
    console.log(`PIN accepted from ${ip}`);
    res.writeHead(303, { location: "/", "set-cookie": sessionCookie(), "cache-control": "no-store" });
    res.end();
    return;
  }

  pinFailures.record(key);
  pinFailuresGlobal.record("all");
  console.warn(`wrong PIN from ${ip}`);
  sendHtml(res, 401, pinPage("Wrong PIN."));
}

const http = createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];

  if (path === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok\n");
  } else if (path === "/auth/check") {
    // Caddy calls this before serving any game file. 2xx = let it through;
    // anything else is sent to the browser as-is, so unauthenticated visitors
    // get the PIN page no matter which URL they asked for.
    if (hasValidSession(req)) res.writeHead(204).end();
    else sendHtml(res, 401, pinPage());
  } else if (path === "/auth/pin.css") {
    res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=3600" });
    res.end(PIN_CSS);
  } else if (path === "/auth/pin" && req.method === "POST") {
    handlePinPost(req, res).catch((err) => {
      console.error("PIN handler error:", err);
      if (!res.headersSent) res.writeHead(500).end();
    });
  } else if (path.startsWith("/api/")) {
    handleApi(req, res, path).catch((err) => {
      console.error("API error:", err);
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" }).end('{"error":"Server error."}');
    });
  } else if (path === "/auth/pin") {
    res.writeHead(303, { location: "/" }).end();
  } else {
    res.writeHead(404).end();
  }
});

// ---- WebSocket ----

// maxPayload makes ws drop any single message larger than this before parsing.
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

function refuse(socket: Duplex, status: string): void {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

// The upgrade is checked here too, not only by Caddy: the session cookie and
// Origin are verified before a WebSocket exists at all.
http.on("upgrade", (req, socket, head) => {
  const path = (req.url ?? "").split("?")[0];
  if (path !== "/ws") return refuse(socket, "404 Not Found");
  if (!originAllowed(req)) return refuse(socket, "403 Forbidden");
  if (!hasValidSession(req)) return refuse(socket, "401 Unauthorized");

  const key = rateLimitKey(clientIp(req));
  if (connections.size >= MAX_CONNECTIONS) return refuse(socket, "503 Service Unavailable");
  if ((connectionsPerIp.get(key) ?? 0) >= MAX_CONNECTIONS_PER_IP) return refuse(socket, "429 Too Many Requests");

  // Playing needs an account too (Phase 5). Looking it up is async, so check
  // the connection limits again once it's back.
  accountFromRequest(req)
    .then((account) => {
      if (!account) return refuse(socket, "401 Unauthorized");
      if (connections.size >= MAX_CONNECTIONS) return refuse(socket, "503 Service Unavailable");
      if ((connectionsPerIp.get(key) ?? 0) >= MAX_CONNECTIONS_PER_IP) return refuse(socket, "429 Too Many Requests");
      wss.handleUpgrade(req, socket, head, (ws) => onConnection(new Connection(ws, key, account)));
    })
    .catch((err) => {
      console.error("account lookup failed:", err);
      refuse(socket, "500 Internal Server Error");
    });
});

function onConnection(conn: Connection): void {
  const socket = conn.socket;
  connections.add(conn);
  byAccount.get(conn.account.id)?.kick("You joined from another tab or device.");
  byAccount.set(conn.account.id, conn);
  connectionsPerIp.set(conn.ip, (connectionsPerIp.get(conn.ip) ?? 0) + 1);

  // The first message must be "hello" within a few seconds, or we hang up.
  const helloTimer = setTimeout(() => conn.kick("No hello received."), HELLO_TIMEOUT_MS);
  let saidHello = false;

  socket.on("pong", () => (conn.alive = true));

  socket.on("message", (data, isBinary) => {
    if (!conn.floodBudget.take()) return conn.kick("Too many messages.");
    if (!conn.messageBudget.take()) {
      // Over the normal rate: drop it, don't disconnect (see Connection.ts).
      if (conn.droppedMessages++ % 100 === 0) console.warn(`dropping messages from #${conn.id} ${conn.name} (over the rate limit)`);
      return;
    }
    if (isBinary) return conn.kick("Binary messages are not accepted.");
    const msg = parseClientMsg(data.toString());
    if (!msg) return conn.kick("Malformed message.");

    if (!conn.room) {
      if (msg.t !== "hello") return conn.kick("Expected hello.");
      if (saidHello) return; // already joined once (e.g. room was full), ignore repeats
      saidHello = true;
      clearTimeout(helloTimer);
      rooms.join(conn, msg.room, msg.from);
      return;
    }
    conn.room.handleMessage(conn, msg);
  });

  socket.on("close", () => {
    clearTimeout(helloTimer);
    connections.delete(conn);
    if (byAccount.get(conn.account.id) === conn) byAccount.delete(conn.account.id);
    const count = (connectionsPerIp.get(conn.ip) ?? 1) - 1;
    if (count > 0) connectionsPerIp.set(conn.ip, count);
    else connectionsPerIp.delete(conn.ip);
    rooms.disconnect(conn);
  });

  socket.on("error", (err) => console.warn(`socket error #${conn.id}:`, err.message));
}

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

http.listen(config.port, () => {
  console.log(`game server listening on :${config.port} (secure cookies: ${config.cookieSecure})`);
});

function shutdown(): void {
  console.log("shutting down");
  for (const conn of connections) conn.socket.close(1001, "Server restarting");
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

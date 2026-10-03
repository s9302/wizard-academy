// HTTP API for accounts: /api/register, /api/login, /api/logout, /api/me.
// Caddy only forwards these after the PIN check, so strangers never reach
// them. Requests must be JSON from this site (Content-Type + Origin), which
// also stops other websites from submitting forms here (CSRF).

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  accountCookie,
  accountFromRequest,
  clearAccountCookie,
  getProfile,
  login,
  register,
} from "./accounts.ts";
import { clientIp, originAllowed } from "./auth.ts";
import { rateLimitKey, SlidingWindowLimiter } from "./limits.ts";

const MAX_BODY_BYTES = 2048;
const MINUTE = 60_000;

// Failed logins: per IP, and per username (so one account can't be guessed
// at from many addresses). New accounts: per IP, generous enough for a group
// of friends signing up from one house (they share a public IP).
const loginFailuresByIp = new SlidingWindowLimiter(10, 15 * MINUTE);
const loginFailuresByName = new SlidingWindowLimiter(10, 15 * MINUTE);
const registrationsByIp = new SlidingWindowLimiter(20, 60 * MINUTE);
setInterval(() => {
  loginFailuresByIp.sweep();
  loginFailuresByName.sweep();
  registrationsByIp.sweep();
}, MINUTE).unref();

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let body = "";
    let tooBig = false;
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      if (tooBig) return;
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        tooBig = true;
        body = "";
      }
    });
    req.on("end", () => {
      if (tooBig) return resolve(null);
      try {
        const data: unknown = JSON.parse(body);
        resolve(typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : null);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

function credentials(body: Record<string, unknown>): { username: string; password: string } | null {
  const { username, password } = body;
  if (typeof username !== "string" || typeof password !== "string") return null;
  return { username: username.trim(), password };
}

const retryMessage = (ms: number) => {
  const minutes = Math.ceil(ms / MINUTE);
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
};

// Returns true if it handled the request.
export async function handleApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  if (!path.startsWith("/api/")) return false;

  if (path === "/api/me" && req.method === "GET") {
    const account = await accountFromRequest(req);
    const profile = account && (await getProfile(account.id));
    if (!profile) json(res, 401, { error: "Not logged in." });
    else json(res, 200, profile);
    return true;
  }

  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed." });
    return true;
  }
  if (!originAllowed(req) || !(req.headers["content-type"] ?? "").startsWith("application/json")) {
    json(res, 403, { error: "Request blocked." });
    return true;
  }

  if (path === "/api/logout") {
    json(res, 200, { ok: true }, { "set-cookie": clearAccountCookie() });
    return true;
  }

  const body = await readJson(req);
  const creds = body && credentials(body);
  if (!creds) {
    json(res, 400, { error: "Bad request." });
    return true;
  }
  const ipKey = rateLimitKey(clientIp(req));

  if (path === "/api/register") {
    const wait = registrationsByIp.retryAfterMs(ipKey);
    if (wait > 0) {
      json(res, 429, { error: retryMessage(wait) });
      return true;
    }
    registrationsByIp.record(ipKey); // count attempts, not just successes
    const result = await register(creds.username, creds.password);
    if (!result.ok) {
      json(res, 400, { error: result.error });
      return true;
    }
    console.log(`account created: ${result.account.username} (#${result.account.id}) from ${clientIp(req)}`);
    json(res, 201, await getProfile(result.account.id), { "set-cookie": accountCookie(result.account.id, result.sessionVersion) });
    return true;
  }

  if (path === "/api/login") {
    const nameKey = creds.username.toLowerCase();
    const wait = Math.max(loginFailuresByIp.retryAfterMs(ipKey), loginFailuresByName.retryAfterMs(nameKey));
    if (wait > 0) {
      json(res, 429, { error: retryMessage(wait) });
      return true;
    }
    const result = await login(creds.username, creds.password);
    if (!result.ok) {
      loginFailuresByIp.record(ipKey);
      loginFailuresByName.record(nameKey);
      console.warn(`failed login for "${creds.username.slice(0, 32)}" from ${clientIp(req)}`);
      {
      json(res, 401, { error: result.error });
      return true;
    }
    }
    json(res, 200, await getProfile(result.account.id), { "set-cookie": accountCookie(result.account.id, result.sessionVersion) });
    return true;
  }

  json(res, 404, { error: "Not found." });
  return true;
}

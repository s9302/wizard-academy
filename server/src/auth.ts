// The shared-PIN gate: checking the PIN, issuing and verifying the session
// cookie, and the minimal PIN page.
//
// The cookie is "<expiry>.<signature>", where the signature is an HMAC of the
// expiry made with a key derived from SESSION_SECRET *and* the PIN. Nobody can
// forge or extend one without the secret, and changing either the PIN or the
// secret instantly invalidates every existing cookie.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { config } from "./config.ts";

export const COOKIE_NAME = "wa_session";
const SESSION_DAYS = 30;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

const sha256 = (text: string) => createHash("sha256").update(text).digest();

const signingKey = createHmac("sha256", config.sessionSecret)
  .update("wizard-academy session v1:")
  .update(sha256(config.pin))
  .digest();

function sign(payload: string): string {
  return createHmac("sha256", signingKey).update(payload).digest("base64url");
}

// Constant-time comparison: hashing both sides first gives equal-length
// buffers, and timingSafeEqual takes the same time no matter where they differ,
// so response timing leaks nothing about how close a guess was.
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

export function pinMatches(guess: string): boolean {
  return safeEqual(guess, config.pin);
}

export function sessionCookie(): string {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const value = `${expires}.${sign(String(expires))}`;
  const attrs = [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    `Max-Age=${SESSION_SECONDS}`,
    "HttpOnly", // page JavaScript can't read it
    "SameSite=Lax", // not sent on cross-site requests (incl. WebSockets)
  ];
  if (config.cookieSecure) attrs.push("Secure"); // HTTPS only
  return attrs.join("; ");
}

function readCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function hasValidSession(req: IncomingMessage): boolean {
  const value = readCookie(req, COOKIE_NAME);
  if (!value || value.length > 200) return false;
  const dot = value.indexOf(".");
  if (dot < 0) return false;
  const expires = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (!/^\d{1,12}$/.test(expires)) return false;
  if (Number(expires) < Date.now() / 1000) return false;
  return safeEqual(signature, sign(expires));
}

// Caddy sets X-Client-IP on every proxied request, overwriting anything the
// client sent: the tailnet peer address on the LAN listener, CF-Connecting-IP
// on the tunnel listener. The server port isn't published, so only Caddy can
// set this header.
export function clientIp(req: IncomingMessage): string {
  const header = req.headers["x-client-ip"];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim() || "unknown";
}

// Browsers always send Origin on WebSocket and form POST requests. If it's
// present it must match the site, which stops other websites from using a
// visitor's cookie against us (cross-site WebSocket hijacking).
export function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser client; it still needs a valid cookie
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// ---- The PIN page ----

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function pinPage(message = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Wizard Academy</title>
<link rel="stylesheet" href="/auth/pin.css">
<link rel="icon" type="image/svg+xml" href="/auth/favicon.svg">
</head>
<body>
<form method="post" action="/auth/pin">
<h1>Wizard Academy</h1>
<label for="pin">Access PIN</label>
<input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="64" required autofocus>
<button type="submit">Enter</button>
${message ? `<p class="message">${escapeHtml(message)}</p>` : ""}
</form>
</body>
</html>
`;
}

export const PIN_CSS = `
:root { color-scheme: dark; font-family: system-ui, sans-serif; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #1c1630; color: #f4efe6; }
form { display: grid; gap: 10px; width: min(300px, calc(100vw - 32px)); padding: 24px; border-radius: 12px; background: #2a2148; }
h1 { margin: 0 0 6px; color: #b48cff; text-align: center; }
input, button { font: inherit; padding: 9px 10px; border-radius: 6px; border: 1px solid #5a4b86; }
input { background: #120d22; color: inherit; }
button { background: #b48cff; color: #1c1630; font-weight: 600; cursor: pointer; }
.message { margin: 4px 0 0; color: #ffb4a8; text-align: center; }
`;

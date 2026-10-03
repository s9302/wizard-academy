// Checks accounts: registration rules, login, generic errors, cookie
// tampering, CSRF protections, that the game needs an account, logout, the
// login rate limit, and (if DATABASE_URL is set) that only argon2id hashes
// are stored. Uses a fresh random username each run.
//
//   GAME_PIN=... [DATABASE_URL=...] node server/scripts/accounts-check.ts http://localhost:3000
//
// Run it last against a test server: the rate-limit check locks your IP out
// of logging in for 15 minutes.

import pg from "pg";
import WebSocket from "ws";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const pin = process.env.GAME_PIN;
if (!pin) {
  console.error("Set GAME_PIN in the environment.");
  process.exit(1);
}

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const gate = await fetch(`${base}/auth/pin`, { method: "POST", body: new URLSearchParams({ pin }), redirect: "manual" });
const pinCookie = gate.headers.get("set-cookie")!.split(";")[0];

async function api(path: string, body?: object, extra: Record<string, string> = {}, cookie = pinCookie) {
  const res = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}), ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data, setCookie: res.headers.get("set-cookie") ?? "" };
}

const user = `acct_${Math.random().toString(36).slice(2, 8)}`;
const password = "a fine long password";

check("bad username rejected", (await api("/api/register", { username: "a b<c>", password })).status === 400);
check("short password rejected", (await api("/api/register", { username: user, password: "short" })).status === 400);

const reg = await api("/api/register", { username: user, password });
const accountCookie = reg.setCookie.split(";")[0];
check("registration works and signs you in", reg.status === 201 && accountCookie.startsWith("wa_account="), `HTTP ${reg.status}`);
check("new profile starts at level 1 with 0 XP", (reg.data.level as { level: number })?.level === 1 && reg.data.xp === 0);
check("account cookie is HttpOnly + SameSite", /HttpOnly/.test(reg.setCookie) && /SameSite=Lax/.test(reg.setCookie));
const dup = await api("/api/register", { username: user.toUpperCase(), password });
check("usernames are unique, ignoring case", dup.status === 400 && /taken/.test(String(dup.data.error)));

const both = `${pinCookie}; ${accountCookie}`;
check("/api/me works when logged in", (await api("/api/me", undefined, {}, both)).data.username === user);
check("/api/me refuses without an account", (await api("/api/me")).status === 401);

const tampered = accountCookie.replace(/^wa_account=(\d+)\./, (_m, id) => `wa_account=${Number(id) + 1}.`);
check("a tampered account cookie is rejected", (await api("/api/me", undefined, {}, `${pinCookie}; ${tampered}`)).status === 401);

const t1 = performance.now();
const wrongPw = await api("/api/login", { username: user, password: "wrong password!" });
const t2 = performance.now();
const noUser = await api("/api/login", { username: "no_such_wizard", password: "wrong password!" });
const t3 = performance.now();
check("wrong password and unknown user get the same answer", wrongPw.status === 401 && noUser.status === 401 && wrongPw.data.error === noUser.data.error, String(wrongPw.data.error));
check("...and take similar time (no username probing by timing)", Math.abs((t2 - t1) - (t3 - t2)) < 60, `${(t2 - t1).toFixed(0)} ms vs ${(t3 - t2).toFixed(0)} ms`);
const good = await api("/api/login", { username: user.toUpperCase(), password });
check("login works (username case doesn't matter)", good.status === 200 && good.data.username === user);

const form = await fetch(`${base}/api/login`, { method: "POST", headers: { cookie: pinCookie, "content-type": "application/x-www-form-urlencoded" }, body: `username=${user}&password=x` });
check("non-JSON posts are refused (CSRF)", form.status === 403);
check("cross-site posts are refused (CSRF)", (await api("/api/login", { username: user, password }, { origin: "https://evil.example" })).status === 403);

async function wsStatus(cookie: string): Promise<string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
    ws.on("open", () => {
      ws.close();
      resolve("open");
    });
    ws.on("unexpected-response", (_req, res) => resolve(String(res.statusCode)));
    ws.on("error", () => {});
  });
}
check("the game refuses a PIN without an account", (await wsStatus(pinCookie)) === "401");
check("the game accepts PIN + account", (await wsStatus(both)) === "open");

// A second connection on the same account replaces the first.
const first = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie: both } });
const firstClosed = new Promise<string>((r) => first.on("close", (_code, why) => r(why.toString())));
await new Promise((r) => first.on("open", r));
const second = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { cookie: both } });
await new Promise((r) => second.on("open", r));
const reason = await Promise.race([firstClosed, new Promise<string>((r) => setTimeout(() => r("still open"), 2000))]);
check("one connection per account (a new tab replaces the old)", /another tab/.test(reason), reason);
second.close();

const out = await api("/api/logout", {}, {}, both);
check("logout clears the account cookie", out.status === 200 && /wa_account=;/.test(out.setCookie) && /Max-Age=0/.test(out.setCookie));

if (process.env.DATABASE_URL) {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const { rows } = await db.query("SELECT password_hash FROM accounts WHERE username = $1", [user]);
  await db.end();
  const hash: string = rows[0]?.password_hash ?? "";
  check("only an argon2id hash is stored", hash.startsWith("$argon2id$") && !hash.includes(password), hash.slice(0, 30) + "...");
}

let limited = false;
for (let i = 0; i < 12 && !limited; i++) {
  limited = (await api("/api/login", { username: user, password: `guess ${i}` })).status === 429;
}
check("login is rate-limited after repeated failures", limited);

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);

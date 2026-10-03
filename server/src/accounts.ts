// Player accounts: registration, login, the account session cookie, profiles,
// XP and best times. Everything here sits behind the PIN gate.
//
// Passwords are hashed with argon2id (memory-hard, so guessing is expensive
// even with GPUs) using OWASP's recommended minimum settings. The hash string
// includes its own random salt and parameters.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import argon2 from "argon2";
import { levelInfo, type LevelInfo } from "../../shared/src/progression.ts";
import { config } from "./config.ts";
import { pool, transaction } from "./db.ts";

export const ACCOUNT_COOKIE = "wa_account";
const SESSION_DAYS = 30;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

export const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,16}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const HASH_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
// Checked against when a username doesn't exist, so a wrong username takes as
// long as a wrong password and response times don't reveal which accounts exist.
const DUMMY_HASH = await argon2.hash("not a real password", HASH_OPTIONS);

export type Account = { id: number; username: string };

// ---- Registration and login ----

export type AuthResult = { ok: true; account: Account; sessionVersion: number } | { ok: false; error: string };

export async function register(username: string, password: string): Promise<AuthResult> {
  if (!USERNAME_PATTERN.test(username)) {
    return { ok: false, error: "Usernames are 3-16 letters, numbers, _ or -." };
  }
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return { ok: false, error: `Passwords are ${PASSWORD_MIN}-${PASSWORD_MAX} characters.` };
  }
  const hash = await argon2.hash(password, HASH_OPTIONS);
  try {
    const { rows } = await pool.query<{ id: number; session_version: number }>(
      `INSERT INTO accounts (username, username_lower, password_hash, last_login_at)
       VALUES ($1, $2, $3, now()) RETURNING id, session_version`,
      [username, username.toLowerCase(), hash],
    );
    return { ok: true, account: { id: rows[0].id, username }, sessionVersion: rows[0].session_version };
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return { ok: false, error: "That username is taken." };
    throw err;
  }
}

export async function login(username: string, password: string): Promise<AuthResult> {
  const fail: AuthResult = { ok: false, error: "Wrong username or password." };
  if (username.length > 32 || password.length > PASSWORD_MAX) return fail;
  const { rows } = await pool.query<{ id: number; username: string; password_hash: string; session_version: number }>(
    "SELECT id, username, password_hash, session_version FROM accounts WHERE username_lower = $1",
    [username.toLowerCase()],
  );
  const row = rows[0];
  const valid = await argon2.verify(row?.password_hash ?? DUMMY_HASH, password);
  if (!row || !valid) return fail;
  await pool.query("UPDATE accounts SET last_login_at = now() WHERE id = $1", [row.id]);
  return { ok: true, account: { id: row.id, username: row.username }, sessionVersion: row.session_version };
}

// ---- The account cookie ----
// Value: "<accountId>.<sessionVersion>.<expiry>.<signature>". Signed with a key
// derived from SESSION_SECRET (different from the PIN cookie's key).

const cookieKey = createHmac("sha256", config.sessionSecret).update("wizard-academy account v1").digest();
const sign = (payload: string) => createHmac("sha256", cookieKey).update(payload).digest("base64url");

export function accountCookie(accountId: number, sessionVersion: number): string {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = `${accountId}.${sessionVersion}.${expires}`;
  const attrs = [`${ACCOUNT_COOKIE}=${payload}.${sign(payload)}`, "Path=/", `Max-Age=${SESSION_SECONDS}`, "HttpOnly", "SameSite=Lax"];
  if (config.cookieSecure) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearAccountCookie(): string {
  const attrs = [`${ACCOUNT_COOKIE}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Lax"];
  if (config.cookieSecure) attrs.push("Secure");
  return attrs.join("; ");
}

function readCookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

// The signed-in account, or null. Checks the signature and expiry, then the
// database: the account must exist and the session version must still match.
export async function accountFromRequest(req: IncomingMessage): Promise<Account | null> {
  const value = readCookie(req, ACCOUNT_COOKIE);
  if (!value || value.length > 200) return null;
  const m = /^(\d{1,9})\.(\d{1,9})\.(\d{1,12})\.([A-Za-z0-9_-]+)$/.exec(value);
  if (!m) return null;
  const [, id, version, expires, signature] = m;
  const expected = sign(`${id}.${version}.${expires}`);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  if (Number(expires) < Date.now() / 1000) return null;
  const { rows } = await pool.query<{ username: string; session_version: number }>(
    "SELECT username, session_version FROM accounts WHERE id = $1",
    [Number(id)],
  );
  if (!rows[0] || rows[0].session_version !== Number(version)) return null;
  return { id: Number(id), username: rows[0].username };
}

// ---- Profile, XP, best times ----

export type Profile = {
  username: string;
  xp: number;
  level: LevelInfo;
  bestTimes: Record<string, number>; // course id -> ms
};

export async function getProfile(accountId: number): Promise<Profile | null> {
  const acc = await pool.query<{ username: string; xp: number }>("SELECT username, xp FROM accounts WHERE id = $1", [accountId]);
  if (!acc.rows[0]) return null;
  const times = await pool.query<{ course_id: string; time_ms: number }>(
    "SELECT course_id, time_ms FROM best_times WHERE account_id = $1",
    [accountId],
  );
  const { username, xp } = acc.rows[0];
  return { username, xp, level: levelInfo(xp), bestTimes: Object.fromEntries(times.rows.map((r) => [r.course_id, r.time_ms])) };
}

// Adds XP and logs why. Returns the new total.
export async function awardXp(accountId: number, amount: number, reason: string): Promise<number> {
  return transaction(async (client) => {
    const { rows } = await client.query<{ xp: number }>("UPDATE accounts SET xp = xp + $2 WHERE id = $1 RETURNING xp", [
      accountId,
      amount,
    ]);
    await client.query("INSERT INTO xp_events (account_id, amount, reason) VALUES ($1, $2, $3)", [accountId, amount, reason]);
    return rows[0].xp;
  });
}

export type FinishRecord = {
  best: number; // best time after this run
  newBest: boolean;
  firstClear: boolean;
};

// Records a course finish: keeps the best time, counts completions.
export async function recordFinish(accountId: number, courseId: string, timeMs: number): Promise<FinishRecord> {
  return transaction(async (client) => {
    const { rows } = await client.query<{ time_ms: number }>(
      "SELECT time_ms FROM best_times WHERE account_id = $1 AND course_id = $2 FOR UPDATE",
      [accountId, courseId],
    );
    const previous = rows[0]?.time_ms;
    if (previous === undefined) {
      await client.query("INSERT INTO best_times (account_id, course_id, time_ms) VALUES ($1, $2, $3)", [accountId, courseId, timeMs]);
      return { best: timeMs, newBest: true, firstClear: true };
    }
    const newBest = timeMs < previous;
    await client.query(
      `UPDATE best_times SET completions = completions + 1,
         time_ms = LEAST(time_ms, $3),
         achieved_at = CASE WHEN $3 < time_ms THEN now() ELSE achieved_at END
       WHERE account_id = $1 AND course_id = $2`,
      [accountId, courseId, timeMs],
    );
    return { best: newBest ? timeMs : previous, newBest, firstClear: false };
  });
}

export async function leaderboard(courseId: string, limit = 10): Promise<{ name: string; time: number }[]> {
  const { rows } = await pool.query<{ username: string; time_ms: number }>(
    `SELECT a.username, b.time_ms FROM best_times b JOIN accounts a ON a.id = b.account_id
     WHERE b.course_id = $1 ORDER BY b.time_ms, b.achieved_at LIMIT $2`,
    [courseId, limit],
  );
  return rows.map((r) => ({ name: r.username, time: r.time_ms }));
}

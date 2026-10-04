// Makes an account an admin, creating it first if it doesn't exist (with a
// random password). Runs inside the server container:
//
//   umask 077; docker compose exec -T server node server/src/tools/make-admin.ts Admin > ~/admin-credentials.txt
//
// Only a new account's username and password go to stdout (so they can be
// sent straight to a private file); everything else goes to stderr.

import { randomBytes } from "node:crypto";
import { register, USERNAME_PATTERN } from "../accounts.ts";
import { pool } from "../db.ts";

const username = process.argv[2] ?? "";
if (!USERNAME_PATTERN.test(username)) {
  console.error("usage: node server/src/tools/make-admin.ts <username>  (3-16 letters, numbers, _ or -)");
  process.exit(1);
}

const existing = await pool.query<{ id: number }>("SELECT id FROM accounts WHERE username_lower = $1", [username.toLowerCase()]);
let id = existing.rows[0]?.id;
if (id === undefined) {
  const password = randomBytes(18).toString("base64url"); // 24 characters
  const result = await register(username, password);
  if (!result.ok) {
    console.error(`couldn't create ${username}: ${result.error}`);
    process.exit(1);
  }
  id = result.account.id;
  process.stdout.write(`username: ${username}\npassword: ${password}\n`);
  console.error(`created ${username}`);
}
await pool.query("UPDATE accounts SET is_admin = true WHERE id = $1", [id]);
console.error(`${username} is now an admin`);
await pool.end();

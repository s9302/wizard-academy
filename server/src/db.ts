// Postgres connection pool and a tiny migration runner.
//
// Every query in the server uses parameters ($1, $2...), never string
// concatenation, so player input can't change a query's meaning (SQL
// injection).

import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Missing DATABASE_URL. See .env.example / docker-compose.yml.");
  process.exit(1);
}

export const pool = new pg.Pool({
  connectionString: url,
  max: Number(process.env.PG_POOL_MAX ?? 10),
});
pool.on("error", (err) => console.error("postgres pool error:", err.message));

// Run `fn` inside a transaction on one connection; rolls back if it throws.
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Postgres may still be starting when the server boots; keep trying for a bit.
export async function waitForDb(attempts = 30): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      console.log(`waiting for postgres (${i}/${attempts})...`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// Apply server/migrations/*.sql in filename order, each once, each in a
// transaction. Applied names are recorded in schema_migrations.
export async function migrate(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const dir = new URL("../migrations/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const done = new Set((await pool.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(new URL(file, dir), "utf8");
    await transaction(async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    });
    console.log(`applied migration ${file}`);
  }
}

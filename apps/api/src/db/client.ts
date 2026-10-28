import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../env";
import * as schema from "./schema";
import { normalizePgUrl } from "./url";

/**
 * node-postgres pool (not Neon's HTTP driver): money code needs interactive
 * transactions with SELECT ... FOR UPDATE. The pool connects lazily, so importing
 * this module never opens a connection by itself.
 */
export const pool = new pg.Pool({
  connectionString: normalizePgUrl(env.DATABASE_URL),
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// An idle client error (e.g. Neon closing an idle connection) must not crash the process.
pool.on("error", (err) => {
  console.error("[db] idle client error:", err.message);
});

export const db = drizzle(pool, { schema });
export type Db = typeof db;

/**
 * Cheap connectivity check for /api/health. Never throws.
 * 5 s budget: a cold connection includes TLS setup plus Neon waking its compute after idle (~1–3 s).
 */
export async function pingDb(timeoutMs = 5000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("db ping timeout")), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function closeDb(): Promise<void> {
  await pool.end();
}

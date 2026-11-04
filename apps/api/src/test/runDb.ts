/**
 * Every test run gets its OWN database (needgrid_run_<time>_<random>) on the TEST_DATABASE_URL server,
 * created when vitest starts and dropped when it ends. Two runs (yours + a teammate's, or two terminals)
 * can therefore never truncate each other's rows. Leftovers from killed runs older than 3 hours are
 * dropped automatically. If the role can't create databases, it falls back to the shared database.
 *
 * Used by vitest.config.ts (create) and src/test/globalTeardown.ts (drop). Never throws: errors are logged.
 */
import pg from "pg";
import { directNeonUrl, normalizePgUrl } from "../db/url.ts"; // ".ts": loaded by vitest's config loader

const PREFIX = "needgrid_run_";
const STALE_MS = 3 * 60 * 60 * 1000;

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

async function admin<T>(baseUrl: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const c = new pg.Client({
      connectionString: normalizePgUrl(directNeonUrl(baseUrl)),
      connectionTimeoutMillis: 20_000,
    });
    try {
      await c.connect();
      try {
        return await fn(c);
      } finally {
        await c.end().catch(() => {});
      }
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr;
}

/** Returns the private database URL (pooled form, like the input), or the input unchanged on failure. */
export async function createRunDatabase(baseUrl: string): Promise<{ url: string; name: string | null }> {
  if (!baseUrl) return { url: "", name: null };
  const name = `${PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await admin(baseUrl, async (c) => {
      // Clean up databases left behind by runs that were killed.
      const old = await c.query<{ datname: string }>("select datname from pg_database where datname like $1", [
        `${PREFIX}%`,
      ]);
      for (const { datname } of old.rows) {
        const ts = Number(datname.slice(PREFIX.length).split("_")[0]);
        if (Number.isFinite(ts) && Date.now() - ts > STALE_MS) {
          await c.query(`drop database if exists "${datname}" with (force)`).catch(() => {});
        }
      }
      await c.query(`create database "${name}"`);
    });
    return { url: withDatabase(baseUrl, name), name };
  } catch (err) {
    console.warn(
      `[test-db] couldn't create a private test database (${(err as Error).message || "connect failed"}); ` +
        "using the shared TEST_DATABASE_URL. Don't run tests from two places at once.",
    );
    return { url: baseUrl, name: null };
  }
}

export async function dropRunDatabase(baseUrl: string, name: string): Promise<void> {
  if (!baseUrl || !name.startsWith(PREFIX)) return;
  try {
    await admin(baseUrl, (c) => c.query(`drop database if exists "${name}" with (force)`));
  } catch (err) {
    console.warn(`[test-db] couldn't drop ${name} (it will be cleaned up by a later run): ${(err as Error).message}`);
  }
}

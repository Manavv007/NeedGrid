/**
 * Test database helpers. Used by every DB test (money tests from Phase 3 on).
 *
 * SAFETY: resetTestDb() DROPS EVERYTHING in the target database. It only ever runs against
 * TEST_DATABASE_URL, and refuses if that points at the same host/database as the dev DATABASE_URL.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "../db/schema";
import { describePgUrl, directNeonUrl, normalizePgUrl } from "../db/url";

const testUrl = process.env.TEST_DATABASE_URL ?? "";
const devUrl = process.env.GUARD_DEV_DATABASE_URL ?? "";

/** True when a test database is configured. Use with describe.skipIf(!hasTestDb). */
export const hasTestDb = testUrl.length > 0;

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

function assertSafeTarget() {
  if (!hasTestDb) throw new Error("TEST_DATABASE_URL is not set");
  if (devUrl && describePgUrl(directNeonUrl(devUrl)) === describePgUrl(directNeonUrl(testUrl))) {
    throw new Error(
      `Refusing to reset ${describePgUrl(testUrl)}: TEST_DATABASE_URL points at the same database as DATABASE_URL. ` +
        "Use a separate Neon branch (e.g. `test`) for TEST_DATABASE_URL.",
    );
  }
}

export function createTestDb() {
  assertSafeTarget();
  // Direct host: DDL (drop/migrate) is more reliable without the pooler.
  const pool = new pg.Pool({ connectionString: normalizePgUrl(directNeonUrl(testUrl)), max: 5 });
  const db = drizzle(pool, { schema });
  return { pool, db };
}

export type TestDb = ReturnType<typeof createTestDb>;

/** Drop all app objects and re-run every migration from scratch. */
export async function resetTestDb(t: TestDb): Promise<void> {
  assertSafeTarget();
  await t.pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await t.pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await t.pool.query("CREATE SCHEMA public");
  await migrate(t.db, { migrationsFolder });
}

/** Fast cleanup between tests: empty every table, keep the schema. */
export async function truncateAll(t: TestDb): Promise<void> {
  await t.pool.query(
    `TRUNCATE allocations, reservations, donations, purchases, deliveries, agent_actions,
              sponsor_invoices, webhook_events, needs, organizations RESTART IDENTITY CASCADE`,
  );
}

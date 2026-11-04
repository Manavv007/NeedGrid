import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";
import { createRunDatabase } from "./src/test/runDb.ts";

// DB tests use TEST_DATABASE_URL: from CI's job env, or from apps/api/.env locally.
// Only that one value (plus the dev DATABASE_URL, for a safety guard) is read from .env.
const dotenv = existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")) : {};
const baseTestDbUrl = process.env.TEST_DATABASE_URL || dotenv.TEST_DATABASE_URL || "";

export default defineConfig(async () => {
  // Each run works in its own freshly created database, so parallel runs can't wipe each other's rows.
  // Only when DB tests can run at all; dropped again in src/test/globalTeardown.ts.
  const run = await createRunDatabase(baseTestDbUrl);
  process.env.NG_TEST_BASE_URL = baseTestDbUrl;
  process.env.NG_TEST_RUN_DB = run.name ?? "";
  const testDbUrl = run.url;

  return {
    test: {
      environment: "node",
      include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
      globalSetup: ["./src/test/globalTeardown.ts"],
      // DB test files share the run's database: run files one at a time.
      fileParallelism: false,
      // Money tests make 20–40 sequential round trips to a remote Neon branch (~250 ms each from a laptop).
      testTimeout: 120_000,
      hookTimeout: 120_000,
      teardownTimeout: 30_000,
      // Tests must never need real keys. Minimal env so env.ts parses.
      // The app's own db client (src/db/client.ts) points at the run's TEST database when one is configured,
      // so route tests exercise real SQL; otherwise at a dummy URL that is never connected to.
      env: {
        NODE_ENV: "test",
        DATABASE_URL: testDbUrl || "postgres://test:test@localhost:5432/needgrid_test",
        TEST_DATABASE_URL: testDbUrl,
        GUARD_DEV_DATABASE_URL: dotenv.DATABASE_URL ?? "",
        PAYPAL_ENV: "sandbox",
        PAYPAL_CLIENT_ID: "test-client-id",
        PAYPAL_CLIENT_SECRET: "test-client-secret",
        PAYPAL_WEBHOOK_ID: "WH-TEST-WEBHOOK-ID",
        WEB_ORIGIN: "http://localhost:5173",
        CLOUDINARY_CLOUD_NAME: "demo",
        LOG_LEVEL: "silent",
      },
    },
  };
});

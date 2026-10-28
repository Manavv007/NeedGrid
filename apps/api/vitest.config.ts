import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

// DB tests use TEST_DATABASE_URL: from CI's job env, or from apps/api/.env locally.
// Only that one value (plus the dev DATABASE_URL, for a safety guard) is read from .env.
const dotenv = existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")) : {};
const testDbUrl = process.env.TEST_DATABASE_URL || dotenv.TEST_DATABASE_URL || "";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // DB test files share one database: run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Tests must never need real keys. Minimal env so env.ts parses.
    // The app's own db client (src/db/client.ts) points at the TEST database when one is configured,
    // so route tests exercise real SQL; otherwise at a dummy URL that is never connected to.
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDbUrl || "postgres://test:test@localhost:5432/needgrid_test",
      TEST_DATABASE_URL: testDbUrl,
      GUARD_DEV_DATABASE_URL: dotenv.DATABASE_URL ?? "",
      PAYPAL_ENV: "sandbox",
      PAYPAL_CLIENT_ID: "test-client-id",
      PAYPAL_CLIENT_SECRET: "test-client-secret",
      WEB_ORIGIN: "http://localhost:5173",
      CLOUDINARY_CLOUD_NAME: "demo",
      LOG_LEVEL: "silent",
    },
  },
});

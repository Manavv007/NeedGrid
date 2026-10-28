import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";
import { directNeonUrl, normalizePgUrl } from "./src/db/url";

// Locally, read apps/api/.env. On Render the variables are already in the environment.
if (existsSync(".env")) process.loadEnvFile(".env");

const url = process.env.DATABASE_URL ?? "";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // Migrations use Neon's direct (non-pooled) host, as Neon recommends for DDL.
  dbCredentials: { url: url ? normalizePgUrl(directNeonUrl(url)) : "" },
  strict: true,
  verbose: true,
});

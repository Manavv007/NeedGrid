/**
 * Drizzle schema. Phase 1 defines only `organizations` (needed by staff auth).
 * Phase 2 (A-2) adds every other table from AGENT_A_BACKEND.md §6 and generates the first migration.
 */
import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  city: text("city").notNull(),
  description: text("description").notNull().default(""),
  causeTags: text("cause_tags")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  logoUrl: text("logo_url"),
  payeeEmail: text("payee_email"),
  staffKeyHash: text("staff_key_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

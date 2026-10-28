-- Custom migration (hand-written): extensions must exist before any table uses them.
-- vector   → needs.embedding (Match me, pgvector)
-- pgcrypto → crypto helpers; gen_random_uuid() is built into Postgres 13+ but kept per the brief
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;

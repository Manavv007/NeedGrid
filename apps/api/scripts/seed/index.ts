/**
 * Demo data for NeedGrid (AGENT_B_AI_DATA.md §11). Made-up charities, needs and donation history.
 *
 *   pnpm --filter @needgrid/api seed                 add the 3 demo orgs if they don't have needs yet
 *   pnpm --filter @needgrid/api seed --reset         EMPTY EVERY TABLE, then seed (asks 5 s to cancel; --yes skips)
 *   pnpm --filter @needgrid/api seed --offline       use products.cache.json only, no embeddings (no credits)
 *   pnpm --filter @needgrid/api seed --fetch-only    search Channel3 for missing products, update the cache, stop
 *   pnpm --filter @needgrid/api seed --embeddings-only   backfill missing need embeddings (Match me)
 *   options: --seed 2026 (same data every run), --end 2026-11-09 (last day of history; default now),
 *            --refresh-products (re-search every product online)
 *
 * The seed runs in one transaction and checks the money invariants before committing.
 */
import { and, inArray, isNull } from "drizzle-orm";
import { embedNeedText } from "../../src/ai";
import { isEmbeddingConfigured } from "../../src/ai/models";
import { setNeedEmbedding } from "../../src/core";
import { closeDb, db } from "../../src/db/client";
import { needs, organizations } from "../../src/db/schema";
import { describePgUrl } from "../../src/db/url";
import { env } from "../../src/env";
import { findMoneyViolations } from "../../src/money/invariants";
import { CATALOG } from "./catalog";
import { SEED_ORGS } from "./orgs";
import { buildPlan, checkPlan } from "./plan";
import { candidatesFor, fetchMissing, loadCache, saveCache } from "./products";
import { writePlan } from "./seed";

interface Args {
  reset: boolean;
  offline: boolean;
  yes: boolean;
  fetchOnly: boolean;
  refreshProducts: boolean;
  embeddingsOnly: boolean;
  seed: number;
  end: Date;
}

function parseArgs(argv: string[]): Args {
  const has = (f: string) => argv.includes(f);
  const value = (f: string) => {
    const i = argv.indexOf(f);
    return i === -1 ? undefined : argv[i + 1];
  };
  const seed = Number(value("--seed") ?? 2026);
  if (!Number.isInteger(seed)) throw new Error("--seed must be an integer");
  const endArg = value("--end");
  let end = new Date();
  if (endArg) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endArg)) throw new Error("--end must look like 2026-11-09");
    end = new Date(`${endArg}T20:00:00.000Z`);
    if (end.getTime() > Date.now()) end = new Date(); // never put donations in the future
  }
  return {
    reset: has("--reset"),
    offline: has("--offline"),
    yes: has("--yes"),
    fetchOnly: has("--fetch-only"),
    refreshProducts: has("--refresh-products"),
    embeddingsOnly: has("--embeddings-only"),
    seed,
    end,
  };
}

const allTemplates = () =>
  SEED_ORGS.flatMap((org) =>
    (CATALOG[org.slug] ?? []).map((template) => ({ org, template, allowPet: org.allowPetProducts })),
  );

/** Online: search Channel3 for every product not cached yet, save the cache, report templates with no match. */
async function ensureProducts(args: Args) {
  const cache = loadCache();
  if (!args.offline) {
    const made = await fetchMissing(cache, allTemplates(), { refresh: args.refreshProducts });
    if (made > 0) {
      saveCache(cache);
      console.log(`Channel3: ${made} searches, saved to products.cache.json`);
    } else console.log("Channel3: every product is cached (no credits used)");
  }
  const missing = allTemplates().filter(
    ({ template, allowPet }) => !template.manual && candidatesFor(cache, template, allowPet).length === 0,
  );
  return { cache, missing };
}

async function backfillEmbeddings(orgSlugs: string[]): Promise<void> {
  if (!isEmbeddingConfigured()) {
    console.log("Embeddings: skipped (GOOGLE_GENERATIVE_AI_API_KEY not set)");
    return;
  }
  const orgIds = (await db.select({ id: organizations.id, slug: organizations.slug }).from(organizations))
    .filter((o) => orgSlugs.includes(o.slug))
    .map((o) => o.id);
  if (orgIds.length === 0) return;
  const rows = await db
    .select({
      id: needs.id,
      title: needs.title,
      description: needs.description,
      category: needs.category,
      unit: needs.unit,
    })
    .from(needs)
    .where(and(inArray(needs.orgId, orgIds), isNull(needs.embedding)));
  let done = 0;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const r = rows[next++]!;
      const v = await embedNeedText({ ...r, category: r.category as never });
      if (v) {
        await setNeedEmbedding(r.id, v);
        done++;
      } else failed++;
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));
  console.log(`Embeddings: ${done} added, ${failed} failed${failed ? " (rerun with --embeddings-only)" : ""}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = describePgUrl(env.DATABASE_URL);

  if (args.embeddingsOnly) {
    console.log(`Database: ${target}`);
    await backfillEmbeddings(SEED_ORGS.map((o) => o.slug));
    return;
  }

  const { cache, missing } = await ensureProducts(args);
  if (missing.length > 0) {
    console.error("No acceptable product for:");
    for (const m of missing) console.error(`  ${m.org.slug}/${m.template.key}  (query "${m.template.query}")`);
    throw new Error("Fix those templates in catalog.ts (query or match rules), then run again.");
  }
  if (args.fetchOnly) return;

  const plan = buildPlan({ seed: args.seed, end: args.end, cache });
  const problems = checkPlan(plan);
  if (problems.length > 0) throw new Error(`Seed plan is invalid:\n- ${problems.join("\n- ")}`);

  console.log(`Database: ${target}`);
  if (args.reset) {
    console.log("--reset will EMPTY EVERY TABLE in this database (orgs, needs, donations, PayPal records).");
    if (!args.yes) {
      console.log("Starting in 5 seconds. Press Ctrl+C to cancel.");
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }

  const res = await writePlan(db, plan, { reset: args.reset });
  for (const s of res.skippedOrgs) console.log(`Skipped ${s}: it already has needs (use --reset to rebuild).`);
  console.log(
    `Seeded ${res.seededOrgs.join(", ") || "nothing"}: ${res.counts.needs} needs, ${res.counts.donations} donations, ` +
      `${res.counts.purchases} purchases, ${res.counts.deliveries} deliveries.`,
  );

  // Same check as `pnpm --filter @needgrid/api check:money`, after commit.
  const after = await findMoneyViolations(db);
  for (const w of after.warnings) console.log(`  warning: ${w}`);
  if (after.errors.length > 0) throw new Error(`check:money failed after seeding:\n- ${after.errors.join("\n- ")}`);
  console.log("check:money: OK, all money invariants hold.");

  if (!args.offline && res.seededOrgs.length > 0) await backfillEmbeddings(res.seededOrgs);
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error(`Seed failed: ${(err as Error).message}`);
    await closeDb().catch(() => {});
    process.exit(1);
  });

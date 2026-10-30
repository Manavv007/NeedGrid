/**
 * Writes a SeedPlan to the database in ONE transaction, then checks the money invariants inside it:
 * any broken invariant rolls everything back (including --reset's truncate), so a failed seed leaves the
 * database exactly as it was.
 *
 * This is the only B code that writes money tables directly (AGENT_B_AI_DATA.md §0 rule 2, §11).
 */
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../src/db/schema";
import { hashStaffKey } from "../../src/lib/crypto";
import { findMoneyViolations } from "../../src/money/invariants";
import type { SeedPlan } from "./plan";

type Database = NodePgDatabase<typeof schema>;
const BATCH = 200;

export interface SeedResult {
  seededOrgs: string[];
  skippedOrgs: string[];
  counts: { needs: number; donations: number; allocations: number; purchases: number; deliveries: number };
  warnings: string[];
}

async function insertChunks<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) await insert(rows.slice(i, i + BATCH));
}

/**
 * reset: empty every table first. Otherwise each org is upserted by slug, and an org that already has needs is
 * skipped (so running the seed twice doesn't duplicate anything, and never deletes real test donations).
 */
export async function writePlan(database: Database, plan: SeedPlan, opts: { reset: boolean }): Promise<SeedResult> {
  return database.transaction(async (tx) => {
    if (opts.reset) {
      await tx.execute(sql`
        TRUNCATE allocations, reservations, donations, purchases, deliveries, agent_actions,
                 sponsor_invoices, webhook_events, needs, organizations RESTART IDENTITY CASCADE`);
    }

    const seededOrgs: string[] = [];
    const skippedOrgs: string[] = [];
    const idMap = new Map<string, string>(); // plan org id → real org id
    for (const { id, org } of plan.orgs) {
      const values = {
        slug: org.slug,
        name: org.name,
        city: org.city,
        description: org.description,
        causeTags: org.causeTags,
        logoUrl: null,
        staffKeyHash: hashStaffKey(org.staffPasscode),
      };
      const [row] = await tx
        .insert(schema.organizations)
        .values({ id, ...values })
        .onConflictDoUpdate({ target: schema.organizations.slug, set: values })
        .returning({ id: schema.organizations.id });
      const realId = row!.id;
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.needs)
        .where(eq(schema.needs.orgId, realId));
      if (!opts.reset && n > 0) {
        skippedOrgs.push(org.slug);
        continue;
      }
      idMap.set(id, realId);
      seededOrgs.push(org.slug);
    }

    const keep = <T extends { orgId: string }>(rows: T[]) =>
      rows.filter((r) => idMap.has(r.orgId)).map((r) => ({ ...r, orgId: idMap.get(r.orgId)! }));
    const needs = keep(plan.needs);
    const needIds = new Set(needs.map((n) => n.id));
    const donations = keep(plan.donations);
    const allocations = plan.allocations.filter((a) => needIds.has(a.needId));
    const purchases = plan.purchases.filter((p) => needIds.has(p.needId));
    const deliveries = plan.deliveries.filter((d) => needIds.has(d.needId));

    await insertChunks(needs, (c) => tx.insert(schema.needs).values(c));
    await insertChunks(donations, (c) => tx.insert(schema.donations).values(c));
    await insertChunks(allocations, (c) => tx.insert(schema.allocations).values(c));
    await insertChunks(purchases, (c) => tx.insert(schema.purchases).values(c));
    await insertChunks(deliveries, (c) => tx.insert(schema.deliveries).values(c));

    const { errors, warnings } = await findMoneyViolations(tx);
    if (errors.length > 0) {
      throw new Error(`Seed rolled back, money invariants broken:\n- ${errors.slice(0, 20).join("\n- ")}`);
    }

    return {
      seededOrgs,
      skippedOrgs,
      counts: {
        needs: needs.length,
        donations: donations.length,
        allocations: allocations.length,
        purchases: purchases.length,
        deliveries: deliveries.length,
      },
      warnings,
    };
  });
}

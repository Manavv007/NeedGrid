/**
 * GET /api/impact/:token: one donor's items, statuses and arrival photos.
 * Personal data: only the donor's first name is returned (this is their own page).
 */
import { ImpactRes, type AllocationReason } from "@needgrid/shared";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { allocations, donations, needs, organizations } from "../db/schema";
import { notFound } from "../lib/http";
import { buildTimeline, getNeedCards, publicDelivery } from "./needs";

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

export async function getImpact(token: string): Promise<ImpactRes> {
  if (!TOKEN.test(token)) throw notFound("Impact page");
  const [donation] = await db.select().from(donations).where(eq(donations.impactToken, token)).limit(1);
  if (!donation) throw notFound("Impact page");

  // Net amount per need (positive only), with the reason of the first allocation to it.
  const perNeed = await db
    .select({
      needId: allocations.needId,
      amountCents: sql<number>`sum(${allocations.amountCents})::int`,
      reason: sql<string>`(array_agg(${allocations.reason} order by ${allocations.createdAt}) filter (where ${allocations.amountCents} > 0))[1]`,
    })
    .from(allocations)
    .where(eq(allocations.donationId, donation.id))
    .groupBy(allocations.needId)
    .having(sql`sum(${allocations.amountCents}) > 0`)
    .orderBy(sql`min(${allocations.createdAt})`);

  const needIds = perNeed.map((p) => p.needId);
  const [cards, rows] = await Promise.all([
    getNeedCards(needIds),
    needIds.length
      ? db
          .select({ need: needs, orgName: organizations.name })
          .from(needs)
          .innerJoin(organizations, eq(organizations.id, needs.orgId))
          .where(inArray(needs.id, needIds))
      : Promise.resolve([]),
  ]);
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const rowById = new Map(rows.map((r) => [r.need.id, r]));

  const items = await Promise.all(
    perNeed.map(async (p) => {
      const row = rowById.get(p.needId)!;
      const [timeline, delivery] = await Promise.all([buildTimeline(row.need), publicDelivery(row.need)]);
      return {
        need: cardById.get(p.needId)!,
        orgName: row.orgName,
        amountCents: p.amountCents,
        reason: p.reason as AllocationReason,
        timeline,
        delivery,
      };
    }),
  );

  const firstName = donation.donorName?.trim().split(/\s+/)[0] || null;
  return ImpactRes.parse({
    donorFirstName: firstName,
    totalCents: donation.amountCents - donation.refundedCents,
    donatedAt: donation.createdAt.toISOString(),
    items,
  });
}

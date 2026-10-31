/**
 * Flat, NO-PERSONAL-DATA tables for the public AG Studio dashboard (AGENT_B_AI_DATA.md §9.8).
 *
 * Never selected: donor names and emails, PayPal order/capture/invoice ids, impact tokens, staff keys, donation ids.
 * Donations are identified only by `donationKey` = HMAC-SHA256(DASHBOARD_HMAC_SECRET, donation.id), first 16 hex
 * chars: enough to join allocations to donations, not reversible to the id.
 * Reads only (B may read any table; writes go through core). Cached 60 s per dataset.
 */
import { createHmac, randomBytes } from "node:crypto";
import {
  centsToUsdNumber,
  DatasetAllocationRow,
  DatasetDonationRow,
  DatasetNeedRow,
  type DatasetName,
  type DatasetRes,
} from "@needgrid/shared";
import { desc, eq, isNotNull, ne, or } from "drizzle-orm";
import { TtlCache } from "../channel3/client";
import { db, schema } from "../core";
import { env } from "../env";

const { allocations, deliveries, donations, needs, organizations } = schema;
const DAY_MS = 86_400_000;

let fallbackSecret: string | null = null;

/** The HMAC key. Without DASHBOARD_HMAC_SECRET (local dev, tests) a random per-process key is used: keys stay
 * consistent while the server runs, which is all the joins need. */
function hmacSecret(): string {
  if (env.DASHBOARD_HMAC_SECRET) return env.DASHBOARD_HMAC_SECRET;
  if (!fallbackSecret) {
    fallbackSecret = randomBytes(32).toString("hex");
    if (env.NODE_ENV === "production") {
      console.warn("[datasets] DASHBOARD_HMAC_SECRET is not set; using a random key until the next restart");
    }
  }
  return fallbackSecret;
}

export function donationKey(donationId: string, secret: string = hmacSecret()): string {
  return createHmac("sha256", secret).update(donationId, "utf8").digest("hex").slice(0, 16);
}

/** "2026-11" in UTC. */
export const monthOf = (d: Date): string => d.toISOString().slice(0, 7);

/** Whole days between funded and delivered (rounded), or null. */
export function daysBetween(from: Date | null, to: Date | null): number | null {
  if (!from || !to) return null;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / DAY_MS));
}

async function needRows(): Promise<DatasetNeedRow[]> {
  const rows = await db
    .select({
      needId: needs.id,
      orgSlug: organizations.slug,
      orgName: organizations.name,
      title: needs.title,
      category: needs.category,
      urgency: needs.urgency,
      status: needs.status,
      quantity: needs.quantity,
      unit: needs.unit,
      product: needs.product,
      targetCents: needs.targetCents,
      fundedCents: needs.fundedCents,
      createdAt: needs.createdAt,
      fundedAt: needs.fundedAt,
      orderedAt: needs.orderedAt,
      deliveredAt: needs.deliveredAt,
    })
    .from(needs)
    .innerJoin(organizations, eq(organizations.id, needs.orgId))
    .where(ne(needs.status, "draft"))
    .orderBy(organizations.slug, needs.createdAt);

  // Latest donor-visible arrival photo per delivered need (passed the AI check or confirmed by staff).
  const photos = await db
    .selectDistinctOn([deliveries.needId], { needId: deliveries.needId, photoUrl: deliveries.photoUrl })
    .from(deliveries)
    .where(or(eq(deliveries.needsReview, false), isNotNull(deliveries.confirmedAt)))
    .orderBy(deliveries.needId, desc(deliveries.createdAt));
  const photoByNeed = new Map(photos.map((p) => [p.needId, p.photoUrl]));

  return rows.map((r) =>
    DatasetNeedRow.parse({
      needId: r.needId,
      orgSlug: r.orgSlug,
      orgName: r.orgName,
      title: r.title,
      category: r.category,
      urgency: r.urgency,
      status: r.status,
      quantity: r.quantity,
      unit: r.unit,
      retailer: r.product?.retailer ?? null,
      targetUsd: centsToUsdNumber(r.targetCents),
      fundedUsd: centsToUsdNumber(r.fundedCents),
      createdAt: r.createdAt.toISOString(),
      fundedAt: r.fundedAt?.toISOString() ?? null,
      orderedAt: r.orderedAt?.toISOString() ?? null,
      deliveredAt: r.deliveredAt?.toISOString() ?? null,
      daysFundedToDelivered: r.status === "delivered" ? daysBetween(r.fundedAt, r.deliveredAt) : null,
      photoUrl: r.status === "delivered" ? (photoByNeed.get(r.needId) ?? null) : null,
    }),
  );
}

async function donationRows(): Promise<DatasetDonationRow[]> {
  const secret = hmacSecret();
  const rows = await db
    .select({
      id: donations.id,
      orgSlug: organizations.slug,
      amountCents: donations.amountCents,
      refundedCents: donations.refundedCents,
      source: donations.source,
      createdAt: donations.createdAt,
    })
    .from(donations)
    .innerJoin(organizations, eq(organizations.id, donations.orgId))
    .orderBy(donations.createdAt);
  return rows.map((r) =>
    DatasetDonationRow.parse({
      donationKey: donationKey(r.id, secret),
      orgSlug: r.orgSlug,
      amountUsd: centsToUsdNumber(r.amountCents - r.refundedCents), // net of refunds
      source: r.source,
      donatedAt: r.createdAt.toISOString(),
      month: monthOf(r.createdAt),
    }),
  );
}

async function allocationRows(): Promise<DatasetAllocationRow[]> {
  const secret = hmacSecret();
  const rows = await db
    .select({
      allocationId: allocations.id,
      donationId: allocations.donationId,
      needId: allocations.needId,
      orgSlug: organizations.slug,
      category: needs.category,
      amountCents: allocations.amountCents,
      reason: allocations.reason,
      createdAt: allocations.createdAt,
    })
    .from(allocations)
    .innerJoin(needs, eq(needs.id, allocations.needId))
    .innerJoin(organizations, eq(organizations.id, needs.orgId))
    // Same filter as the needs dataset, so every allocation's needId joins to a needs row.
    .where(ne(needs.status, "draft"))
    .orderBy(allocations.createdAt);
  return rows.map((r) =>
    DatasetAllocationRow.parse({
      allocationId: r.allocationId,
      donationKey: donationKey(r.donationId, secret),
      needId: r.needId,
      orgSlug: r.orgSlug,
      category: r.category,
      amountUsd: centsToUsdNumber(r.amountCents), // signed: negative = money moved out of this need
      reason: r.reason,
      allocatedAt: r.createdAt.toISOString(),
      month: monthOf(r.createdAt),
    }),
  );
}

const builders: Record<DatasetName, () => Promise<DatasetRes["rows"]>> = {
  needs: needRows,
  donations: donationRows,
  allocations: allocationRows,
};

const cache = new TtlCache<DatasetRes>(3, 60_000);

/** One dataset, at most 60 s old. */
export function getDataset(name: DatasetName): Promise<DatasetRes> {
  return cache.getOrLoad(name, async () => ({
    name,
    generatedAt: new Date().toISOString(),
    rows: await builders[name](),
  }));
}

/** Tests. */
export function clearDatasetCache(): void {
  cache.clear();
}

/** Small builders for DB tests. Made-up demo data only. */
import type { ProductSnapshot } from "@needgrid/shared";
import { hashStaffKey } from "../lib/crypto";
import { allocations, donations, needs, organizations, type NeedRow } from "../db/schema";
import type { TestDb } from "./db";

export const demoProduct = (unitPriceCents = 3849): ProductSnapshot => ({
  channel3Id: `p-${unitPriceCents}`,
  title: "Pampers Cruisers Size 4, 150 ct",
  imageUrl: "https://images.example.com/diapers.jpg",
  retailer: "walmart.com",
  url: "https://www.walmart.com/ip/123",
  unitPriceCents,
  packSize: 150,
  inStock: true,
  fetchedAt: "2026-10-27T00:00:00.000Z",
});

export async function seedOrg(t: TestDb, slug = "harbor-food-bank", key = "harbor-demo-2026") {
  const [org] = await t.db
    .insert(organizations)
    .values({ slug, name: `Org ${slug}`, city: "Portland, OR", staffKeyHash: hashStaffKey(key) })
    .returning();
  return org!;
}

/** Pre-funded amounts get a real seed donation + allocation, so the money invariants hold. */
export async function seedNeed(
  t: TestDb,
  orgId: string,
  values: Partial<typeof needs.$inferInsert> & { title: string; targetCents: number },
): Promise<NeedRow> {
  const [need] = await t.db
    .insert(needs)
    .values({
      orgId,
      category: "baby",
      urgency: 2,
      quantity: 1,
      unit: "pack",
      status: "open",
      product: demoProduct(),
      ...values,
    })
    .returning();
  const funded = values.fundedCents ?? 0;
  if (funded > 0) {
    const [don] = await t.db
      .insert(donations)
      .values({ orgId, amountCents: funded, source: "seed", impactToken: `seed-${need!.id}` })
      .returning({ id: donations.id });
    await t.db
      .insert(allocations)
      .values({ donationId: don!.id, needId: need!.id, amountCents: funded, reason: "direct" });
  }
  return need!;
}

/** Distinct client IPs (trustProxy reads x-forwarded-for), so tests don't trip per-IP rate limits. */
let ipSeq = 0;
export const nextIp = () => {
  ipSeq++;
  return `10.${Math.floor(ipSeq / 65_000) % 250}.${Math.floor(ipSeq / 250) % 250}.${(ipSeq % 250) + 1}`;
};

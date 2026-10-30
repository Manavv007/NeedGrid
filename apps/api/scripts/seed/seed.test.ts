import { ProductSnapshot } from "@needgrid/shared";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allocations, donations, needs, organizations, purchases } from "../../src/db/schema";
import { hashStaffKey } from "../../src/lib/crypto";
import { assertMoneyInvariants } from "../../src/money/invariants";
import { createTestDb, hasTestDb, migrateTestDb, truncateAll, type TestDb } from "../../src/test/db";
import { CATALOG, HEROES } from "./catalog";
import { SEED_ORGS } from "./orgs";
import { buildPlan, checkPlan, splitDonations } from "./plan";
import { createRng } from "./prng";
import { candidatesFor, loadCache } from "./products";
import { writePlan } from "./seed";

const END = new Date("2026-11-09T20:00:00.000Z");
const cache = loadCache();
const plan = buildPlan({ seed: 2026, end: END, cache });
const needByKey = (k: string) => plan.needs.find((n) => n.id === plan.needIds.get(k))!;

describe("committed products.cache.json", () => {
  it("has an acceptable product for every Channel3 need (offline seeding works)", () => {
    const missing = SEED_ORGS.flatMap((o) =>
      (CATALOG[o.slug] ?? [])
        .filter((t) => !t.manual && candidatesFor(cache, t, o.allowPetProducts).length === 0)
        .map((t) => `${o.slug}/${t.key}`),
    );
    expect(missing).toEqual([]);
  });
  it("contains only valid ProductSnapshots", () => {
    for (const s of Object.values(cache.searches)) s.products.forEach((p) => ProductSnapshot.parse(p));
  });
});

describe("buildPlan", () => {
  it("is deterministic for the same seed and end date", () => {
    const again = buildPlan({ seed: 2026, end: END, cache });
    expect(again.needs.map((n) => [n.id, n.targetCents, n.fundedCents])).toEqual(
      plan.needs.map((n) => [n.id, n.targetCents, n.fundedCents]),
    );
    expect(again.donations.length).toBe(plan.donations.length);
  });

  it("satisfies the money and timeline rules", () => {
    expect(checkPlan(plan)).toEqual([]);
  });

  it("has 40–60 needs per org, 600–900 donations and the planned status mix", () => {
    for (const o of plan.orgs) {
      const n = plan.needs.filter((x) => x.orgId === o.id).length;
      expect(n).toBeGreaterThanOrEqual(40);
      expect(n).toBeLessThanOrEqual(60);
    }
    expect(plan.donations.length).toBeGreaterThanOrEqual(600);
    expect(plan.donations.length).toBeLessThanOrEqual(900);
    const share = (s: string) => plan.needs.filter((n) => n.status === s).length / plan.needs.length;
    expect(share("open")).toBeGreaterThan(0.45);
    expect(share("delivered")).toBeGreaterThan(0.1);
    expect(share("closed")).toBeGreaterThan(0);
  });

  it("keeps all history inside the 8 weeks before the end date, with first names only", () => {
    const start = END.getTime() - 56 * 86_400_000;
    for (const d of plan.donations) {
      expect(d.createdAt!.getTime()).toBeGreaterThanOrEqual(start);
      expect(d.createdAt!.getTime()).toBeLessThanOrEqual(END.getTime());
      expect(d.donorEmail).toBeNull();
      expect(d.source).toBe("seed");
      if (d.donorName) expect(d.donorName).toMatch(/^[A-Z][a-z]+$/);
    }
  });

  it("demo needs: $14 left, a funded price-drop need, an ordered need, four open coat needs", () => {
    const d4 = needByKey(`${HEROES.fourteenLeft.org}/${HEROES.fourteenLeft.key}`);
    expect([d4.status, d4.targetCents - d4.fundedCents!]).toEqual(["open", 1400]);
    const drop = needByKey(`${HEROES.priceDrop.org}/${HEROES.priceDrop.key}`);
    expect(drop.status).toBe("funded");
    expect(drop.product!.unitPriceCents).toBeGreaterThan(
      candidatesFor(
        cache,
        CATALOG[HEROES.priceDrop.org]!.find((t) => t.key === HEROES.priceDrop.key)!,
        false,
      )[0]!.unitPriceCents,
    );
    expect(needByKey(`${HEROES.ordered.org}/${HEROES.ordered.key}`).status).toBe("ordered");
    for (const k of HEROES.coats.keys) expect(needByKey(`${HEROES.coats.org}/${k}`).status).toBe("open");
  });

  it("ordered and delivered needs have an ordered purchase; delivered ones have a passing delivery", () => {
    for (const n of plan.needs.filter((x) => x.status === "ordered" || x.status === "delivered")) {
      const p = plan.purchases.filter((x) => x.needId === n.id);
      expect(p).toHaveLength(1);
      expect(p[0]).toMatchObject({ status: "ordered", newTargetCents: n.targetCents });
      expect(p[0]!.orderRef).toMatch(/^[A-Z]{2,3}-\d{3}-\d{7}$/);
    }
    for (const n of plan.needs.filter((x) => x.status === "delivered")) {
      const d = plan.deliveries.filter((x) => x.needId === n.id);
      expect(d).toHaveLength(1);
      expect(d[0]!.needsReview).toBe(false);
      expect(d[0]!.matchScore).toBeGreaterThanOrEqual(0.8);
      expect(d[0]!.matchScore).toBeLessThanOrEqual(0.97);
    }
  });
});

describe("splitDonations", () => {
  it("exact splits add up to the total; partial splits never exceed it", () => {
    const rng = createRng(7);
    for (const total of [100, 1400, 8314, 35_600]) {
      expect(splitDonations(rng, total, true).reduce((s, x) => s + x, 0)).toBe(total);
      expect(splitDonations(rng, total, false).reduce((s, x) => s + x, 0)).toBeLessThanOrEqual(total);
    }
    expect(splitDonations(rng, 0, true)).toEqual([]);
  });
});

describe.skipIf(!hasTestDb)("writePlan against the test database", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = createTestDb();
    await migrateTestDb(t);
    await truncateAll(t);
  });
  afterAll(async () => {
    await truncateAll(t);
    await t.pool.end();
  });

  it("seeds everything, and the money invariants hold (check:money)", async () => {
    const res = await writePlan(t.db, plan, { reset: true });
    expect(res.seededOrgs).toEqual(SEED_ORGS.map((o) => o.slug));
    expect(res.counts).toMatchObject({ needs: plan.needs.length, donations: plan.donations.length });
    await assertMoneyInvariants(t.db);
    const [allocs] = await t.db.select({ n: count() }).from(allocations);
    expect(allocs!.n).toBe(plan.allocations.length);
    const [purch] = await t.db.select({ n: count() }).from(purchases);
    expect(purch!.n).toBe(plan.purchases.length);
  });

  it("stores the demo staff passcodes as SHA-256 hashes", async () => {
    const [harbor] = await t.db.select().from(organizations).where(eq(organizations.slug, "harbor-food-bank"));
    expect(harbor!.staffKeyHash).toBe(hashStaffKey("harbor-demo-2026"));
  });

  it("running it again without --reset changes nothing", async () => {
    const before = await t.db.select({ n: count() }).from(donations);
    const res = await writePlan(t.db, plan, { reset: false });
    expect(res.seededOrgs).toEqual([]);
    expect(res.skippedOrgs).toHaveLength(3);
    expect(await t.db.select({ n: count() }).from(donations)).toEqual(before);
    expect((await t.db.select({ n: count() }).from(needs))[0]!.n).toBe(plan.needs.length);
  });

  it("a broken invariant rolls the whole seed back", async () => {
    const broken = {
      ...plan,
      needs: plan.needs.map((n, i) => (i === 0 ? { ...n, fundedCents: (n.fundedCents ?? 0) + 1 } : n)),
    };
    await expect(writePlan(t.db, broken, { reset: true })).rejects.toThrow(/money invariants broken/);
    // The truncate was rolled back too: the previous seed is still there.
    expect((await t.db.select({ n: count() }).from(needs))[0]!.n).toBe(plan.needs.length);
  });
});

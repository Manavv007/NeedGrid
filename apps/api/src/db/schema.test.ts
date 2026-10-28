import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashStaffKey } from "../lib/crypto";
import { createTestDb, hasTestDb, resetTestDb, truncateAll, type TestDb } from "../test/db";
import { allocations, donations, needs, organizations, purchases } from "./schema";

/** Postgres error code of a failed query (drizzle wraps the driver error in `cause`). */
async function pgCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    return err.cause?.code ?? err.code;
  }
}

describe.skipIf(!hasTestDb)("migrations + schema constraints (TEST_DATABASE_URL)", () => {
  let t: TestDb;
  let orgId: string;
  let needId: string;

  beforeAll(async () => {
    t = createTestDb();
    await resetTestDb(t);
    await truncateAll(t);
    const [org] = await t.db
      .insert(organizations)
      .values({
        slug: "harbor-food-bank",
        name: "Harbor Food Bank",
        city: "Portland, OR",
        staffKeyHash: hashStaffKey("k"),
      })
      .returning();
    orgId = org!.id;
    const [need] = await t.db
      .insert(needs)
      .values({ orgId, title: "Diapers, size 4", category: "baby", quantity: 2, unit: "pack", targetCents: 8400 })
      .returning();
    needId = need!.id;
  });

  afterAll(async () => {
    await t?.pool.end();
  });

  it("creates all 10 tables and both extensions", async () => {
    const tables = await t.pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual([
      "agent_actions",
      "allocations",
      "deliveries",
      "donations",
      "needs",
      "organizations",
      "purchases",
      "reservations",
      "sponsor_invoices",
      "webhook_events",
    ]);
    const ext = await t.pool.query<{ extname: string }>(
      "select extname from pg_extension where extname in ('vector','pgcrypto') order by extname",
    );
    expect(ext.rows.map((r) => r.extname)).toEqual(["pgcrypto", "vector"]);
  });

  it("applies defaults (draft, 0 funded, empty alternatives)", async () => {
    const res = await t.pool.query("select status, funded_cents, urgency, alternatives from needs where id = $1", [
      needId,
    ]);
    expect(res.rows[0]).toEqual({ status: "draft", funded_cents: 0, urgency: 2, alternatives: [] });
  });

  it("stores a 768-dim embedding and rejects other sizes", async () => {
    const v = Array.from({ length: 768 }, (_, i) => (i % 7) / 10);
    await t.pool.query("update needs set embedding = $1 where id = $2", [JSON.stringify(v), needId]);
    expect(await pgCode(t.pool.query("update needs set embedding = '[1,2,3]' where id = $1", [needId]))).toBe("22000");
  });

  it("rejects invalid enum values, urgency and negative money (CHECK constraints)", async () => {
    const base = { orgId, title: "x", category: "baby", quantity: 1, unit: "pack", targetCents: 100 };
    expect(await pgCode(t.db.insert(needs).values({ ...base, status: "paid" }))).toBe("23514");
    expect(await pgCode(t.db.insert(needs).values({ ...base, category: "toys" }))).toBe("23514");
    expect(await pgCode(t.db.insert(needs).values({ ...base, urgency: 5 }))).toBe("23514");
    expect(await pgCode(t.db.insert(needs).values({ ...base, quantity: 0 }))).toBe("23514");
    expect(await pgCode(t.db.insert(needs).values({ ...base, fundedCents: -1 }))).toBe("23514");
  });

  it("enforces unique capture_id (no double counting)", async () => {
    const d = { orgId, amountCents: 1400, source: "order", captureId: "CAP-1" };
    await t.db.insert(donations).values({ ...d, impactToken: "tok-1", paypalOrderId: "ORD-1" });
    expect(await pgCode(t.db.insert(donations).values({ ...d, impactToken: "tok-2", paypalOrderId: "ORD-2" }))).toBe(
      "23505",
    );
  });

  it("allocations: signed amounts allowed, zero rejected", async () => {
    const [don] = await t.db
      .insert(donations)
      .values({ orgId, amountCents: 500, source: "seed", impactToken: "tok-3" })
      .returning();
    await t.db.insert(allocations).values({ donationId: don!.id, needId, amountCents: 500, reason: "direct" });
    await t.db.insert(allocations).values({ donationId: don!.id, needId, amountCents: -200, reason: "price_drop" });
    expect(
      await pgCode(t.db.insert(allocations).values({ donationId: don!.id, needId, amountCents: 0, reason: "direct" })),
    ).toBe("23514");
  });

  it("allows only one approved purchase per need", async () => {
    const offer = {
      channel3Id: "p1",
      title: "Diapers",
      retailer: "walmart.com",
      url: "https://walmart.com/p1",
      imageUrl: null,
      unitPriceCents: 3849,
      inStock: true,
    };
    const p = { needId, offer, newTargetCents: 8400 };
    await t.db.insert(purchases).values({ ...p, status: "approved" });
    await t.db.insert(purchases).values({ ...p, status: "proposed" }); // fine
    expect(await pgCode(t.db.insert(purchases).values({ ...p, status: "approved" }))).toBe("23505");
  });

  it("is re-runnable: migrating an up-to-date database is a no-op", async () => {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");
    await expect(migrate(t.db, { migrationsFolder: folder })).resolves.toBeUndefined();
  });
});

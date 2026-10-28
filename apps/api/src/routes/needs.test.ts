/**
 * Read + publish/edit endpoints against a real Postgres (TEST_DATABASE_URL).
 * Skipped when no test database is configured.
 */
import type { NeedCard } from "@needgrid/shared";
import {
  ApiError,
  NeedDetailRes,
  NeedRes,
  OrgListRes,
  OrgPageRes,
  StaffNeedDetailRes,
  StaffNeedListRes,
  type ProductSnapshot,
} from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { getNextMostUrgentNeed, listDonatableNeeds, setNeedEmbedding } from "../core/needs";
import { closeDb } from "../db/client";
import { allocations, donations, needs, organizations, purchases, reservations } from "../db/schema";
import { onNeedUpdated } from "../lib/events";
import { hashStaffKey } from "../lib/crypto";
import { createTestDb, hasTestDb, migrateTestDb, truncateAll, type TestDb } from "../test/db";

const HARBOR_KEY = "harbor-demo-2026";
const PAWS_KEY = "paws-demo-2026";
const MIN = 60_000;
const DAY = 86_400_000;

const product = (unitPriceCents: number): ProductSnapshot => ({
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

describe.skipIf(!hasTestDb)("needs: read, publish and edit endpoints", () => {
  let t: TestDb;
  let app: FastifyInstance;
  const id: Record<string, string> = {};

  const get = (url: string, key?: string) =>
    app.inject({ method: "GET", url, headers: key ? { "x-staff-key": key } : {} });
  const send = (method: "POST" | "PATCH", url: string, payload: unknown, key = HARBOR_KEY) =>
    app.inject({ method, url, payload: payload as object, headers: { "x-staff-key": key } });

  beforeAll(async () => {
    t = createTestDb();
    await migrateTestDb(t);
    await truncateAll(t);

    const [harbor, paws] = await t.db
      .insert(organizations)
      .values([
        {
          slug: "harbor-food-bank",
          name: "Harbor Food Bank",
          city: "Portland, OR",
          causeTags: ["food", "baby"],
          staffKeyHash: hashStaffKey(HARBOR_KEY),
        },
        {
          slug: "second-chance-paws",
          name: "Second Chance Paws",
          city: "Austin, TX",
          staffKeyHash: hashStaffKey(PAWS_KEY),
        },
      ])
      .returning();
    id.harbor = harbor!.id;
    id.paws = paws!.id;

    const base = { orgId: harbor!.id, category: "baby", unit: "pack of 150", product: product(3849) };
    const now = Date.now();
    const rows = await t.db
      .insert(needs)
      .values([
        {
          ...base,
          title: "Diapers, size 4",
          urgency: 3,
          quantity: 2,
          status: "open",
          targetCents: 8400,
          fundedCents: 7000,
          createdAt: new Date(now - 5 * DAY),
        },
        { ...base, title: "Baby wipes", urgency: 1, quantity: 1, status: "open", targetCents: 2000 },
        {
          ...base,
          title: "Formula",
          urgency: 2,
          quantity: 1,
          status: "funded",
          targetCents: 3000,
          fundedCents: 3000,
          fundedAt: new Date(now - DAY),
          createdAt: new Date(now - 3 * DAY),
        },
        { ...base, title: "Draft item", urgency: 2, quantity: 1, status: "draft", targetCents: 1000 },
        {
          ...base,
          title: "Old closed item",
          urgency: 2,
          quantity: 1,
          status: "closed",
          targetCents: 1000,
          closedAt: new Date(now - DAY),
        },
        {
          ...base,
          title: "Winter hats",
          urgency: 3,
          quantity: 1,
          status: "open",
          targetCents: 5000,
          deadlineAt: new Date(now + 3 * DAY),
        },
        {
          orgId: paws!.id,
          title: "Dog food",
          category: "pet",
          unit: "bag",
          urgency: 2,
          quantity: 1,
          status: "open",
          targetCents: 4500,
          product: product(4000),
        },
      ])
      .returning({ id: needs.id });
    const names = ["diapers", "wipes", "formula", "draft", "closed", "hats", "dogFood"];
    rows.forEach((r, i) => (id[names[i]!] = r.id));

    const don = await t.db
      .insert(donations)
      .values([
        { orgId: harbor!.id, amountCents: 5000, source: "seed", impactToken: "t1" },
        { orgId: harbor!.id, amountCents: 2000, source: "seed", impactToken: "t2" },
        { orgId: harbor!.id, amountCents: 3000, source: "seed", impactToken: "t3" },
        { orgId: harbor!.id, amountCents: 1000, source: "seed", impactToken: "t4" },
      ])
      .returning({ id: donations.id });
    await t.db.insert(allocations).values([
      { donationId: don[0]!.id, needId: id.diapers!, amountCents: 5000, reason: "direct" },
      { donationId: don[1]!.id, needId: id.diapers!, amountCents: 2000, reason: "direct" },
      {
        donationId: don[2]!.id,
        needId: id.formula!,
        amountCents: 3000,
        reason: "direct",
        createdAt: new Date(now - 2 * DAY),
      },
      // Net zero on wipes: must not count as a donor.
      { donationId: don[3]!.id, needId: id.wipes!, amountCents: 1000, reason: "direct" },
      { donationId: don[3]!.id, needId: id.wipes!, amountCents: -1000, reason: "price_drop" },
      { donationId: don[3]!.id, needId: id.hats!, amountCents: 1000, reason: "price_drop" },
    ]);
    // hats got 1000 via price_drop above
    await t.db.update(needs).set({ fundedCents: 1000 }).where(eq(needs.id, id.hats!));

    await t.db.insert(reservations).values([
      { needId: id.diapers!, amountCents: 400, expiresAt: new Date(now + 10 * MIN) }, // counts
      { needId: id.diapers!, amountCents: 1000, expiresAt: new Date(now - MIN) }, // expired: ignored
      { needId: id.diapers!, amountCents: 500, expiresAt: new Date(now + 10 * MIN), status: "released" }, // ignored
    ]);
    await t.db.insert(purchases).values({
      needId: id.formula!,
      offer: {
        channel3Id: "p1",
        title: "Formula",
        retailer: "target.com",
        url: "https://target.com/p1",
        imageUrl: null,
        unitPriceCents: 2700,
        inStock: true,
      },
      newTargetCents: 3000,
      status: "approved",
      approvedAt: new Date(now - DAY / 2),
    });

    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await t?.pool.end();
    await closeDb();
  });

  // ------------------------------------------------------------------ public reads
  it("GET /api/orgs lists orgs with stats", async () => {
    const res = await get("/api/orgs");
    expect(res.statusCode).toBe(200);
    const { orgs } = OrgListRes.parse(res.json());
    expect(orgs.map((o) => o.slug)).toEqual(["harbor-food-bank", "second-chance-paws"]);
    expect(orgs[0]!.stats).toEqual({ raisedCents: 11_000, itemsFunded: 1, itemsDelivered: 0, openNeeds: 3 });
    expect(orgs[1]!.stats).toEqual({ raisedCents: 0, itemsFunded: 0, itemsDelivered: 0, openNeeds: 1 });
  });

  it("GET /api/orgs/:slug hides drafts and closed needs, most urgent first", async () => {
    const res = await get("/api/orgs/harbor-food-bank");
    expect(res.statusCode).toBe(200);
    const page = OrgPageRes.parse(res.json());
    expect(page.needs.map((n) => n.title)).toEqual(["Winter hats", "Diapers, size 4", "Formula", "Baby wipes"]);
  });

  it("NeedCard numbers: active holds only, remaining, net-positive donors", async () => {
    const page = OrgPageRes.parse((await get("/api/orgs/harbor-food-bank")).json());
    const diapers = page.needs.find((n) => n.id === id.diapers)!;
    expect(diapers).toMatchObject({
      targetCents: 8400,
      fundedCents: 7000,
      heldCents: 400,
      remainingCents: 1000,
      donorCount: 2,
    });
    const wipes = page.needs.find((n) => n.id === id.wipes)!;
    expect(wipes).toMatchObject({ fundedCents: 0, donorCount: 0, remainingCents: 2000 });
  });

  it("GET /api/orgs/:slug unknown → 404", async () => {
    const res = await get("/api/orgs/nope");
    expect(res.statusCode).toBe(404);
    expect(ApiError.parse(res.json()).error.code).toBe("NOT_FOUND");
  });

  it("GET /api/needs/:id returns the need, org and timeline", async () => {
    const res = await get(`/api/needs/${id.diapers}`);
    expect(res.statusCode).toBe(200);
    const detail = NeedDetailRes.parse(res.json());
    expect(detail.org.slug).toBe("harbor-food-bank");
    expect(detail.delivery).toBeNull();
    expect(detail.timeline.map((e) => e.type)).toEqual(["created", "donation"]);
    expect(detail.timeline[1]).toMatchObject({ label: "2 donors gave $70.00", amountCents: 7000 });

    const formula = NeedDetailRes.parse((await get(`/api/needs/${id.formula}`)).json());
    expect(formula.timeline.map((e) => e.type)).toEqual(["created", "donation", "funded", "purchase_approved"]);
  });

  it("GET /api/needs/:id: draft and malformed ids → 404", async () => {
    expect((await get(`/api/needs/${id.draft}`)).statusCode).toBe(404);
    expect((await get("/api/needs/not-a-uuid")).statusCode).toBe(404);
    expect((await get("/api/needs/00000000-0000-4000-8000-000000000000")).statusCode).toBe(404);
  });

  // ------------------------------------------------------------------ core functions (B uses these)
  it("core.listDonatableNeeds / getNextMostUrgentNeed", async () => {
    const list = await listDonatableNeeds({ orgId: id.harbor });
    expect(list.map((n) => n.title)).toEqual(["Winter hats", "Diapers, size 4", "Baby wipes"]);
    expect((await listDonatableNeeds({})).length).toBe(4); // + Dog food
    expect((await getNextMostUrgentNeed(id.harbor!, id.hats))?.title).toBe("Diapers, size 4");
  });

  it("core.setNeedEmbedding validates dimensions", async () => {
    await expect(setNeedEmbedding(id.diapers!, [1, 2, 3])).rejects.toThrow(/768/);
    await expect(setNeedEmbedding(id.diapers!, Array(768).fill(0.1))).resolves.toBeUndefined();
  });

  // ------------------------------------------------------------------ staff reads
  it("staff list requires a key, includes drafts, filters by status", async () => {
    expect((await get("/api/staff/needs")).statusCode).toBe(401);
    const all = StaffNeedListRes.parse((await get("/api/staff/needs", HARBOR_KEY)).json());
    expect(all.needs).toHaveLength(6);
    const drafts = StaffNeedListRes.parse((await get("/api/staff/needs?status=draft", HARBOR_KEY)).json());
    expect(drafts.needs.map((n) => n.title)).toEqual(["Draft item"]);
    expect((await get("/api/staff/needs?status=bogus", HARBOR_KEY)).statusCode).toBe(400);
  });

  it("staff detail: own need with purchases; another org's need is 404", async () => {
    const res = await get(`/api/staff/needs/${id.formula}`, HARBOR_KEY);
    expect(res.statusCode).toBe(200);
    const detail = StaffNeedDetailRes.parse(res.json());
    expect(detail.purchases).toHaveLength(1);
    expect(detail.purchases[0]!.status).toBe("approved");
    expect((await get(`/api/staff/needs/${id.dogFood}`, HARBOR_KEY)).statusCode).toBe(404);
  });

  // ------------------------------------------------------------------ publish
  it("POST /api/staff/needs computes the target (2 × $38.49 → $84) and opens it", async () => {
    const res = await send("POST", "/api/staff/needs", {
      title: "Diapers, size 5",
      category: "baby",
      urgency: 3,
      quantity: 2,
      unit: "pack of 150",
      product: product(3849),
    });
    expect(res.statusCode).toBe(201);
    const { need } = NeedRes.parse(res.json());
    expect(need).toMatchObject({ status: "open", targetCents: 8400, fundedCents: 0, remainingCents: 8400 });
    id.created = need.id;
  });

  it("POST publish:false saves a hidden draft; invalid body → 400", async () => {
    const res = await send("POST", "/api/staff/needs", {
      title: "Crib sheets",
      category: "bedding",
      urgency: 2,
      quantity: 1,
      unit: "sheet",
      product: product(1299),
      publish: false,
    });
    const { need } = NeedRes.parse(res.json());
    expect(need.status).toBe("draft");
    id.newDraft = need.id;
    expect((await get(`/api/needs/${need.id}`)).statusCode).toBe(404);

    const bad = await send("POST", "/api/staff/needs", { title: "x", category: "toys" });
    expect(bad.statusCode).toBe(400);
    expect(ApiError.parse(bad.json()).error.code).toBe("VALIDATION");
  });

  // ------------------------------------------------------------------ edit rules
  const patch = (needId: string, body: unknown, key = HARBOR_KEY) =>
    send("PATCH", `/api/staff/needs/${needId}`, body, key);
  const code = (res: Awaited<ReturnType<typeof patch>>) => ApiError.parse(res.json()).error.code;

  it("publishes a draft and broadcasts the update", async () => {
    const seen: NeedCard[] = [];
    const off = onNeedUpdated("harbor-food-bank", (c) => seen.push(c));
    const res = await patch(id.newDraft!, { status: "open" });
    off();
    expect(res.statusCode).toBe(200);
    expect(NeedRes.parse(res.json()).need.status).toBe("open");
    expect(seen.map((c) => c.id)).toEqual([id.newDraft]);
  });

  it("quantity change with no money recomputes the target; with money → 409", async () => {
    const ok = await patch(id.created!, { quantity: 3 });
    expect(NeedRes.parse(ok.json()).need.targetCents).toBe(12_500); // 3 × 38.49 = 115.47 → +8% 124.71 → $125
    const blocked = await patch(id.diapers!, { quantity: 3 });
    expect(blocked.statusCode).toBe(409);
    expect(code(blocked)).toBe("INVALID_STATE");
  });

  it("target can't go below funded + held, or below $1", async () => {
    const low = await patch(id.diapers!, { targetCents: 7000 }); // funded 7000 + held 400
    expect(low.statusCode).toBe(409);
    expect(ApiError.parse(low.json()).error.details).toEqual({ minTargetCents: 7400 });
    expect((await patch(id.created!, { targetCents: 50 })).statusCode).toBe(400);
    const ok = await patch(id.diapers!, { targetCents: 9000 });
    expect(NeedRes.parse(ok.json()).need).toMatchObject({ targetCents: 9000, status: "open", remainingCents: 1600 });
  });

  it("raising a funded target reopens it; lowering back re-funds it", async () => {
    const up = NeedRes.parse((await patch(id.formula!, { targetCents: 4000 })).json()).need;
    expect(up).toMatchObject({ status: "open", remainingCents: 1000 });
    const down = NeedRes.parse((await patch(id.formula!, { targetCents: 3000 })).json()).need;
    expect(down).toMatchObject({ status: "funded", remainingCents: 0 });
  });

  it("closing: allowed without money, refused with money", async () => {
    const blocked = await patch(id.diapers!, { status: "closed" });
    expect(blocked.statusCode).toBe(409);
    const ok = await patch(id.wipes!, { status: "closed" });
    expect(NeedRes.parse(ok.json()).need.status).toBe("closed");
  });

  it("closed needs can't be edited; other orgs' needs are 404; bad input → 400", async () => {
    expect((await patch(id.closed!, { title: "New title" })).statusCode).toBe(409);
    expect((await patch(id.dogFood!, { title: "Hijack" })).statusCode).toBe(404);
    expect((await patch(id.created!, { urgency: 9 })).statusCode).toBe(400);
    expect((await patch("not-a-uuid", { title: "x y" })).statusCode).toBe(404);
  });
});

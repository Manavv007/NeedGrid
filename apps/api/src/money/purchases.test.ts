/**
 * Purchases against a real Postgres (TEST_DATABASE_URL): propose → approve (exact / surplus / gap) → ordered.
 * Money rule 7. Invariants are checked after every test.
 */
import {
  ApiError,
  ApprovePurchaseRes,
  CaptureRes,
  CreateOrderRes,
  PurchaseRes,
  StaffNeedDetailRes,
  type PurchaseOffer,
} from "@needgrid/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createProposedPurchase } from "../core";
import { getNeedCard } from "../core/needs";
import { closeDb } from "../db/client";
import { allocations, needs, purchases } from "../db/schema";
import { FakePayPalOrders } from "../paypal/__fakes__";
import { realOrdersGateway, setOrdersGateway } from "../paypal/orders";
import { createTestDb, hasTestDb, migrateTestDb, truncateAll, type TestDb } from "../test/db";
import { demoProduct, nextIp, seedNeed, seedOrg } from "../test/fixtures";
import { assertMoneyInvariants } from "./invariants";

const KEY = "harbor-demo-2026";
const offer = (unitPriceCents: number, channel3Id = "p-3849"): PurchaseOffer => ({
  channel3Id,
  title: "Pampers Cruisers Size 4, 150 ct",
  retailer: "target.com",
  url: "https://www.target.com/p/123",
  imageUrl: null,
  unitPriceCents,
  inStock: true,
});

describe.skipIf(!hasTestDb)("purchases", () => {
  let t: TestDb;
  let app: FastifyInstance;
  let paypal: FakePayPalOrders;
  let orgId: string;

  /** Diapers: 2 × $38.49 → target $84, fully funded by one seed donation. */
  const fundedDiapers = () =>
    seedNeed(t, orgId, {
      title: "Diapers, size 4",
      quantity: 2,
      unit: "pack of 150",
      targetCents: 8400,
      fundedCents: 8400,
      status: "funded",
      urgency: 3,
      product: demoProduct(3849),
    });
  const propose = (needId: string, unitPriceCents: number) =>
    createProposedPurchase({ needId, offer: offer(unitPriceCents), explanation: "test", flags: [] });
  const post = (url: string, payload: unknown = {}, key = KEY) =>
    app.inject({ method: "POST", url, payload: payload as object, headers: { "x-staff-key": key } });
  const approve = (id: string, key = KEY) => post(`/api/staff/purchases/${id}/approve`, {}, key);
  const ordered = (id: string, orderRef = "AMZ-113-4429817") =>
    post(`/api/staff/purchases/${id}/ordered`, { orderRef });
  const code = (res: { json(): unknown }) => ApiError.parse(res.json()).error.code;

  beforeAll(async () => {
    t = createTestDb();
    await migrateTestDb(t);
    app = await buildApp({ logger: false });
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAll(t);
    orgId = (await seedOrg(t, "harbor-food-bank", KEY)).id;
    paypal = new FakePayPalOrders();
    setOrdersGateway(paypal);
  });

  afterEach(async () => {
    await assertMoneyInvariants(t.db);
  });

  afterAll(async () => {
    setOrdersGateway(realOrdersGateway);
    await app?.close();
    await t?.pool.end();
    await closeDb();
  });

  // ------------------------------------------------------------------ propose
  it("propose: server computes the new target, returns a plan, supersedes the older proposal", async () => {
    const need = await fundedDiapers();
    const first = await propose(need.id, 3849);
    expect(first).toMatchObject({
      status: "proposed",
      newTargetCents: 8400,
      plan: { priceChange: "same", money: { kind: "exact" } },
    });

    const second = await propose(need.id, 3600); // 2 × 36.00 = 72.00 → +8% 77.76 → $78
    expect(second).toMatchObject({
      newTargetCents: 7800,
      plan: { priceChange: "cheaper", money: { kind: "surplus", cents: 600, nextNeed: null } },
    });
    const [old] = await t.db.select().from(purchases).where(eq(purchases.id, first.id));
    expect(old!.status).toBe("superseded");
  });

  it("propose: refused unless the need is funded", async () => {
    const open = await seedNeed(t, orgId, { title: "Wipes", targetCents: 3000 });
    await expect(propose(open.id, 1000)).rejects.toMatchObject({ status: 409, code: "INVALID_STATE" });
  });

  it("staff need detail carries the plan of a proposed purchase (reload shows surplus without browser maths)", async () => {
    const need = await fundedDiapers();
    const next = await seedNeed(t, orgId, { title: "Winter hats", targetCents: 5000, urgency: 3 });
    await propose(need.id, 3600);
    const res = await app.inject({
      method: "GET",
      url: `/api/staff/needs/${need.id}`,
      headers: { "x-staff-key": KEY },
    });
    expect(res.statusCode, res.body).toBe(200);
    const detail = StaffNeedDetailRes.parse(res.json());
    expect(detail.purchases[0]!.plan).toMatchObject({
      priceChange: "cheaper",
      money: { kind: "surplus", cents: 600, nextNeed: { id: next.id } },
    });
    expect(detail.need.deliveryPhotoUrl).toBeNull();
  });

  // ------------------------------------------------------------------ approve
  it("exact: approve keeps the need funded; then mark ordered", async () => {
    const need = await fundedDiapers();
    const p = await propose(need.id, 3849);
    const res = await approve(p.id);
    expect(res.statusCode).toBe(200);
    const body = ApprovePurchaseRes.parse(res.json());
    expect(body).toMatchObject({
      surplusMoved: null,
      gapCents: null,
      purchase: { status: "approved" },
      need: { status: "funded" },
    });

    const o = await ordered(p.id);
    expect(o.statusCode).toBe(200);
    const done = PurchaseRes.parse(o.json());
    expect(done.purchase).toMatchObject({ status: "ordered", orderRef: "AMZ-113-4429817" });
    expect(done.need.status).toBe("ordered");
    expect((await approve(p.id)).statusCode).toBe(409);
  });

  it("cheaper: the surplus moves to the most urgent open needs with paired −/+ rows", async () => {
    const need = await fundedDiapers();
    const hats = await seedNeed(t, orgId, { title: "Winter hats", targetCents: 400, urgency: 3 });
    const socks = await seedNeed(t, orgId, { title: "Socks", targetCents: 5000, urgency: 1 });
    const p = await propose(need.id, 3600);
    const body = ApprovePurchaseRes.parse((await approve(p.id)).json());

    expect(body.need).toMatchObject({ status: "funded", targetCents: 7800, fundedCents: 7800 });
    expect(body.need.product).toMatchObject({ unitPriceCents: 3600, retailer: "target.com", packSize: 150 });
    expect(body.surplusMoved).toEqual({
      toNeedId: hats.id,
      toNeedTitle: "Winter hats",
      amountCents: 600,
      moves: [
        { needId: hats.id, needTitle: "Winter hats", amountCents: 400 },
        { needId: socks.id, needTitle: "Socks", amountCents: 200 },
      ],
    });
    expect((await getNeedCard(hats.id))!).toMatchObject({ status: "funded", fundedCents: 400 });
    expect((await getNeedCard(socks.id))!.fundedCents).toBe(200);

    const rows = await t.db.select().from(allocations).where(eq(allocations.reason, "price_drop"));
    const out = rows.filter((r) => r.amountCents < 0);
    expect(out).toHaveLength(1);
    expect(out[0]!.amountCents).toBe(-600);
    for (const r of rows.filter((r) => r.amountCents > 0)) expect(r.relatedAllocationId).toBe(out[0]!.id);
  });

  it("cheaper with nowhere to go: the surplus stays on the need, surplusMoved is null", async () => {
    const need = await fundedDiapers();
    const p = await propose(need.id, 3600);
    const body = ApprovePurchaseRes.parse((await approve(p.id)).json());
    expect(body.surplusMoved).toBeNull();
    expect(body.need).toMatchObject({ status: "funded", targetCents: 7800, fundedCents: 8400 });
  });

  it("pricier: the need goes to topping_up; donors cover the gap; then it can be ordered", async () => {
    const need = await fundedDiapers();
    const p = await propose(need.id, 4100); // 2 × 41.00 = 82.00 → +8% 88.56 → $89
    const body = ApprovePurchaseRes.parse((await approve(p.id)).json());
    expect(body).toMatchObject({
      gapCents: 500,
      surplusMoved: null,
      need: { status: "topping_up", targetCents: 8900, remainingCents: 500 },
    });

    const early = await ordered(p.id);
    expect(early.statusCode).toBe(409);
    expect(ApiError.parse(early.json()).error.message).toContain("$5.00");

    const order = CreateOrderRes.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/donations/orders",
          payload: { needId: need.id, amountCents: 2500 },
          headers: { "x-forwarded-for": nextIp() },
        })
      ).json(),
    );
    expect(order).toMatchObject({ amountCents: 500, wasClamped: true });
    paypal.approve(order.orderId);
    const cap = await app.inject({
      method: "POST",
      url: `/api/donations/orders/${order.orderId}/capture`,
      payload: {},
    });
    CaptureRes.parse(cap.json());
    expect((await getNeedCard(need.id))!.status).toBe("funded");

    expect((await ordered(p.id)).statusCode).toBe(200);
  });

  it("only one approved purchase per need; a new plan after approval is refused", async () => {
    const need = await fundedDiapers();
    const a = await propose(need.id, 3849);
    expect((await approve(a.id)).statusCode).toBe(200);
    await expect(propose(need.id, 3700)).rejects.toMatchObject({ status: 409 });
    const approvedRows = await t.db
      .select()
      .from(purchases)
      .where(and(eq(purchases.needId, need.id), eq(purchases.status, "approved")));
    expect(approvedRows).toHaveLength(1);
  });

  it("ordered before approval → 409; bad body → 400; other org's purchase → 404; bad id → 404", async () => {
    const need = await fundedDiapers();
    const p = await propose(need.id, 3849);
    expect(code(await ordered(p.id))).toBe("INVALID_STATE");
    expect((await post(`/api/staff/purchases/${p.id}/ordered`, { orderRef: "" })).statusCode).toBe(400);

    await seedOrg(t, "second-chance-paws", "paws-demo-2026");
    expect((await approve(p.id, "paws-demo-2026")).statusCode).toBe(404);
    expect((await approve("not-a-uuid")).statusCode).toBe(404);
    expect((await approve(p.id, "wrong-key")).statusCode).toBe(401);
    const [n] = await t.db.select().from(needs).where(eq(needs.id, need.id));
    expect(n!.status).toBe("funded");
  });
});

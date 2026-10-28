/**
 * Capture + impact against a real Postgres (TEST_DATABASE_URL) with a fake PayPal.
 * Money rules 4 (one transaction), 5 (no double counting) and 6 (overflow).
 */
import { ApiError, CaptureRes, CreateOrderRes, ImpactRes } from "@needgrid/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { getNeedCard } from "../core/needs";
import { closeDb } from "../db/client";
import { agentActions, allocations, donations, reservations } from "../db/schema";
import { FakePayPalOrders } from "../paypal/__fakes__";
import { realOrdersGateway, setOrdersGateway } from "../paypal/orders";
import { createTestDb, hasTestDb, migrateTestDb, truncateAll, type TestDb } from "../test/db";
import { nextIp, seedNeed, seedOrg } from "../test/fixtures";
import { recordCapture } from "./capture";
import { assertMoneyInvariants } from "./invariants";

describe.skipIf(!hasTestDb)("capture donation order", () => {
  let t: TestDb;
  let app: FastifyInstance;
  let paypal: FakePayPalOrders;
  let orgId: string;

  const createOrder = async (needId: string, amountCents: number, rollOverConsent = true) => {
    const res = await app.inject({
      method: "POST",
      url: "/api/donations/orders",
      payload: { needId, amountCents, rollOverConsent },
      headers: { "x-forwarded-for": nextIp() },
    });
    expect(res.statusCode).toBe(201);
    return CreateOrderRes.parse(res.json());
  };
  const capture = (orderId: string) =>
    app.inject({ method: "POST", url: `/api/donations/orders/${orderId}/capture`, payload: {} });
  /** Donor approves in the PayPal popup, then the page calls capture. */
  const payAndCapture = async (needId: string, amountCents: number, rollOverConsent = true) => {
    const order = await createOrder(needId, amountCents, rollOverConsent);
    paypal.approve(order.orderId, { givenName: "Jamie Rivera", email: "jamie@example.com" });
    const res = await capture(order.orderId);
    expect(res.statusCode).toBe(200);
    return { order, result: CaptureRes.parse(res.json()) };
  };
  /** Simulate the donor's 15-minute hold running out. */
  const expireHold = (orderId: string) =>
    t.db
      .update(reservations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(reservations.paypalOrderId, orderId));

  beforeAll(async () => {
    t = createTestDb();
    await migrateTestDb(t);
    app = await buildApp({ logger: false });
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAll(t);
    orgId = (await seedOrg(t)).id;
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

  it("funding exactly the rest marks the tile funded, in one transaction", async () => {
    const need = await seedNeed(t, orgId, { title: "Diapers, size 4", targetCents: 8400, fundedCents: 7000 });
    const { order, result } = await payAndCapture(need.id, 1400);
    expect(result).toMatchObject({
      amountCents: 1400,
      allocations: [{ needId: need.id, needTitle: "Diapers, size 4", amountCents: 1400, reason: "direct" }],
    });
    expect(result.impactToken).toMatch(/^[A-Za-z0-9_-]{22}$/);

    expect((await getNeedCard(need.id))!).toMatchObject({
      status: "funded",
      fundedCents: 8400,
      heldCents: 0,
      remainingCents: 0,
      donorCount: 2,
    });
    const [res] = await t.db.select().from(reservations).where(eq(reservations.paypalOrderId, order.orderId));
    expect(res!.status).toBe("converted");
    const [don] = await t.db.select().from(donations).where(eq(donations.id, result.donationId));
    expect(don).toMatchObject({
      source: "order",
      donorName: "Jamie Rivera",
      captureId: expect.stringMatching(/^FAKECAPTURE/),
    });
  });

  it("a partial gift leaves the tile open", async () => {
    const need = await seedNeed(t, orgId, { title: "Wipes", targetCents: 3000 });
    await payAndCapture(need.id, 1000);
    expect((await getNeedCard(need.id))!).toMatchObject({ status: "open", fundedCents: 1000, remainingCents: 2000 });
  });

  it("capture before the donor approves → 409, nothing recorded", async () => {
    const need = await seedNeed(t, orgId, { title: "Wipes", targetCents: 3000 });
    const order = await createOrder(need.id, 1000);
    const res = await capture(order.orderId);
    expect(res.statusCode).toBe(409);
    expect(ApiError.parse(res.json()).error).toMatchObject({
      code: "INVALID_STATE",
      details: { paypalIssue: "ORDER_NOT_APPROVED" },
    });
    expect(await t.db.select().from(donations)).toHaveLength(0);
  });

  it("a declined capture → 409, nothing recorded", async () => {
    const need = await seedNeed(t, orgId, { title: "Wipes", targetCents: 3000 });
    const order = await createOrder(need.id, 1000);
    paypal.approve(order.orderId);
    paypal.captureStatus = "DECLINED";
    const res = await capture(order.orderId);
    expect(res.statusCode).toBe(409);
    expect(ApiError.parse(res.json()).error.details).toEqual({ paypalIssue: "CAPTURE_DECLINED" });
    expect(await t.db.select().from(donations)).toHaveLength(0);
  });

  it("refreshing during capture still records exactly one donation (sequential + concurrent)", async () => {
    const need = await seedNeed(t, orgId, { title: "Formula", targetCents: 5000 });
    const { order, result } = await payAndCapture(need.id, 2000);
    const again = CaptureRes.parse((await capture(order.orderId)).json());
    expect(again).toEqual(result);
    expect(paypal.captureCalls).toBe(1); // second call answered from our records

    const order2 = await createOrder(need.id, 1000);
    paypal.approve(order2.orderId);
    const results = await Promise.all([capture(order2.orderId), capture(order2.orderId), capture(order2.orderId)]);
    const ids = new Set(results.map((r) => CaptureRes.parse(r.json()).donationId));
    expect(ids.size).toBe(1);
    expect(await t.db.select().from(donations)).toHaveLength(2);
    expect((await getNeedCard(need.id))!.fundedCents).toBe(3000);
  });

  it("recordCapture twice for the same capture (route + webhook) counts once", async () => {
    const need = await seedNeed(t, orgId, { title: "Formula", targetCents: 5000 });
    const order = await createOrder(need.id, 2000);
    const [res] = await t.db.select().from(reservations).where(eq(reservations.paypalOrderId, order.orderId));
    const input = {
      reservationId: res!.id,
      orderId: order.orderId,
      captureId: "CAP-WEBHOOK-1",
      amountCents: 2000,
      donorName: null,
      donorEmail: null,
    };
    const [a, b] = await Promise.all([recordCapture(input), recordCapture(input)]);
    expect(a.donationId).toBe(b.donationId);
    expect((await getNeedCard(need.id))!.fundedCents).toBe(2000);
  });

  it("late payment after the hold expired and someone else funded it → overflow to the next urgent need", async () => {
    const tile = await seedNeed(t, orgId, { title: "Diapers", targetCents: 4000, urgency: 3 });
    const next = await seedNeed(t, orgId, { title: "Winter hats", targetCents: 3000, urgency: 3 });
    const later = await seedNeed(t, orgId, { title: "Socks", targetCents: 5000, urgency: 1 });

    const slow = await createOrder(tile.id, 4000); // donor A holds $40, then wanders off
    await expireHold(slow.orderId);
    await payAndCapture(tile.id, 4000); // donor B funds the whole tile
    paypal.approve(slow.orderId);
    const late = CaptureRes.parse((await capture(slow.orderId)).json()); // donor A finally pays

    expect(late.allocations).toEqual([
      { needId: next.id, needTitle: "Winter hats", amountCents: 3000, reason: "overflow" },
      { needId: later.id, needTitle: "Socks", amountCents: 1000, reason: "overflow" },
    ]);
    expect((await getNeedCard(tile.id))!).toMatchObject({ status: "funded", fundedCents: 4000 }); // never over target
    expect((await getNeedCard(next.id))!).toMatchObject({ status: "funded", fundedCents: 3000 });
    expect((await getNeedCard(later.id))!.fundedCents).toBe(1000);
  });

  it("overflow never takes money another donor is holding", async () => {
    const tile = await seedNeed(t, orgId, { title: "Diapers", targetCents: 2000, urgency: 3 });
    const next = await seedNeed(t, orgId, { title: "Hats", targetCents: 3000, urgency: 2 });
    const slow = await createOrder(tile.id, 2000);
    await expireHold(slow.orderId);
    await payAndCapture(tile.id, 2000);
    await createOrder(next.id, 2500); // donor C is mid-checkout on Hats ($5 room left)
    paypal.approve(slow.orderId);
    const late = CaptureRes.parse((await capture(slow.orderId)).json());
    expect(late.allocations).toEqual([{ needId: next.id, needTitle: "Hats", amountCents: 500, reason: "overflow" }]);
    const [don] = await t.db.select().from(donations).where(eq(donations.id, late.donationId));
    expect(don!.unallocatedCents).toBe(1500); // nowhere left → refund proposal
  });

  it("no roll-over consent → money is set aside and a refund is PROPOSED (nothing sent to PayPal)", async () => {
    const tile = await seedNeed(t, orgId, { title: "Diapers", targetCents: 2000 });
    await seedNeed(t, orgId, { title: "Hats", targetCents: 3000 });
    const slow = await createOrder(tile.id, 2000, false);
    await expireHold(slow.orderId);
    await payAndCapture(tile.id, 2000);
    paypal.approve(slow.orderId);
    const late = CaptureRes.parse((await capture(slow.orderId)).json());

    expect(late.allocations).toEqual([]);
    const [don] = await t.db.select().from(donations).where(eq(donations.id, late.donationId));
    expect(don!.unallocatedCents).toBe(2000);
    const actions = await t.db.select().from(agentActions);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      tool: "create_refund",
      status: "proposed",
      origin: "system",
      args: { donationId: late.donationId },
      computed: { refundCents: 2000 },
    });
  });

  it("unknown or malformed order ids → 404 without calling PayPal", async () => {
    expect((await capture("ZZZZZZZZZZZZZZZZZ")).statusCode).toBe(404);
    expect((await capture("bad-id!")).statusCode).toBe(404);
    expect(paypal.captureCalls).toBe(0);
  });

  it("impact page: the donor's items with first name only, no email", async () => {
    const need = await seedNeed(t, orgId, { title: "Diapers, size 4", targetCents: 3000 });
    const { result } = await payAndCapture(need.id, 3000);
    const res = await app.inject({ method: "GET", url: `/api/impact/${result.impactToken}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("jamie@example.com");
    expect(res.body).not.toContain("Rivera");
    const impact = ImpactRes.parse(res.json());
    expect(impact).toMatchObject({ donorFirstName: "Jamie", totalCents: 3000 });
    expect(impact.items).toHaveLength(1);
    expect(impact.items[0]).toMatchObject({ amountCents: 3000, reason: "direct", orgName: "Org harbor-food-bank" });
    expect(impact.items[0]!.need.status).toBe("funded");
    expect(impact.items[0]!.timeline.map((e) => e.type)).toEqual(["created", "donation", "funded"]);

    expect((await app.inject({ method: "GET", url: "/api/impact/doesnotexistdoesnotexist" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/impact/x" })).statusCode).toBe(404);
  });

  it("allocations are the single record: funded_cents always equals their sum", async () => {
    const need = await seedNeed(t, orgId, { title: "Formula", targetCents: 6000 });
    for (const cents of [1000, 2500, 2500]) await payAndCapture(need.id, cents);
    const rows = await t.db.select().from(allocations).where(eq(allocations.needId, need.id));
    expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(6000);
    expect((await getNeedCard(need.id))!).toMatchObject({ fundedCents: 6000, status: "funded", donorCount: 3 });
  });
});

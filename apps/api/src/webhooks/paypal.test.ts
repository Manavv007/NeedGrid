/**
 * PayPal webhooks + hold release against a real Postgres (TEST_DATABASE_URL),
 * with a fake PayPal and a fake signature verifier.
 */
import { ApiError, CaptureRes, centsToPayPalValue, CreateOrderRes, type NeedCard } from "@needgrid/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { getNeedCard } from "../core/needs";
import { closeDb } from "../db/client";
import { donations, reservations, webhookEvents } from "../db/schema";
import { releaseExpiredHolds } from "../jobs/releaseHolds";
import { onNeedUpdated } from "../lib/events";
import { assertMoneyInvariants } from "../money/invariants";
import { FakePayPalOrders } from "../paypal/__fakes__";
import { realOrdersGateway, setOrdersGateway } from "../paypal/orders";
import { realWebhookVerifier, setWebhookVerifier, type WebhookVerifier } from "../paypal/webhooks";
import { createTestDb, hasTestDb, migrateTestDb, truncateAll, type TestDb } from "../test/db";
import { nextIp, seedNeed, seedOrg } from "../test/fixtures";

const SIGNED_HEADERS = {
  "content-type": "application/json",
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-test",
  "paypal-transmission-id": "tx-1",
  "paypal-transmission-sig": "sig",
  "paypal-transmission-time": "2026-10-28T10:00:00Z",
};

describe.skipIf(!hasTestDb)("PayPal webhooks", () => {
  let t: TestDb;
  let app: FastifyInstance;
  let paypal: FakePayPalOrders;
  let orgId: string;
  let accept: boolean;
  let verifyCalls: number;
  let seq = 0;

  const fakeVerifier: WebhookVerifier = {
    async verify() {
      verifyCalls++;
      return accept;
    },
  };

  const createOrder = async (needId: string, amountCents: number) => {
    const res = await app.inject({
      method: "POST",
      url: "/api/donations/orders",
      payload: { needId, amountCents },
      headers: { "x-forwarded-for": nextIp() },
    });
    expect(res.statusCode).toBe(201);
    return CreateOrderRes.parse(res.json());
  };
  const captureRoute = (orderId: string) =>
    app.inject({ method: "POST", url: `/api/donations/orders/${orderId}/capture`, payload: {} });
  const captureEvent = (orderId: string, captureId: string, cents: number, eventId = `WH-EVT-${++seq}`) => ({
    id: eventId,
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: captureId,
      status: "COMPLETED",
      amount: { currency_code: "USD", value: centsToPayPalValue(cents) },
      supplementary_data: { related_ids: { order_id: orderId } },
    },
  });
  const deliver = (event: unknown, headers: Record<string, string> = SIGNED_HEADERS) =>
    app.inject({
      method: "POST",
      url: "/api/webhooks/paypal",
      payload: typeof event === "string" ? event : JSON.stringify(event),
      headers,
    });

  beforeAll(async () => {
    t = createTestDb();
    await migrateTestDb(t);
    setWebhookVerifier(fakeVerifier);
    app = await buildApp({ logger: false });
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAll(t);
    orgId = (await seedOrg(t)).id;
    paypal = new FakePayPalOrders();
    setOrdersGateway(paypal);
    accept = true;
    verifyCalls = 0;
  });

  afterEach(async () => {
    await assertMoneyInvariants(t.db);
  });

  afterAll(async () => {
    setOrdersGateway(realOrdersGateway);
    setWebhookVerifier(realWebhookVerifier);
    await app?.close();
    await t?.pool.end();
    await closeDb();
  });

  it("donor closed the page before capture: the webhook records the donation", async () => {
    const need = await seedNeed(t, orgId, { title: "Diapers, size 4", targetCents: 8400, fundedCents: 7000 });
    const order = await createOrder(need.id, 1400);
    const res = await deliver(captureEvent(order.orderId, "WHCAP0001", 1400));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    expect((await getNeedCard(need.id))!).toMatchObject({ status: "funded", fundedCents: 8400, heldCents: 0 });
    const [don] = await t.db.select().from(donations).where(eq(donations.paypalOrderId, order.orderId));
    expect(don).toMatchObject({ captureId: "WHCAP0001", amountCents: 1400, source: "order" });
    const [evt] = await t.db.select().from(webhookEvents);
    expect(evt).toMatchObject({ verified: true, type: "PAYMENT.CAPTURE.COMPLETED", error: null });
    expect(evt!.processedAt).not.toBeNull();
  });

  it("then the page's capture call returns the same donation without calling PayPal again", async () => {
    const need = await seedNeed(t, orgId, { title: "Wipes", targetCents: 3000 });
    const order = await createOrder(need.id, 1000);
    paypal.approve(order.orderId);
    await deliver(captureEvent(order.orderId, "WHCAP0002", 1000));
    const res = await captureRoute(order.orderId);
    expect(res.statusCode).toBe(200);
    expect(CaptureRes.parse(res.json()).amountCents).toBe(1000);
    expect(paypal.captureCalls).toBe(0);
    expect(await t.db.select().from(donations)).toHaveLength(1);
  });

  it("capture call first, webhook after: counted once", async () => {
    const need = await seedNeed(t, orgId, { title: "Wipes", targetCents: 3000 });
    const order = await createOrder(need.id, 1000);
    paypal.approve(order.orderId);
    expect((await captureRoute(order.orderId)).statusCode).toBe(200);
    const captureId = paypal.orders.get(order.orderId)!.captured!.capture!.id;
    expect((await deliver(captureEvent(order.orderId, captureId, 1000))).statusCode).toBe(200);
    expect(await t.db.select().from(donations)).toHaveLength(1);
    expect((await getNeedCard(need.id))!.fundedCents).toBe(1000);
  });

  it("the same event delivered twice (or three times at once) is processed once", async () => {
    const need = await seedNeed(t, orgId, { title: "Formula", targetCents: 5000 });
    const order = await createOrder(need.id, 2000);
    const event = captureEvent(order.orderId, "WHCAP0003", 2000, "WH-DUP-1");
    const results = await Promise.all([deliver(event), deliver(event), deliver(event)]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    const again = await deliver(event);
    expect(again.json()).toEqual({ ok: true, duplicate: true });
    expect(await t.db.select().from(webhookEvents)).toHaveLength(1);
    expect(await t.db.select().from(donations)).toHaveLength(1);
    expect((await getNeedCard(need.id))!.fundedCents).toBe(2000);
  });

  it("bad signature → 400 and NOT stored (a forged event can't block the real one)", async () => {
    const need = await seedNeed(t, orgId, { title: "Formula", targetCents: 5000 });
    const order = await createOrder(need.id, 2000);
    const event = captureEvent(order.orderId, "WHCAP0004", 2000, "WH-FORGED-1");
    accept = false;
    const res = await deliver(event);
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).error.code).toBe("VALIDATION");
    expect(await t.db.select().from(webhookEvents)).toHaveLength(0);
    expect(await t.db.select().from(donations)).toHaveLength(0);

    accept = true; // the genuine event with the same id still goes through
    expect((await deliver(event)).statusCode).toBe(200);
    expect(await t.db.select().from(donations)).toHaveLength(1);
  });

  it("missing headers, bad JSON or a non-event body → 400 without asking PayPal", async () => {
    const event = captureEvent("ORDERX0001", "WHCAP0005", 100);
    const { "paypal-transmission-sig": _sig, ...noSig } = SIGNED_HEADERS;
    expect((await deliver(event, noSig)).statusCode).toBe(400);
    expect((await deliver("{not json")).statusCode).toBe(400);
    expect((await deliver({ hello: "world" })).statusCode).toBe(400);
    expect(verifyCalls).toBe(0);
  });

  it("captures that aren't our donation orders (e.g. invoice payments) are acknowledged and ignored", async () => {
    const res = await deliver(captureEvent("NOTOURORDER123", "WHCAP0006", 5000));
    expect(res.statusCode).toBe(200);
    expect(await t.db.select().from(donations)).toHaveLength(0);
    const [evt] = await t.db.select().from(webhookEvents);
    expect(evt!.processedAt).not.toBeNull();
  });

  it("other event types are acknowledged and stored", async () => {
    for (const type of ["PAYMENT.CAPTURE.REFUNDED", "INVOICING.INVOICE.PAID", "CHECKOUT.ORDER.APPROVED"]) {
      expect((await deliver({ id: `WH-${type}`, event_type: type, resource: {} })).statusCode).toBe(200);
    }
    expect(await t.db.select().from(webhookEvents)).toHaveLength(3);
  });

  it("a processing error returns 500 (PayPal retries) and records the error; a later retry succeeds", async () => {
    const need = await seedNeed(t, orgId, { title: "Formula", targetCents: 5000 });
    const order = await createOrder(need.id, 2000);
    const broken = captureEvent(order.orderId, "WHCAP0007", 2000, "WH-RETRY-1");
    broken.resource.amount.value = "20.001"; // not a valid money string
    const res = await deliver(broken);
    expect(res.statusCode).toBe(500);
    const [evt] = await t.db.select().from(webhookEvents);
    expect(evt).toMatchObject({ processedAt: null, error: expect.stringContaining("invalid money string") });

    const fixed = captureEvent(order.orderId, "WHCAP0007", 2000, "WH-RETRY-1");
    expect((await deliver(fixed)).statusCode).toBe(200);
    const [after] = await t.db.select().from(webhookEvents);
    expect(after).toMatchObject({ error: null });
    expect((await getNeedCard(need.id))!.fundedCents).toBe(2000);
  });

  it("a webhook after the hold expired and was released still records the money (overflow if needed)", async () => {
    const tile = await seedNeed(t, orgId, { title: "Diapers", targetCents: 2000, urgency: 3 });
    const next = await seedNeed(t, orgId, { title: "Hats", targetCents: 3000, urgency: 2 });
    const slow = await createOrder(tile.id, 2000);
    await t.db
      .update(reservations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(reservations.paypalOrderId, slow.orderId));
    expect(await releaseExpiredHolds()).toBe(1);
    const fast = await createOrder(tile.id, 2000); // someone else funds the tile meanwhile
    paypal.approve(fast.orderId);
    await captureRoute(fast.orderId);

    expect((await deliver(captureEvent(slow.orderId, "WHCAP0008", 2000))).statusCode).toBe(200);
    expect((await getNeedCard(tile.id))!).toMatchObject({ status: "funded", fundedCents: 2000 });
    expect((await getNeedCard(next.id))!.fundedCents).toBe(2000);
  });

  it("releaseExpiredHolds: only expired, active, non-sponsor holds; one update per need", async () => {
    const need = await seedNeed(t, orgId, { title: "Diapers", targetCents: 5000 });
    const now = Date.now();
    await t.db.insert(reservations).values([
      { needId: need.id, amountCents: 1000, expiresAt: new Date(now - 60_000) }, // expired → released
      { needId: need.id, amountCents: 700, expiresAt: new Date(now - 60_000) }, // expired → released
      { needId: need.id, amountCents: 500, expiresAt: new Date(now + 600_000) }, // still valid
      { needId: need.id, amountCents: 300, expiresAt: new Date(now - 60_000), status: "converted" }, // done
    ]);

    const seen: NeedCard[] = [];
    const off = onNeedUpdated("harbor-food-bank", (c) => seen.push(c));
    expect(await releaseExpiredHolds()).toBe(2);
    off();

    const rows = await t.db.select().from(reservations).where(eq(reservations.needId, need.id));
    expect(rows.map((r) => r.status).sort()).toEqual(["active", "converted", "released", "released"]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ heldCents: 500, remainingCents: 4500 });
    expect(await releaseExpiredHolds()).toBe(0);
  });
});

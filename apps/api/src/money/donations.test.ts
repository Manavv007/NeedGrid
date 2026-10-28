/**
 * POST /api/donations/orders against a real Postgres (TEST_DATABASE_URL) with a fake PayPal.
 * Money rule 3: amount = min(requested, target − funded − active holds), decided by the server.
 */
import { ApiError, CreateOrderRes, FullyFundedDetails, type NeedCard } from "@needgrid/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { getNeedCard } from "../core/needs";
import { closeDb } from "../db/client";
import { reservations } from "../db/schema";
import { onNeedUpdated } from "../lib/events";
import { FakePayPalOrders } from "../paypal/__fakes__";
import { realOrdersGateway, setOrdersGateway } from "../paypal/orders";
import { createTestDb, hasTestDb, migrateTestDb, truncateAll, type TestDb } from "../test/db";
import { nextIp, seedNeed, seedOrg } from "../test/fixtures";
import { assertMoneyInvariants } from "./invariants";

describe.skipIf(!hasTestDb)("create donation order (holds)", () => {
  let t: TestDb;
  let app: FastifyInstance;
  let paypal: FakePayPalOrders;
  let orgId: string;

  const donate = (needId: string, amountCents: number, ip = nextIp()) =>
    app.inject({
      method: "POST",
      url: "/api/donations/orders",
      payload: { needId, amountCents, rollOverConsent: true },
      headers: { "x-forwarded-for": ip },
    });
  const errorOf = (res: { json(): unknown }) => ApiError.parse(res.json()).error;

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

  afterAll(async () => {
    setOrdersGateway(realOrdersGateway);
    await app?.close();
    await t?.pool.end();
    await closeDb();
  });

  it("holds the requested amount when it fits, and the tile shows it on hold", async () => {
    const need = await seedNeed(t, orgId, { title: "Diapers, size 4", targetCents: 8400, fundedCents: 0 });
    const res = await donate(need.id, 2500);
    expect(res.statusCode).toBe(201);
    const order = CreateOrderRes.parse(res.json());
    expect(order).toMatchObject({ amountCents: 2500, wasClamped: false });
    expect(order.orderId).toMatch(/^FAKEORDER/);
    expect(new Date(order.holdExpiresAt).getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);

    const card = (await getNeedCard(need.id))!;
    expect(card).toMatchObject({ heldCents: 2500, remainingCents: 5900 });
    const [hold] = await t.db.select().from(reservations).where(eq(reservations.needId, need.id));
    expect(hold).toMatchObject({ status: "active", paypalOrderId: order.orderId, amountCents: 2500 });
    expect(paypal.orders.get(order.orderId)!.input).toMatchObject({ amountCents: 2500, needId: need.id });
  });

  it("clamps a request above what's left (money rule 1: the server sets the amount)", async () => {
    const need = await seedNeed(t, orgId, { title: "Diapers", targetCents: 8400, fundedCents: 7000 });
    const order = CreateOrderRes.parse((await donate(need.id, 5000)).json());
    expect(order).toMatchObject({ amountCents: 1400, wasClamped: true });
    expect(paypal.orders.get(order.orderId)!.input.amountCents).toBe(1400);
  });

  it("counts other donors' active holds, ignores expired and released ones", async () => {
    const need = await seedNeed(t, orgId, { title: "Diapers", targetCents: 5000 });
    const now = Date.now();
    await t.db.insert(reservations).values([
      { needId: need.id, amountCents: 1000, expiresAt: new Date(now + 600_000) }, // counts
      { needId: need.id, amountCents: 2000, expiresAt: new Date(now - 1_000) }, // expired
      { needId: need.id, amountCents: 1500, expiresAt: new Date(now + 600_000), status: "released" },
    ]);
    const order = CreateOrderRes.parse((await donate(need.id, 10_000)).json());
    expect(order).toMatchObject({ amountCents: 4000, wasClamped: true });
  });

  it("FULLY_FUNDED with the next most urgent need when nothing is left", async () => {
    const full = await seedNeed(t, orgId, { title: "Formula", targetCents: 3000, fundedCents: 3000, status: "funded" });
    const held = await seedNeed(t, orgId, { title: "Wipes", targetCents: 2000 });
    await t.db
      .insert(reservations)
      .values({ needId: held.id, amountCents: 2000, expiresAt: new Date(Date.now() + 600_000) });
    const next = await seedNeed(t, orgId, { title: "Winter hats", targetCents: 5000, urgency: 3 });

    for (const needId of [full.id, held.id]) {
      const res = await donate(needId, 1000);
      expect(res.statusCode).toBe(409);
      const err = errorOf(res);
      expect(err.code).toBe("FULLY_FUNDED");
      expect(FullyFundedDetails.parse(err.details).nextNeed?.id).toBe(next.id);
    }
    expect(paypal.createCalls).toBe(0);
  });

  it("drafts and unknown needs are 404; bad amounts are 400", async () => {
    const draft = await seedNeed(t, orgId, { title: "Draft", targetCents: 3000, status: "draft" });
    expect((await donate(draft.id, 1000)).statusCode).toBe(404);
    expect((await donate("00000000-0000-4000-8000-000000000000", 1000)).statusCode).toBe(404);
    const open = await seedNeed(t, orgId, { title: "Open", targetCents: 3000 });
    for (const bad of [50, 10.5, -100, 100_001]) {
      const res = await donate(open.id, bad);
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).code).toBe("VALIDATION");
    }
  });

  it("releases the hold if PayPal fails (502), so the money room comes back", async () => {
    const need = await seedNeed(t, orgId, { title: "Diapers", targetCents: 3000 });
    paypal.failNextCreate = true;
    const res = await donate(need.id, 3000);
    expect(res.statusCode).toBe(502);
    expect(errorOf(res)).toMatchObject({ code: "UPSTREAM", details: { paypalDebugId: "fake-debug-id" } });
    expect((await getNeedCard(need.id))!).toMatchObject({ heldCents: 0, remainingCents: 3000 });
    const [hold] = await t.db.select().from(reservations).where(eq(reservations.needId, need.id));
    expect(hold!.status).toBe("released");
  });

  it("20 donors racing for the last $40 never hold more than $40", async () => {
    const need = await seedNeed(t, orgId, { title: "Last $40", targetCents: 10_000, fundedCents: 6000 });
    const results = await Promise.all(Array.from({ length: 20 }, () => donate(need.id, 1000)));
    const ok = results.filter((r) => r.statusCode === 201).map((r) => CreateOrderRes.parse(r.json()));
    const full = results.filter((r) => r.statusCode === 409);
    const other = results.filter((r) => r.statusCode !== 201 && r.statusCode !== 409);
    expect(other.map((r) => `${r.statusCode} ${r.body}`)).toEqual([]);
    expect(ok).toHaveLength(4);
    expect(full).toHaveLength(16);
    expect(ok.reduce((s, o) => s + o.amountCents, 0)).toBe(4000);
    expect((await getNeedCard(need.id))!).toMatchObject({ heldCents: 4000, remainingCents: 0 });
    await assertMoneyInvariants(t.db);
  });

  it("broadcasts the new hold to open tile walls", async () => {
    const need = await seedNeed(t, orgId, { title: "Diapers", targetCents: 3000 });
    const seen: NeedCard[] = [];
    const off = onNeedUpdated("harbor-food-bank", (c) => seen.push(c));
    await donate(need.id, 1000);
    off();
    expect(seen.at(-1)).toMatchObject({ id: need.id, heldCents: 1000, remainingCents: 2000 });
  });

  it("is rate-limited per IP (20 per minute)", async () => {
    const ip = "203.0.113.7";
    const unknown = "00000000-0000-4000-8000-000000000000";
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) codes.push((await donate(unknown, 1000, ip)).statusCode);
    expect(codes.slice(0, 20).every((c) => c === 404)).toBe(true);
    expect(codes[20]).toBe(429);
  });
});

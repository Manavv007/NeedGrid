/**
 * Sponsor invoices end to end against a real Postgres (TEST_DATABASE_URL), with fake PayPal gateways:
 * propose → approve (holds + PayPal create/send/QR) → the sponsor pays → INVOICING.INVOICE.PAID webhook
 * → every tile on the invoice is funded with reason `sponsor`. Counted once, however often PayPal tells us.
 */
import { ApiError, CreateInvoiceResult, SponsorInvoiceListRes } from "@needgrid/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { proposeAction } from "../core";
import { getNeedCard } from "../core/needs";
import { closeDb } from "../db/client";
import { allocations, donations, needs, reservations, sponsorInvoices } from "../db/schema";
import { approveAction } from "../agent/executors";
import { FakePayPalInvoices } from "../paypal/__fakes__";
import { realInvoicesGateway, setInvoicesGateway } from "../paypal/invoices";
import { realWebhookVerifier, setWebhookVerifier } from "../paypal/webhooks";
import { createTestDb, hasTestDb, migrateTestDb, truncateAll, type TestDb } from "../test/db";
import { nextIp, seedNeed, seedOrg } from "../test/fixtures";
import { recordInvoicePaid } from "./invoices";
import { assertMoneyInvariants } from "./invariants";

const KEY = "harbor-demo-2026";
const OTHER_KEY = "paws-demo-2026";
const SIGNED_HEADERS = {
  "content-type": "application/json",
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-test",
  "paypal-transmission-id": "tx-inv",
  "paypal-transmission-sig": "sig",
  "paypal-transmission-time": "2026-11-05T10:00:00Z",
};

describe.skipIf(!hasTestDb)("sponsor invoices", () => {
  let t: TestDb;
  let app: FastifyInstance;
  let orgId: string;
  let invoices: FakePayPalInvoices;
  let seq = 0;

  beforeAll(async () => {
    t = createTestDb();
    await migrateTestDb(t);
    setWebhookVerifier({ verify: async () => true });
    app = await buildApp({ logger: false });
    await app.ready();
  });
  beforeEach(async () => {
    await truncateAll(t);
    orgId = (await seedOrg(t, "room-12-readers", KEY)).id;
    await seedOrg(t, "second-chance-paws", OTHER_KEY);
    invoices = new FakePayPalInvoices();
    setInvoicesGateway(invoices);
  });
  afterEach(async () => {
    await assertMoneyInvariants(t.db);
  });
  afterAll(async () => {
    setInvoicesGateway(realInvoicesGateway);
    setWebhookVerifier(realWebhookVerifier);
    await app?.close();
    await t?.pool.end();
    await closeDb();
  });

  /** Two coats from the demo: $45 open and $45 with $15 already given → the invoice asks for $75. */
  const invoiceCoats = async () => {
    const a = await seedNeed(t, orgId, { title: "Winter coat, size 8", category: "clothing", targetCents: 4500 });
    const b = await seedNeed(t, orgId, {
      title: "Winter coat, size 10",
      category: "clothing",
      targetCents: 4500,
      fundedCents: 1500,
    });
    const action = await proposeAction({
      orgId,
      tool: "create_invoice",
      args: { needIds: [a.id, b.id], recipientEmail: "sponsor@acme.example", recipientName: "Acme Hardware" },
      origin: "assistant",
    });
    const done = await approveAction(orgId, action.id);
    expect(done.status).toBe("executed");
    const { sponsorInvoice } = CreateInvoiceResult.parse(done.result);
    return { a, b, sponsorInvoice, paypalId: sponsorInvoice.paypalInvoiceId! };
  };

  /** PayPal's event (only the invoice id is used; the handler GETs the invoice). */
  const paidEvent = (invoiceId: string, eventId = `WH-INV-${++seq}`) => ({
    id: eventId,
    event_type: "INVOICING.INVOICE.PAID",
    resource: { invoice: { id: invoiceId, status: "PAID" } },
  });
  const deliver = (event: unknown) =>
    app.inject({
      method: "POST",
      url: "/api/webhooks/paypal",
      payload: JSON.stringify(event),
      headers: SIGNED_HEADERS,
    });

  // -------------------------------------------------------------------------------------------

  it("the sponsor pays: every tile on the invoice is funded (reason sponsor), holds converted, invoice paid", async () => {
    const { a, b, sponsorInvoice, paypalId } = await invoiceCoats();
    // While the invoice is out, donors can't fund those tiles twice.
    const blocked = await app.inject({
      method: "POST",
      url: "/api/donations/orders",
      payload: { needId: a.id, amountCents: 1000 },
      headers: { "x-forwarded-for": nextIp() },
    });
    expect(ApiError.parse(blocked.json()).error.code).toBe("FULLY_FUNDED");

    invoices.pay(paypalId);
    const res = await deliver(paidEvent(paypalId));
    expect(res.statusCode).toBe(200);

    expect(await getNeedCard(a.id)).toMatchObject({ status: "funded", fundedCents: 4500, heldCents: 0 });
    expect(await getNeedCard(b.id)).toMatchObject({ status: "funded", fundedCents: 4500, heldCents: 0 });
    const [don] = await t.db.select().from(donations).where(eq(donations.sponsorInvoiceId, sponsorInvoice.id));
    expect(don).toMatchObject({
      source: "invoice",
      amountCents: 7500,
      captureId: `FAKEPAY${paypalId.slice(-4)}`,
      donorName: "Acme Hardware",
      unallocatedCents: 0,
    });
    const rows = await t.db.select().from(allocations).where(eq(allocations.donationId, don!.id));
    expect(rows.map((r) => [r.needId, r.amountCents, r.reason]).sort()).toEqual(
      [
        [a.id, 4500, "sponsor"],
        [b.id, 3000, "sponsor"],
      ].sort(),
    );
    const holds = await t.db.select().from(reservations).where(eq(reservations.sponsorInvoiceId, sponsorInvoice.id));
    expect(holds.map((h) => h.status)).toEqual(["converted", "converted"]);
    const [inv] = await t.db.select().from(sponsorInvoices).where(eq(sponsorInvoices.id, sponsorInvoice.id));
    expect(inv).toMatchObject({ status: "paid", paidAt: expect.any(Date) });
  });

  it("counted once: the same event twice, a second event id, and two at once", async () => {
    const { a, paypalId } = await invoiceCoats();
    invoices.pay(paypalId);
    const event = paidEvent(paypalId);
    const results = await Promise.all([deliver(event), deliver(paidEvent(paypalId)), deliver(paidEvent(paypalId))]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect((await deliver(event)).statusCode).toBe(200);
    expect(
      await recordInvoicePaid({ paypalInvoiceId: paypalId, transactionId: "OTHER", paidCents: 7500 }),
    ).toMatchObject({ kind: "duplicate" });

    expect(await t.db.select().from(donations).where(eq(donations.source, "invoice"))).toHaveLength(1);
    expect((await getNeedCard(a.id))!.fundedCents).toBe(4500);
  });

  it("not paid yet, or not our invoice → acknowledged, nothing recorded", async () => {
    const { a, paypalId } = await invoiceCoats();
    expect((await deliver(paidEvent(paypalId))).statusCode).toBe(200); // PayPal still says SENT
    expect((await deliver(paidEvent("INV2-NOT-OURS"))).statusCode).toBe(200);
    expect(invoices.calls.filter((c) => c === "get")).toHaveLength(1); // unknown ids never reach PayPal
    expect(await t.db.select().from(donations).where(eq(donations.source, "invoice"))).toHaveLength(0);
    expect(await getNeedCard(a.id)).toMatchObject({ fundedCents: 0, heldCents: 4500 });
    // A malformed event is a processing error → 500, PayPal retries.
    expect((await deliver({ id: "WH-BAD", event_type: "INVOICING.INVOICE.PAID", resource: {} })).statusCode).toBe(500);
  });

  it("a tile that stopped taking money meanwhile: its share overflows to the most urgent open need", async () => {
    const { a, b, paypalId } = await invoiceCoats();
    const other = await seedNeed(t, orgId, { title: "Hand warmers", targetCents: 6000, urgency: 3 });
    await t.db.update(needs).set({ status: "closed" }).where(eq(needs.id, a.id)); // staff closed it (no money on it)
    invoices.pay(paypalId);
    expect((await deliver(paidEvent(paypalId))).statusCode).toBe(200);

    expect((await getNeedCard(b.id))!.fundedCents).toBe(4500);
    expect((await getNeedCard(other.id))!.fundedCents).toBe(4500); // a's $45
    const [don] = await t.db.select().from(donations).where(eq(donations.source, "invoice"));
    expect(don!.unallocatedCents).toBe(0);
  });

  it("GET /api/staff/invoices lists this org's invoices with pay link and QR; other orgs see none", async () => {
    const { sponsorInvoice } = await invoiceCoats();
    const get = (key: string) =>
      app.inject({ method: "GET", url: "/api/staff/invoices", headers: { "x-staff-key": key } });
    const mine = SponsorInvoiceListRes.parse((await get(KEY)).json());
    expect(mine.invoices).toEqual([
      expect.objectContaining({
        id: sponsorInvoice.id,
        status: "sent",
        amountCents: 7500,
        payerViewUrl: expect.stringContaining("paypal.com"),
        qrImageDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
      }),
    ]);
    expect(SponsorInvoiceListRes.parse((await get(OTHER_KEY)).json()).invoices).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/api/staff/invoices" })).statusCode).toBe(401);
  });
});

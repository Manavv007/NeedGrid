/**
 * Approve → run / reject of money actions against a real Postgres (TEST_DATABASE_URL), with fake PayPal gateways.
 * The rules under test: reject runs nothing; approve runs ONLY the stored args + computed amounts; changed amounts
 * fail without calling PayPal; a PayPal failure leaves the money exactly as it was.
 */
import { AgentActionRes, ApiError, CreateInvoiceResult } from "@needgrid/shared";
import { and, eq, isNotNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app";
import { proposeAction } from "../core";
import { getNeedCard } from "../core/needs";
import { closeDb } from "../db/client";
import { agentActions, allocations, donations, needs, reservations, sponsorInvoices } from "../db/schema";
import { recordCapture } from "../money/capture";
import { assertMoneyInvariants } from "../money/invariants";
import { FakePayPalInvoices, FakePayPalRefunds, FAKE_QR } from "../paypal/__fakes__";
import { realInvoicesGateway, setInvoicesGateway } from "../paypal/invoices";
import { realRefundsGateway, setRefundsGateway } from "../paypal/refunds";
import { createTestDb, hasTestDb, migrateTestDb, truncateAll, type TestDb } from "../test/db";
import { seedNeed, seedOrg } from "../test/fixtures";

const KEY = "harbor-demo-2026";
const OTHER_KEY = "paws-demo-2026";

describe.skipIf(!hasTestDb)("money actions: approve / reject", () => {
  let t: TestDb;
  let app: FastifyInstance;
  let orgId: string;
  let invoices: FakePayPalInvoices;
  let refunds: FakePayPalRefunds;
  const fetchSpy = vi.fn();

  beforeAll(async () => {
    t = createTestDb();
    await migrateTestDb(t);
    app = await buildApp({ logger: false });
    await app.ready();
  });
  beforeEach(async () => {
    await truncateAll(t);
    orgId = (await seedOrg(t, "room-12-readers", KEY)).id;
    await seedOrg(t, "second-chance-paws", OTHER_KEY);
    invoices = new FakePayPalInvoices();
    refunds = new FakePayPalRefunds();
    setInvoicesGateway(invoices);
    setRefundsGateway(refunds);
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy); // nothing may reach the real PayPal
  });
  afterEach(async () => {
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    await assertMoneyInvariants(t.db);
  });
  afterAll(async () => {
    setInvoicesGateway(realInvoicesGateway);
    setRefundsGateway(realRefundsGateway);
    await app?.close();
    await t?.pool.end();
    await closeDb();
  });

  const post = (url: string, key = KEY, payload: unknown = {}) =>
    app.inject({ method: "POST", url, headers: { "x-staff-key": key }, payload: payload as object });
  const approve = async (id: string, payload: unknown = {}) => {
    const res = await post(`/api/staff/agent/actions/${id}/approve`, KEY, payload);
    expect(res.statusCode).toBe(200);
    return AgentActionRes.parse(res.json()).action;
  };

  const coats = async () => ({
    a: await seedNeed(t, orgId, { title: "Winter coat, size 8", category: "clothing", targetCents: 4500 }),
    b: await seedNeed(t, orgId, {
      title: "Winter coat, size 10",
      category: "clothing",
      targetCents: 4500,
      fundedCents: 1500,
    }),
  });
  const proposeInvoice = (needIds: string[], send = true) =>
    proposeAction({
      orgId,
      tool: "create_invoice",
      args: { needIds, recipientEmail: "sponsor@acme.example", recipientName: "Acme Hardware", send },
      origin: "assistant",
    });

  /** A PayPal checkout donation of `cents` placed on `needId`, plus `unallocated` with nowhere to go. */
  const giveDonation = async (needId: string, cents: number, unallocated = 0, captureId = "CAP-1") => {
    const [don] = await t.db
      .insert(donations)
      .values({
        orgId,
        amountCents: cents + unallocated,
        unallocatedCents: unallocated,
        source: "order",
        captureId,
        paypalOrderId: `ORD-${captureId}`,
        impactToken: `tok-${captureId}`,
        rollOverConsent: unallocated === 0,
      })
      .returning();
    await t.db.insert(allocations).values({ donationId: don!.id, needId, amountCents: cents, reason: "direct" });
    const [n] = await t.db.select().from(needs).where(eq(needs.id, needId));
    const funded = n!.fundedCents + cents;
    await t.db
      .update(needs)
      .set({ fundedCents: funded, status: funded >= n!.targetCents ? "funded" : n!.status })
      .where(eq(needs.id, needId));
    return don!;
  };
  const proposeRefund = (donationId: string) =>
    proposeAction({ orgId, tool: "create_refund", args: { donationId, reason: "Donor asked" }, origin: "assistant" });

  // -------------------------------------------------------------------------------------------

  it("reject: nothing runs, and a decided action can't be approved or rejected again", async () => {
    const { a } = await coats();
    const action = await proposeInvoice([a.id]);
    const res = await post(`/api/staff/agent/actions/${action.id}/reject`);
    expect(res.statusCode).toBe(200);
    expect(AgentActionRes.parse(res.json()).action).toMatchObject({
      status: "rejected",
      decidedAt: expect.any(String),
    });
    expect(invoices.calls).toEqual([]);
    expect(await t.db.select().from(sponsorInvoices)).toHaveLength(0);
    expect(await t.db.select().from(reservations)).toHaveLength(0);

    for (const verb of ["approve", "reject"]) {
      const again = await post(`/api/staff/agent/actions/${action.id}/${verb}`);
      expect(again.statusCode).toBe(409);
      expect(ApiError.parse(again.json()).error.code).toBe("INVALID_STATE");
    }
    expect(invoices.calls).toEqual([]);
  });

  it("another org's action → 404; bad id → 404; no key → 401; nothing runs", async () => {
    const { a } = await coats();
    const action = await proposeInvoice([a.id]);
    for (const verb of ["approve", "reject"]) {
      expect((await post(`/api/staff/agent/actions/${action.id}/${verb}`, OTHER_KEY)).statusCode).toBe(404);
      expect((await post(`/api/staff/agent/actions/not-a-uuid/${verb}`)).statusCode).toBe(404);
      const noKey = await app.inject({ method: "POST", url: `/api/staff/agent/actions/${action.id}/${verb}` });
      expect(noKey.statusCode).toBe(401);
    }
    const [row] = await t.db.select().from(agentActions).where(eq(agentActions.id, action.id));
    expect(row!.status).toBe("proposed");
    expect(invoices.calls).toEqual([]);
  });

  it("create_invoice: approve bills the stored amounts, holds every tile for the sponsor, returns pay link + QR", async () => {
    const { a, b } = await coats();
    const action = await proposeInvoice([a.id, b.id]);
    // Anything sent with the approval is ignored: amounts come only from the stored proposal.
    const done = await approve(action.id, { amountCents: 1, needIds: [a.id], computed: { totalCents: 1 } });

    expect(done).toMatchObject({ status: "executed", error: null, executedAt: expect.any(String) });
    const { sponsorInvoice } = CreateInvoiceResult.parse(done.result);
    expect(sponsorInvoice).toMatchObject({
      status: "sent",
      amountCents: 7500,
      needIds: [a.id, b.id],
      recipientName: "Acme Hardware",
      paypalInvoiceId: expect.stringMatching(/^INV2-FAKE-/),
      payerViewUrl: expect.stringContaining("sandbox.paypal.com"),
      qrImageDataUrl: FAKE_QR,
    });
    expect(invoices.calls).toEqual(["create", "send", "qr"]);
    const sent = invoices.invoices.get(sponsorInvoice.paypalInvoiceId!)!;
    expect(sent.input.items).toEqual([
      { title: "Winter coat, size 8", amountCents: 4500 },
      { title: "Winter coat, size 10", amountCents: 3000 },
    ]);
    expect(sent.input.sponsorInvoiceId).toBe(sponsorInvoice.id);

    const holds = await t.db.select().from(reservations).where(isNotNull(reservations.sponsorInvoiceId));
    expect(holds.map((h) => [h.needId, h.amountCents, h.status]).sort()).toEqual(
      [
        [a.id, 4500, "active"],
        [b.id, 3000, "active"],
      ].sort(),
    );
    const days = (holds[0]!.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
    // Donors now see both tiles fully on hold (nothing left to give), and no money moved.
    expect(await getNeedCard(a.id)).toMatchObject({ heldCents: 4500, remainingCents: 0, fundedCents: 0 });
    expect(await getNeedCard(b.id)).toMatchObject({ heldCents: 3000, remainingCents: 0, fundedCents: 1500 });
  });

  it("create_invoice: a donor gave in between → failed with 'Amounts changed', PayPal never called", async () => {
    const { a, b } = await coats();
    const action = await proposeInvoice([a.id, b.id]);
    await giveDonation(b.id, 1000);
    const done = await approve(action.id);
    expect(done).toMatchObject({ status: "failed", result: null, executedAt: null });
    expect(done.error).toContain("Amounts changed since this was proposed");
    expect(invoices.calls).toEqual([]);
    expect(await t.db.select().from(sponsorInvoices)).toHaveLength(0);
    expect(await t.db.select().from(reservations)).toHaveLength(0);
  });

  it("create_invoice failures: no invoice reaches the sponsor → holds released; sent despite an error → kept", async () => {
    const { a } = await coats();
    const activeHolds = () =>
      t.db
        .select()
        .from(reservations)
        .where(and(eq(reservations.needId, a.id), eq(reservations.status, "active")));

    invoices.fail.create = true;
    const first = await approve((await proposeInvoice([a.id])).id);
    expect(first).toMatchObject({ status: "failed", error: expect.stringContaining("couldn't create the invoice") });
    expect(await activeHolds()).toHaveLength(0);
    expect((await t.db.select().from(sponsorInvoices))[0]!.status).toBe("cancelled");

    invoices.fail.send = true; // PayPal confirms it's still a draft → delete it, give the holds back
    const second = await approve((await proposeInvoice([a.id])).id);
    expect(second).toMatchObject({ status: "failed", error: expect.stringContaining("couldn't send the invoice") });
    expect(await activeHolds()).toHaveLength(0);
    expect(invoices.calls.slice(-3)).toEqual(["send", "get", "delete"]);

    invoices.fail.send = true;
    invoices.fail.get = true; // can't tell whether it was sent → keep the holds, say so
    const third = await approve((await proposeInvoice([a.id])).id);
    expect(third).toMatchObject({ status: "failed", error: expect.stringContaining("didn't confirm") });
    expect(await activeHolds()).toHaveLength(1);
    await t.db.update(reservations).set({ status: "released" }).where(eq(reservations.needId, a.id));

    invoices.fail.send = true;
    invoices.sendFailsButSent = true; // the send errored but PayPal did send it → success
    const fourth = await approve((await proposeInvoice([a.id])).id);
    expect(fourth.status).toBe("executed");
    expect(CreateInvoiceResult.parse(fourth.result).sponsorInvoice.status).toBe("sent");
    expect(await activeHolds()).toHaveLength(1);
  });

  it("send_invoice: a draft (create with send: false) is sent when the second action is approved", async () => {
    const { a } = await coats();
    const draft = await approve((await proposeInvoice([a.id], false)).id);
    const { sponsorInvoice } = CreateInvoiceResult.parse(draft.result);
    expect(sponsorInvoice).toMatchObject({ status: "draft", qrImageDataUrl: null });
    expect(invoices.calls).toEqual(["create"]);

    const send = await proposeAction({
      orgId,
      tool: "send_invoice",
      args: { sponsorInvoiceId: sponsorInvoice.id },
      origin: "assistant",
    });
    invoices.fail.send = true; // first try fails (still a draft): nothing changes, holds stay
    expect(await approve(send.id)).toMatchObject({ status: "failed", error: expect.stringContaining("still a draft") });
    expect((await getNeedCard(a.id))!.heldCents).toBe(4500);

    const retry = await proposeAction({
      orgId,
      tool: "send_invoice",
      args: { sponsorInvoiceId: sponsorInvoice.id },
      origin: "assistant",
    });
    const done = await approve(retry.id);
    expect(CreateInvoiceResult.parse(done.result).sponsorInvoice).toMatchObject({
      id: sponsorInvoice.id,
      status: "sent",
      qrImageDataUrl: FAKE_QR,
    });
  });

  it("create_refund: refunds the stored amount on the stored capture; funded tile reopens; donation refunded", async () => {
    const need = await seedNeed(t, orgId, { title: "Wipes", targetCents: 2000 });
    const don = await giveDonation(need.id, 2000, 500, "CAP-R1");
    expect((await getNeedCard(need.id))!.status).toBe("funded");

    const action = await proposeRefund(don.id);
    expect(action.computed).toMatchObject({ refundCents: 2500 });
    const done = await approve(action.id, { refundCents: 1 });

    expect(done).toMatchObject({
      status: "executed",
      result: { refundId: "FAKEREFUND1", status: "COMPLETED", refundCents: 2500, donationId: don.id },
    });
    expect(refunds.calls).toEqual([
      { actionId: action.id, captureId: "CAP-R1", amountCents: 2500, noteToPayer: "Donor asked" },
    ]);
    const [after] = await t.db.select().from(donations).where(eq(donations.id, don.id));
    expect(after).toMatchObject({ refundedCents: 2500, unallocatedCents: 0, status: "refunded" });
    const rows = await t.db.select().from(allocations).where(eq(allocations.donationId, don.id));
    expect(rows.map((r) => [r.reason, r.amountCents]).sort()).toEqual(
      [
        ["direct", 2000],
        ["refund", -2000],
      ].sort(),
    );
    expect(await getNeedCard(need.id)).toMatchObject({ status: "open", fundedCents: 0 });
  });

  it("create_refund: money spent in between → failed, PayPal never called; PayPal outage → failed, nothing moved", async () => {
    const need = await seedNeed(t, orgId, { title: "Formula", targetCents: 3000 });
    const don = await giveDonation(need.id, 1200, 0, "CAP-R2");

    const spent = await proposeRefund(don.id);
    await t.db.update(needs).set({ status: "ordered" }).where(eq(needs.id, need.id));
    expect(await approve(spent.id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("Amounts changed"),
    });
    expect(refunds.calls).toHaveLength(0);
    await t.db.update(needs).set({ status: "open" }).where(eq(needs.id, need.id));

    refunds.failNext = true;
    const outage = await approve((await proposeRefund(don.id)).id);
    expect(outage).toMatchObject({ status: "failed", error: expect.stringContaining("No money was moved") });
    const [after] = await t.db.select().from(donations).where(eq(donations.id, don.id));
    expect(after).toMatchObject({ refundedCents: 0, status: "captured" });
    expect((await getNeedCard(need.id))!.fundedCents).toBe(1200);
  });

  it("create_refund: the system proposal for money with nowhere to go refunds just that money", async () => {
    const need = await seedNeed(t, orgId, { title: "Diapers", targetCents: 3000, fundedCents: 2000 });
    const [hold] = await t.db
      .insert(reservations)
      .values({
        needId: need.id,
        amountCents: 1000,
        rollOverConsent: false,
        expiresAt: new Date(Date.now() + 600_000),
        paypalOrderId: "ORD-SYS",
      })
      .returning();
    // The donor pays $15 for a tile with $10 left and said "don't move my money" → $5 set aside + a system proposal.
    await recordCapture({
      reservationId: hold!.id,
      orderId: "ORD-SYS",
      captureId: "CAP-SYS",
      amountCents: 1500,
      donorName: "Jamie",
      donorEmail: "jamie@example.com",
    });
    const [proposal] = await t.db.select().from(agentActions).where(eq(agentActions.origin, "system"));
    expect(proposal).toMatchObject({ tool: "create_refund", status: "proposed" });

    const done = await approve(proposal!.id);
    expect(done).toMatchObject({ status: "executed", result: { refundCents: 500 } });
    expect(refunds.calls[0]).toMatchObject({ captureId: "CAP-SYS", amountCents: 500 });
    const [don] = await t.db.select().from(donations).where(eq(donations.captureId, "CAP-SYS"));
    expect(don).toMatchObject({ refundedCents: 500, unallocatedCents: 0, status: "partially_refunded" });
    expect((await getNeedCard(need.id))!.status).toBe("funded"); // the $10 that fit stays on the tile
  });

  it("double clicks: the same approval twice at once runs once; a second refund of the same money fails", async () => {
    const need = await seedNeed(t, orgId, { title: "Wipes", targetCents: 3000 });
    const don = await giveDonation(need.id, 1000, 0, "CAP-R3");
    const first = await proposeRefund(don.id);
    const second = await proposeRefund(don.id);

    const [x, y] = await Promise.all([
      post(`/api/staff/agent/actions/${first.id}/approve`),
      post(`/api/staff/agent/actions/${first.id}/approve`),
    ]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    expect(refunds.calls).toHaveLength(1);

    expect(await approve(second.id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("Amounts changed"),
    });
    expect(refunds.calls).toHaveLength(1);
    const [after] = await t.db.select().from(donations).where(eq(donations.id, don.id));
    expect(after!.refundedCents).toBe(1000);
  });
});

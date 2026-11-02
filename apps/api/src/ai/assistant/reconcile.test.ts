import { ReconcileReport } from "@needgrid/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../../db/client";
import { reservations, sponsorInvoices } from "../../db/schema";
import { createTestDb, hasTestDb, migrateTestDb, truncateAll, type TestDb } from "../../test/db";
import { seedNeed, seedOrg } from "../../test/fixtures";
import {
  buildReconcileReport,
  clampDays,
  dbOrgScope,
  isIncomingPayment,
  PENDING_WINDOW_MS,
  reconcile,
  type OrgScope,
  type PayPalTxn,
  type RecordedDonation,
} from "./reconcile";

const NOW = new Date("2026-11-05T18:00:00.000Z");
const START = new Date("2026-10-29T18:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const did = (n: number) => `6f1c1d1e-2b3c-4d5e-8f90-${String(n).padStart(12, "0")}`;

const txn = (id: string, amountCents: number, over: Partial<PayPalTxn> = {}): PayPalTxn => ({
  transactionId: id,
  status: "S",
  amountCents,
  currency: "USD",
  at: hoursAgo(24),
  invoiceId: null,
  customField: null,
  eventCode: "T0006",
  ...over,
});
const rec = (n: number, amountCents: number, over: Partial<RecordedDonation> = {}): RecordedDonation => ({
  donationId: did(n),
  captureId: null,
  paypalInvoiceId: null,
  amountCents,
  at: hoursAgo(24),
  ...over,
});
const scope = (reservationIds: string[] = [], invoiceIds: string[] = []): OrgScope => ({
  reservationIds: new Set(reservationIds),
  invoiceIds: new Set(invoiceIds),
});
const build = (paypal: PayPalTxn[], recorded: RecordedDonation[], s: OrgScope = scope()) =>
  buildReconcileReport({ paypal, recorded, scope: s, start: START, end: NOW });

describe("buildReconcileReport", () => {
  it("clean data: matched by capture id and by invoice id → ok, totals equal", () => {
    const { report, pending, unattributed } = build(
      [txn("CAP1", 2500), txn("INVPAY", 18000, { invoiceId: "INV2-AAAA" })],
      [rec(1, 2500, { captureId: "CAP1" }), rec(2, 18000, { paypalInvoiceId: "INV2-AAAA" })],
    );
    expect(ReconcileReport.parse(report)).toEqual({
      periodStart: START.toISOString(),
      periodEnd: NOW.toISOString(),
      paypalTotalCents: 20500,
      recordedTotalCents: 20500,
      matchedCount: 2,
      mismatches: [],
      ok: true,
    });
    expect([pending, unattributed]).toEqual([0, 0]);
  });

  it("amount_mismatch: same payment, different amounts", () => {
    const { report } = build([txn("CAP1", 3000)], [rec(1, 2500, { captureId: "CAP1" })]);
    expect(report.ok).toBe(false);
    expect(report.matchedCount).toBe(0);
    expect(report.mismatches).toEqual([
      {
        kind: "amount_mismatch",
        paypalTransactionId: "CAP1",
        donationId: did(1),
        paypalCents: 3000,
        recordedCents: 2500,
      },
    ]);
  });

  it("missing_in_records: this org's PayPal payment (by reservation custom_id or invoice id) with no donation", () => {
    const { report } = build(
      [txn("CAP9", 1400, { customField: "res-ours" }), txn("INV9", 5000, { invoiceId: "INV2-OURS" })],
      [],
      scope(["res-ours"], ["INV2-OURS"]),
    );
    expect(report.mismatches.map((m) => [m.kind, m.paypalTransactionId, m.paypalCents])).toEqual([
      ["missing_in_records", "CAP9", 1400],
      ["missing_in_records", "INV9", 5000],
    ]);
    expect(report.paypalTotalCents).toBe(6400);
  });

  it("missing_in_paypal: an older recorded donation PayPal doesn't list", () => {
    const { report } = build([], [rec(3, 2000, { captureId: "CAP3", at: hoursAgo(5) })]);
    expect(report.mismatches).toEqual([
      {
        kind: "missing_in_paypal",
        paypalTransactionId: null,
        donationId: did(3),
        paypalCents: null,
        recordedCents: 2000,
      },
    ]);
    expect(report.recordedTotalCents).toBe(2000);
  });

  it("pending window: a donation newer than 3 hours missing in PayPal is pending, not a mismatch", () => {
    const justInside = new Date(NOW.getTime() - PENDING_WINDOW_MS + 60_000).toISOString();
    const { report, pending } = build([], [rec(4, 2000, { at: justInside }), rec(5, 1000, { at: hoursAgo(0.1) })]);
    expect([report.ok, report.mismatches, pending, report.recordedTotalCents]).toEqual([true, [], 2, 0]);
  });

  it("other orgs' payments are skipped; payments with no ids are only counted", () => {
    const { report, unattributed } = build(
      [
        txn("OTHER", 999, { customField: "res-other-org" }),
        txn("OTHERINV", 999, { invoiceId: "INV2-OTHER" }),
        txn("ANON", 777),
      ],
      [],
      scope(["res-ours"]),
    );
    expect([report.ok, report.paypalTotalCents, unattributed]).toEqual([true, 0, 1]);
  });

  it("ignores refunds, fees, other currencies, failed and duplicate rows; one PayPal payment per donation", () => {
    expect(isIncomingPayment(txn("R", 500, { eventCode: "T1107" }))).toBe(false);
    expect(isIncomingPayment(txn("F", 500, { status: "D" }))).toBe(false);
    expect(isIncomingPayment(txn("E", 500, { currency: "EUR" }))).toBe(false);
    expect(isIncomingPayment(txn("Z", 0))).toBe(false);
    const { report } = build(
      [
        txn("CAP1", 2500),
        txn("CAP1", 2500),
        txn("INVX", 2500, { invoiceId: "INV2-X" }),
        txn("REF", 2500, { eventCode: "T1107" }),
      ],
      [rec(1, 2500, { captureId: "CAP1", paypalInvoiceId: "INV2-X" })],
      scope([], ["INV2-X"]),
    );
    // CAP1 matched once; INVX can't match the same donation again → our invoice payment with no record.
    expect(report.matchedCount).toBe(1);
    expect(report.mismatches.map((m) => [m.kind, m.paypalTransactionId])).toEqual([["missing_in_records", "INVX"]]);
  });

  it("days are clamped to 1–31 (PayPal's limit)", () => {
    expect([clampDays(undefined), clampDays(0), clampDays(45), clampDays(3.7)]).toEqual([7, 1, 31, 3]);
  });
});

describe("reconcile (I/O wiring)", () => {
  it("asks PayPal and our records for the same window, for this org only", async () => {
    const calls: unknown[] = [];
    const res = await reconcile(
      did(100),
      3,
      {
        listPayPalTransactions: async (i) => (calls.push(["paypal", i]), [txn("CAP1", 2500)]),
        listRecordedDonations: async (i) => (calls.push(["records", i]), [rec(1, 2500, { captureId: "CAP1" })]),
        orgScope: async (orgId) => (calls.push(["scope", orgId]), scope()),
      },
      NOW,
    );
    const start = new Date(NOW.getTime() - 3 * 86_400_000);
    expect(calls).toEqual([
      ["paypal", { start, end: NOW }],
      ["records", { orgId: did(100), start, end: NOW }],
      ["scope", did(100)],
    ]);
    expect(res.report.ok).toBe(true);
  });
});

describe.skipIf(!hasTestDb)("dbOrgScope (TEST_DATABASE_URL)", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = createTestDb();
    await migrateTestDb(t);
  });
  beforeEach(async () => {
    await truncateAll(t);
  });
  afterAll(async () => {
    await t?.pool.end();
    await closeDb();
  });

  it("returns this org's recent reservation ids and PayPal invoice ids, not another org's", async () => {
    const ours = await seedOrg(t, "room-12-readers", "room12-demo-2026");
    const other = await seedOrg(t, "harbor-food-bank", "harbor-demo-2026");
    const ourNeed = await seedNeed(t, ours.id, { title: "Winter coats", targetCents: 9000 });
    const otherNeed = await seedNeed(t, other.id, { title: "Diapers", targetCents: 9000 });
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    const [r1] = await t.db
      .insert(reservations)
      .values({ needId: ourNeed.id, amountCents: 1000, expiresAt })
      .returning();
    await t.db.insert(reservations).values({ needId: otherNeed.id, amountCents: 1000, expiresAt });
    await t.db.insert(sponsorInvoices).values([
      { orgId: ours.id, recipientEmail: "a@acme.example", amountCents: 9000, paypalInvoiceId: "INV2-OURS" },
      { orgId: ours.id, recipientEmail: "b@acme.example", amountCents: 9000 }, // draft, no PayPal id yet
      { orgId: other.id, recipientEmail: "c@acme.example", amountCents: 9000, paypalInvoiceId: "INV2-OTHER" },
    ]);

    const s = await dbOrgScope(ours.id, new Date(Date.now() - 7 * 86_400_000));
    expect([...s.reservationIds]).toEqual([r1!.id]);
    expect([...s.invoiceIds]).toEqual(["INV2-OURS"]);
  });
});

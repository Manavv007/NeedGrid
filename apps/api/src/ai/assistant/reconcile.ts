/**
 * "Check this week's money" (AGENT_B_AI_DATA.md §9.7): PayPal's transactions vs our recorded donations. Deterministic,
 * no LLM; the assistant only explains the report.
 *
 * The three demo charities share ONE sandbox merchant account, so PayPal's list holds every org's payments. A payment
 * belongs to this org when it matches one of this org's donations (capture id / invoice id), or its custom_id is one
 * of this org's reservations (orders set custom_id = reservation id), or its invoice id is one of this org's sponsor
 * invoices. Payments of other orgs are skipped; payments with no id at all can't be attributed and are only counted.
 */
import { ReconcileReport } from "@needgrid/shared";
import { and, eq, gte, isNotNull } from "drizzle-orm";
import * as core from "../../core";

export type PayPalTxn = Awaited<ReturnType<typeof core.listPayPalTransactions>>[number];
export type RecordedDonation = Awaited<ReturnType<typeof core.listRecordedDonations>>[number];

export const DEFAULT_DAYS = 7;
export const MAX_DAYS = 31; // PayPal Transaction Search limit
/** PayPal Transaction Search can lag by ~3 hours: newer donations missing in PayPal are "pending", not mismatches. */
export const PENDING_WINDOW_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** Completed (S) or pending (P) payments in USD. Event codes T00xx are payments; refunds/holds/fees are other groups. */
export function isIncomingPayment(t: PayPalTxn): boolean {
  return (
    (t.status === "S" || t.status === "P") &&
    t.currency.toUpperCase() === "USD" &&
    /^T00\d\d$/.test(t.eventCode) &&
    Number.isSafeInteger(t.amountCents) &&
    t.amountCents > 0
  );
}

export interface OrgScope {
  /** This org's reservation ids (PayPal custom_id). */
  reservationIds: ReadonlySet<string>;
  /** This org's PayPal invoice ids. */
  invoiceIds: ReadonlySet<string>;
}

export interface ReconcileResult {
  report: ReconcileReport;
  /** Recorded donations newer than the PayPal lag window that PayPal doesn't list yet. */
  pending: number;
  /** PayPal payments with neither custom_id nor invoice id: no org can claim them. */
  unattributed: number;
  /** This org's PayPal payments in the period (matched or not), newest first. */
  payments: PayPalTxn[];
}

export function buildReconcileReport(input: {
  paypal: readonly PayPalTxn[];
  recorded: readonly RecordedDonation[];
  scope: OrgScope;
  start: Date;
  end: Date;
  now?: Date;
}): ReconcileResult {
  const now = input.now ?? input.end;
  const byCapture = new Map<string, RecordedDonation>();
  const byInvoice = new Map<string, RecordedDonation>();
  for (const r of input.recorded) {
    if (r.captureId) byCapture.set(r.captureId, r);
    if (r.paypalInvoiceId && !byInvoice.has(r.paypalInvoiceId)) byInvoice.set(r.paypalInvoiceId, r);
  }

  const mismatches: ReconcileReport["mismatches"] = [];
  const matched = new Set<string>();
  const seenTxn = new Set<string>();
  const payments: PayPalTxn[] = [];
  let matchedCount = 0;
  let unattributed = 0;

  for (const t of input.paypal) {
    if (!isIncomingPayment(t) || seenTxn.has(t.transactionId)) continue;
    seenTxn.add(t.transactionId);
    let rec = byCapture.get(t.transactionId);
    if (!rec && t.invoiceId) rec = byInvoice.get(t.invoiceId);
    if (rec && matched.has(rec.donationId)) rec = undefined; // one PayPal payment per donation

    if (rec) {
      matched.add(rec.donationId);
      payments.push(t);
      if (rec.amountCents === t.amountCents) matchedCount++;
      else {
        mismatches.push({
          kind: "amount_mismatch",
          paypalTransactionId: t.transactionId,
          donationId: rec.donationId,
          paypalCents: t.amountCents,
          recordedCents: rec.amountCents,
        });
      }
      continue;
    }
    const ours =
      (t.customField !== null && input.scope.reservationIds.has(t.customField)) ||
      (t.invoiceId !== null && input.scope.invoiceIds.has(t.invoiceId));
    if (ours) {
      payments.push(t);
      mismatches.push({
        kind: "missing_in_records",
        paypalTransactionId: t.transactionId,
        donationId: null,
        paypalCents: t.amountCents,
        recordedCents: null,
      });
    } else if (!t.customField && !t.invoiceId) unattributed++;
    // else: another org's payment
  }

  let pending = 0;
  let recordedTotalCents = 0;
  for (const r of input.recorded) {
    if (matched.has(r.donationId)) {
      recordedTotalCents += r.amountCents;
      continue;
    }
    if (now.getTime() - new Date(r.at).getTime() < PENDING_WINDOW_MS) {
      pending++;
      continue;
    }
    recordedTotalCents += r.amountCents;
    mismatches.push({
      kind: "missing_in_paypal",
      paypalTransactionId: null,
      donationId: r.donationId,
      paypalCents: null,
      recordedCents: r.amountCents,
    });
  }

  payments.sort((a, b) => b.at.localeCompare(a.at));
  const report = ReconcileReport.parse({
    periodStart: input.start.toISOString(),
    periodEnd: input.end.toISOString(),
    paypalTotalCents: payments.reduce((s, t) => s + t.amountCents, 0),
    recordedTotalCents,
    matchedCount,
    mismatches,
    ok: mismatches.length === 0,
  });
  return { report, pending, unattributed, payments };
}

// ---------------------------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------------------------

export interface ReconcileDeps {
  listPayPalTransactions: typeof core.listPayPalTransactions;
  listRecordedDonations: typeof core.listRecordedDonations;
  orgScope(orgId: string, since: Date): Promise<OrgScope>;
}

/** Reservations are created just before the PayPal order, so look back one extra day for payments near the start. */
export async function dbOrgScope(orgId: string, since: Date): Promise<OrgScope> {
  const { needs, reservations, sponsorInvoices } = core.schema;
  const [res, inv] = await Promise.all([
    core.db
      .select({ id: reservations.id })
      .from(reservations)
      .innerJoin(needs, eq(needs.id, reservations.needId))
      .where(and(eq(needs.orgId, orgId), gte(reservations.createdAt, new Date(since.getTime() - DAY_MS)))),
    core.db
      .select({ id: sponsorInvoices.paypalInvoiceId })
      .from(sponsorInvoices)
      .where(and(eq(sponsorInvoices.orgId, orgId), isNotNull(sponsorInvoices.paypalInvoiceId))),
  ]);
  return {
    reservationIds: new Set(res.map((r) => r.id)),
    invoiceIds: new Set(inv.flatMap((r) => (r.id ? [r.id] : []))),
  };
}

export const coreReconcileDeps: ReconcileDeps = {
  listPayPalTransactions: (i) => core.listPayPalTransactions(i),
  listRecordedDonations: (i) => core.listRecordedDonations(i),
  orgScope: dbOrgScope,
};

export function clampDays(days: number | undefined): number {
  const d = Math.trunc(days ?? DEFAULT_DAYS);
  return Number.isFinite(d) ? Math.min(MAX_DAYS, Math.max(1, d)) : DEFAULT_DAYS;
}

/** The last `days` days, for one org. Throws whatever PayPal/core throws (the tool turns it into a message). */
export async function reconcile(
  orgId: string,
  days: number | undefined,
  deps: ReconcileDeps = coreReconcileDeps,
  now: Date = new Date(),
): Promise<ReconcileResult> {
  const end = now;
  const start = new Date(end.getTime() - clampDays(days) * DAY_MS);
  const [paypal, recorded, scope] = await Promise.all([
    deps.listPayPalTransactions({ start, end }),
    deps.listRecordedDonations({ orgId, start, end }),
    deps.orgScope(orgId, start),
  ]);
  return buildReconcileReport({ paypal, recorded, scope, start, end, now });
}

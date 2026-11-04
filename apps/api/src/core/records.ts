/** Our own donation records, for B's reconcile check against PayPal. Seed history is excluded. */
import { and, eq, gte, lt, ne } from "drizzle-orm";
import { db } from "../db/client";
import { donations, sponsorInvoices } from "../db/schema";
import { HttpError } from "../lib/http";
import { MAX_WINDOW_DAYS } from "../paypal/transactions";

export async function listRecordedDonations(input: { orgId: string; start: Date; end: Date }): Promise<
  Array<{
    donationId: string;
    captureId: string | null;
    paypalInvoiceId: string | null;
    amountCents: number;
    at: string;
  }>
> {
  if (!(input.start < input.end)) throw new HttpError(400, "VALIDATION", "start must be before end");
  if (input.end.getTime() - input.start.getTime() > MAX_WINDOW_DAYS * 86_400_000) {
    throw new HttpError(400, "VALIDATION", `At most ${MAX_WINDOW_DAYS} days at a time`);
  }
  const rows = await db
    .select({
      donationId: donations.id,
      captureId: donations.captureId,
      paypalInvoiceId: sponsorInvoices.paypalInvoiceId,
      amountCents: donations.amountCents,
      at: donations.createdAt,
    })
    .from(donations)
    .leftJoin(sponsorInvoices, eq(sponsorInvoices.id, donations.sponsorInvoiceId))
    .where(
      and(
        eq(donations.orgId, input.orgId),
        ne(donations.source, "seed"),
        gte(donations.createdAt, input.start),
        lt(donations.createdAt, input.end),
      ),
    )
    .orderBy(donations.createdAt);
  return rows.map((r) => ({ ...r, at: r.at.toISOString() }));
}

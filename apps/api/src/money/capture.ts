/**
 * Finish a donation (AGENT_A_BACKEND.md §8.3, money rules 4, 5 and 6).
 *
 * `recordCapture` is the ONLY code that turns captured PayPal order money into allocations.
 * It is idempotent: the unique capture_id / paypal_order_id make a second call (page refresh,
 * the webhook in Phase 4, a retry) return the first donation instead of counting twice.
 */
import { CaptureRes, splitCapture } from "@needgrid/shared";
import { randomBytes } from "node:crypto";
import { asc, eq, or, sql } from "drizzle-orm";
import { publishNeedUpdated, type Executor } from "../core/needs";
import { db } from "../db/client";
import { allocations, donations, needs, reservations } from "../db/schema";
import { HttpError, notFound } from "../lib/http";
import { ordersGateway } from "../paypal/orders";
import { allocate, distribute, lockNeed, roomCents, withTxRetry } from "./ledger";
import { proposeSystemRefund } from "./refundProposal";

export interface RecordCaptureInput {
  reservationId: string;
  orderId: string;
  captureId: string;
  amountCents: number;
  donorName: string | null;
  donorEmail: string | null;
}

/** 128-bit random, URL-safe. The donor's only key to their impact page. */
export const newImpactToken = () => randomBytes(16).toString("base64url");

/** POST /api/donations/orders/:orderId/capture */
export async function captureDonationOrder(orderId: string): Promise<CaptureRes> {
  const [existing] = await db
    .select({ id: donations.id })
    .from(donations)
    .where(eq(donations.paypalOrderId, orderId))
    .limit(1);
  if (existing) return buildCaptureRes(db, existing.id);

  const [reservation] = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(eq(reservations.paypalOrderId, orderId))
    .limit(1);
  if (!reservation) throw notFound("Donation order");

  const order = await ordersGateway().captureOrder(orderId);
  const capture = order.capture;
  if (!capture) {
    throw new HttpError(409, "INVALID_STATE", "PayPal hasn't captured this payment", { paypalIssue: "NO_CAPTURE" });
  }
  if (capture.status !== "COMPLETED" && capture.status !== "PENDING") {
    throw new HttpError(409, "INVALID_STATE", "The payment didn't go through", {
      paypalIssue: `CAPTURE_${capture.status}`,
    });
  }
  if (capture.currency !== "USD") {
    throw new HttpError(502, "UPSTREAM", `Unexpected capture currency ${capture.currency}`);
  }

  return recordCapture({
    reservationId: reservation.id,
    orderId,
    captureId: capture.id,
    amountCents: capture.amountCents,
    donorName: order.payer.givenName,
    donorEmail: order.payer.email,
  });
}

export async function recordCapture(input: RecordCaptureInput): Promise<CaptureRes> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error(`recordCapture: invalid amount ${input.amountCents}`);
  }
  const touched = new Set<string>();

  const donationId = await withTxRetry(() =>
    db.transaction(async (tx) => {
      touched.clear();
      const [res] = await tx
        .select({
          id: reservations.id,
          needId: reservations.needId,
          rollOverConsent: reservations.rollOverConsent,
          orgId: needs.orgId,
        })
        .from(reservations)
        .innerJoin(needs, eq(needs.id, reservations.needId))
        .where(eq(reservations.id, input.reservationId));
      if (!res) throw notFound("Reservation");

      // Dedupe gate: a concurrent duplicate waits here for the first insert, then gets no row.
      const [inserted] = await tx
        .insert(donations)
        .values({
          orgId: res.orgId,
          paypalOrderId: input.orderId,
          captureId: input.captureId,
          amountCents: input.amountCents,
          donorName: input.donorName,
          donorEmail: input.donorEmail,
          rollOverConsent: res.rollOverConsent,
          source: "order",
          status: "captured",
          impactToken: newImpactToken(),
        })
        .onConflictDoNothing()
        .returning({ id: donations.id });
      if (!inserted) {
        const [dup] = await tx
          .select({ id: donations.id })
          .from(donations)
          .where(or(eq(donations.captureId, input.captureId), eq(donations.paypalOrderId, input.orderId)))
          .limit(1);
        if (!dup) throw new Error("recordCapture: conflicting donation not found");
        return dup.id;
      }

      await tx.select({ id: reservations.id }).from(reservations).where(eq(reservations.id, res.id)).for("update");
      const need = await lockNeed(tx, res.needId);
      if (!need) throw notFound("Need");
      touched.add(need.id);

      // Room on the tile, ignoring this donation's own hold (it is being converted now).
      const { directCents, overflowCents } = splitCapture(input.amountCents, await roomCents(tx, need, res.id));
      if (directCents > 0) {
        await allocate(tx, { donationId: inserted.id, needId: need.id, cents: directCents, reason: "direct" });
      }

      let unallocated = 0;
      if (overflowCents > 0) {
        if (res.rollOverConsent) {
          const placed = await distribute(tx, {
            donationId: inserted.id,
            orgId: res.orgId,
            cents: overflowCents,
            reason: "overflow",
            excludeNeedId: need.id,
          });
          placed.needIds.forEach((id) => touched.add(id));
          unallocated = placed.leftoverCents;
        } else {
          unallocated = overflowCents;
        }
      }

      await tx.update(reservations).set({ status: "converted" }).where(eq(reservations.id, res.id));

      if (unallocated > 0) {
        await tx.update(donations).set({ unallocatedCents: unallocated }).where(eq(donations.id, inserted.id));
        await proposeSystemRefund(tx, {
          orgId: res.orgId,
          donationId: inserted.id,
          refundCents: unallocated,
          reason: "Item was already fully funded",
        });
      }
      return inserted.id;
    }),
  );

  for (const needId of touched) await publishNeedUpdated(needId);
  return buildCaptureRes(db, donationId);
}

/** What one donation paid for, per need and reason (positive net amounts only). */
export async function buildCaptureRes(ex: Executor, donationId: string): Promise<CaptureRes> {
  const [donation] = await ex.select().from(donations).where(eq(donations.id, donationId)).limit(1);
  if (!donation) throw notFound("Donation");
  const rows = await ex
    .select({
      needId: allocations.needId,
      needTitle: needs.title,
      reason: allocations.reason,
      amountCents: sql<number>`sum(${allocations.amountCents})::int`,
      firstAt: sql<string>`min(${allocations.createdAt})`,
    })
    .from(allocations)
    .innerJoin(needs, eq(needs.id, allocations.needId))
    .where(eq(allocations.donationId, donationId))
    .groupBy(allocations.needId, needs.title, allocations.reason)
    .having(sql`sum(${allocations.amountCents}) > 0`)
    .orderBy(asc(sql`min(${allocations.createdAt})`));
  return CaptureRes.parse({
    donationId: donation.id,
    impactToken: donation.impactToken,
    amountCents: donation.amountCents,
    allocations: rows.map(({ needId, needTitle, reason, amountCents }) => ({ needId, needTitle, reason, amountCents })),
  });
}

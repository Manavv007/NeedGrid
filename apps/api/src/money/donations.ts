/**
 * Start a donation: POST /api/donations/orders (AGENT_A_BACKEND.md §8.2, money rules 1 and 3).
 *
 * The browser sends a need id and a REQUESTED amount. The server decides the real amount:
 *   remaining = target − funded − active holds      (need row locked)
 *   amount    = min(requested, remaining), held for HOLD_MINUTES
 * The row lock is released BEFORE calling PayPal, so a slow PayPal never blocks other donors.
 */
import { clampDonation, CreateOrderRes, remainingCents, type CreateOrderReq } from "@needgrid/shared";
import { eq, sql } from "drizzle-orm";
import { getNextMostUrgentNeed, publishNeedUpdated } from "../core/needs";
import { db } from "../db/client";
import { reservations } from "../db/schema";
import { holdSeconds } from "../env";
import { HttpError, notFound } from "../lib/http";
import { ordersGateway } from "../paypal/orders";
import { heldCents, isDonatable, lockNeed, withTxRetry } from "./ledger";

export async function createDonationOrder(req: CreateOrderReq): Promise<CreateOrderRes> {
  const held = await withTxRetry(() =>
    db.transaction(async (tx) => {
      const need = await lockNeed(tx, req.needId);
      if (!need || need.status === "draft") throw notFound("Need");
      if (!isDonatable(need.status)) return { full: true as const, need };

      // Holds MUST be read in a separate statement after the lock is granted: under READ COMMITTED
      // each statement gets a fresh snapshot, so this sees holds committed by the donor we waited for.
      // (Folding it into the locking SELECT would read a pre-lock snapshot and could double-book.)
      const remaining = remainingCents({
        targetCents: need.targetCents,
        fundedCents: need.fundedCents,
        heldCents: await heldCents(tx, need.id),
      });
      const clamped = clampDonation(req.amountCents, remaining);
      if (!clamped) return { full: true as const, need };

      const [reservation] = await tx
        .insert(reservations)
        .values({
          needId: need.id,
          amountCents: clamped.amountCents,
          rollOverConsent: req.rollOverConsent,
          expiresAt: sql`now() + (${holdSeconds}::int * interval '1 second')`,
          status: "active",
        })
        .returning();
      return { full: false as const, need, reservation: reservation!, wasClamped: clamped.wasClamped };
    }),
  );

  if (held.full) {
    const nextNeed = await getNextMostUrgentNeed(held.need.orgId, held.need.id);
    throw new HttpError(409, "FULLY_FUNDED", "This item is already fully funded", { nextNeed });
  }

  const { need, reservation } = held;
  let orderId: string;
  try {
    ({ orderId } = await ordersGateway().createOrder({
      reservationId: reservation.id,
      needId: need.id,
      title: need.title,
      amountCents: reservation.amountCents,
    }));
  } catch (err) {
    // No PayPal order → give the money room back immediately.
    await db.update(reservations).set({ status: "released" }).where(eq(reservations.id, reservation.id));
    await publishNeedUpdated(need.id);
    throw err;
  }

  await db.update(reservations).set({ paypalOrderId: orderId }).where(eq(reservations.id, reservation.id));
  await publishNeedUpdated(need.id); // other screens now show the amount on hold

  return CreateOrderRes.parse({
    orderId,
    amountCents: reservation.amountCents,
    wasClamped: held.wasClamped,
    holdExpiresAt: reservation.expiresAt.toISOString(),
  });
}

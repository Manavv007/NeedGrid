/**
 * Deliveries (AGENT_A_BACKEND.md §7.2). B's delivery route runs the AI photo check, then calls these.
 *
 * recordDelivery: need must be `ordered`. A delivery that passed the check makes the need `delivered`;
 *   one that needs review leaves it `ordered` until staff confirm (or upload a better photo).
 * confirmDelivery: staff approve a delivery. message: undefined = keep the stored one, "" = no donor message (null),
 *   otherwise the staff's text as-is.
 */
import type { DeliveryView } from "@needgrid/shared";
import { type NeedCard } from "@needgrid/shared";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { deliveries, needs } from "../db/schema";
import { assertCloudinaryUrl, HttpError, invalidState, notFound } from "../lib/http";
import { lockNeed, withTxRetry } from "../money/ledger";
import { getNeedCard, publishNeedUpdated, toDeliveryView } from "./needs";

const MAX_TEXT = 1000;

export async function recordDelivery(input: {
  needId: string;
  photoUrl: string;
  matchScore: number;
  aiNotes: string;
  needsReview: boolean;
  message: string | null;
}): Promise<{ delivery: DeliveryView; need: NeedCard }> {
  assertCloudinaryUrl(input.photoUrl);
  if (!Number.isFinite(input.matchScore) || input.matchScore < 0 || input.matchScore > 1) {
    throw new HttpError(400, "VALIDATION", "matchScore must be between 0 and 1");
  }
  const message = input.message?.trim() ? input.message.trim().slice(0, MAX_TEXT) : null;

  const row = await withTxRetry(() =>
    db.transaction(async (tx) => {
      const need = await lockNeed(tx, input.needId);
      if (!need) throw notFound("Need");
      if (need.status !== "ordered") {
        throw invalidState(`Only an ordered need can be marked delivered (this one is ${need.status})`);
      }
      const [d] = await tx
        .insert(deliveries)
        .values({
          needId: need.id,
          photoUrl: input.photoUrl,
          matchScore: input.matchScore,
          aiNotes: input.aiNotes.slice(0, MAX_TEXT),
          needsReview: input.needsReview,
          message,
        })
        .returning();
      if (!input.needsReview) {
        await tx
          .update(needs)
          .set({ status: "delivered", deliveredAt: sql`clock_timestamp()` })
          .where(eq(needs.id, need.id));
      }
      return d!;
    }),
  );

  await publishNeedUpdated(row.needId);
  return { delivery: toDeliveryView(row), need: (await getNeedCard(row.needId))! };
}

export async function confirmDelivery(
  deliveryId: string,
  orgId: string,
  message?: string,
): Promise<{ delivery: DeliveryView; need: NeedCard }> {
  const row = await withTxRetry(() =>
    db.transaction(async (tx) => {
      const [d] = await tx.select().from(deliveries).where(eq(deliveries.id, deliveryId)).for("update");
      if (!d) throw notFound("Delivery");
      const need = await lockNeed(tx, d.needId);
      if (!need || need.orgId !== orgId) throw notFound("Delivery");
      if (need.status !== "ordered" && need.status !== "delivered") {
        throw invalidState(`This need is ${need.status}, so its delivery can't be confirmed`);
      }

      const updates: Partial<typeof deliveries.$inferInsert> = {};
      if (!d.confirmedAt) updates.confirmedAt = sql`clock_timestamp()` as unknown as Date;
      if (message !== undefined) updates.message = message.trim() ? message.trim().slice(0, MAX_TEXT) : null;
      const [updated] =
        Object.keys(updates).length > 0
          ? await tx.update(deliveries).set(updates).where(eq(deliveries.id, d.id)).returning()
          : [d];

      if (need.status === "ordered") {
        await tx
          .update(needs)
          .set({ status: "delivered", deliveredAt: sql`clock_timestamp()` })
          .where(eq(needs.id, need.id));
      }
      return updated!;
    }),
  );

  await publishNeedUpdated(row.needId);
  return { delivery: toDeliveryView(row), need: (await getNeedCard(row.needId))! };
}

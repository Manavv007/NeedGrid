/**
 * Donor refunds (AGENT_A_BACKEND.md §8.8): what runs when staff approve a create_refund action.
 *
 *   check (inside the approve transaction, donation row locked): every stored part must still be exactly what it
 *     was at propose time, and no other refund of this donation may be running. Otherwise nothing happens.
 *   refund at PayPal (outside any transaction), request id `refund-<actionId>`.
 *   apply (one transaction with the final action status): negative `refund` allocations, unallocated money
 *     cleared, refunded_cents raised, need statuses refreshed (a funded need can drop back to open).
 *
 * Money on ordered/delivered needs has been spent and is never refundable.
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Executor } from "../core/needs";
import { db } from "../db/client";
import { agentActions, allocations, donations, needs } from "../db/schema";
import { allocate, lockNeed } from "./ledger";
import { AMOUNTS_CHANGED } from "./invoices";

export const REFUNDABLE_NEED_STATUSES = ["open", "topping_up", "funded"];

export const RefundPart = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unallocated"), cents: z.number().int().positive() }),
  z.object({
    kind: z.literal("need"),
    needId: z.uuid(),
    title: z.string().optional(),
    cents: z.number().int().positive(),
  }),
]);
export type RefundPart = z.infer<typeof RefundPart>;

export const RefundComputed = z.object({
  refundCents: z.number().int().positive(),
  captureId: z.string().optional(), // system proposals (overflow with no consent) don't store it
  parts: z.array(RefundPart).min(1),
});
export type RefundComputed = z.infer<typeof RefundComputed>;

/**
 * Refundable = unallocated money + the donation's net share of needs not yet bought (open/topping_up/funded).
 * Invoice donations are refunded by the sponsor-invoice flow, not here.
 */
export async function refundableParts(donationId: string, ex: Executor = db) {
  const [don] = await ex.select().from(donations).where(eq(donations.id, donationId)).limit(1);
  if (!don) return null;
  const perNeed = await ex
    .select({
      needId: allocations.needId,
      title: needs.title,
      status: needs.status,
      cents: sql<number>`sum(${allocations.amountCents})::int`,
    })
    .from(allocations)
    .innerJoin(needs, eq(needs.id, allocations.needId))
    .where(eq(allocations.donationId, donationId))
    .groupBy(allocations.needId, needs.title, needs.status)
    .having(sql`sum(${allocations.amountCents}) > 0`);
  const fromNeeds = perNeed
    .filter((p) => REFUNDABLE_NEED_STATUSES.includes(p.status))
    .map((p) => ({ kind: "need" as const, needId: p.needId, title: p.title, cents: p.cents }));
  const parts = [
    ...(don.unallocatedCents > 0 ? [{ kind: "unallocated" as const, cents: don.unallocatedCents }] : []),
    ...fromNeeds,
  ];
  return { donation: don, parts, refundCents: parts.reduce((s, p) => s + p.cents, 0) };
}

type Checked = { ok: true; captureId: string } | { ok: false; error: string };

/** Inside the approve transaction. Locks the donation row, so two approvals of the same donation take turns. */
export async function checkRefund(
  tx: Executor,
  p: { orgId: string; actionId: string; donationId: string; computed: RefundComputed },
): Promise<Checked> {
  const [don] = await tx.select().from(donations).where(eq(donations.id, p.donationId)).for("update");
  if (!don || don.orgId !== p.orgId) return { ok: false, error: "No such donation for this charity." };
  if (don.source !== "order" || !don.captureId) {
    return { ok: false, error: "Only PayPal checkout donations can be refunded here." };
  }
  if (p.computed.captureId && p.computed.captureId !== don.captureId) return { ok: false, error: AMOUNTS_CHANGED };

  const [running] = await tx
    .select({ id: agentActions.id })
    .from(agentActions)
    .where(
      and(
        eq(agentActions.tool, "create_refund"),
        eq(agentActions.status, "approved"),
        ne(agentActions.id, p.actionId),
        sql`${agentActions.args}->>'donationId' = ${p.donationId}`,
      ),
    )
    .limit(1);
  if (running) return { ok: false, error: "Another refund of this donation is still running; try again in a minute." };

  const { parts, refundCents } = p.computed;
  if (parts.reduce((s, x) => s + x.cents, 0) !== refundCents) return { ok: false, error: AMOUNTS_CHANGED };
  if (refundCents > don.amountCents - don.refundedCents) return { ok: false, error: AMOUNTS_CHANGED };

  const now = await refundableParts(don.id, tx);
  if (!now) return { ok: false, error: "No such donation for this charity." };
  for (const part of parts) {
    const current =
      part.kind === "unallocated"
        ? now.donation.unallocatedCents
        : (now.parts.find((x) => x.kind === "need" && x.needId === part.needId)?.cents ?? 0);
    if (current !== part.cents) return { ok: false, error: AMOUNTS_CHANGED };
  }
  return { ok: true, captureId: don.captureId };
}

/** The donation's current net per need, largest first (to cover a shortfall deterministically). */
async function netPerNeed(tx: Executor, donationId: string) {
  return tx
    .select({ needId: allocations.needId, net: sql<number>`sum(${allocations.amountCents})::int` })
    .from(allocations)
    .where(eq(allocations.donationId, donationId))
    .groupBy(allocations.needId)
    .having(sql`sum(${allocations.amountCents}) > 0`)
    .orderBy(sql`sum(${allocations.amountCents}) desc`, allocations.needId);
}

/**
 * Record a refund PayPal has already made. Runs after PayPal said yes, so it must always balance: if some of the
 * money moved between approval and now (e.g. a price drop took part of this donation's share to another need),
 * the shortfall is taken from the donation's other allocations, then from its unallocated money.
 * Returns the needs whose numbers changed.
 */
export async function applyRefund(
  tx: Executor,
  p: { donationId: string; parts: RefundPart[]; refundCents: number },
): Promise<string[]> {
  const [don] = await tx.select().from(donations).where(eq(donations.id, p.donationId)).for("update");
  if (!don) throw new Error(`applyRefund: donation ${p.donationId} not found`);
  const touched = new Set<string>();
  let unallocated = don.unallocatedCents;
  let shortfall = 0;

  const takeFromNeed = async (needId: string, wanted: number) => {
    await lockNeed(tx, needId);
    const net = (await netPerNeed(tx, don.id)).find((n) => n.needId === needId)?.net ?? 0;
    const take = Math.min(wanted, net);
    if (take > 0) {
      await allocate(tx, { donationId: don.id, needId, cents: -take, reason: "refund" });
      touched.add(needId);
    }
    return take;
  };

  for (const part of p.parts) {
    if (part.kind === "unallocated") {
      const take = Math.min(part.cents, unallocated);
      unallocated -= take;
      shortfall += part.cents - take;
    } else {
      shortfall += part.cents - (await takeFromNeed(part.needId, part.cents));
    }
  }
  if (shortfall > 0) {
    for (const n of await netPerNeed(tx, don.id)) {
      if (shortfall === 0) break;
      shortfall -= await takeFromNeed(n.needId, shortfall);
    }
  }
  if (shortfall > 0) {
    const take = Math.min(shortfall, unallocated);
    unallocated -= take;
    shortfall -= take;
  }
  if (shortfall > 0) throw new Error(`applyRefund: ${shortfall} cents of the refund couldn't be matched to money`);

  const refunded = don.refundedCents + p.refundCents;
  await tx
    .update(donations)
    .set({
      unallocatedCents: unallocated,
      refundedCents: refunded,
      status: refunded >= don.amountCents ? "refunded" : "partially_refunded",
    })
    .where(eq(donations.id, don.id));
  return [...touched];
}

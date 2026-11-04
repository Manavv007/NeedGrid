/**
 * Roll-over (AGENT_A_BACKEND.md §8.8): a need whose deadline passed before it was fully funded is closed, and
 * the money on it is never left stranded.
 *
 * For each such need (open/topping_up, deadline_at < now(), funded < target), in ONE transaction:
 *   per donation with money on it:
 *     roll-over consent → take it off (− rollover) and give it to the org's most urgent open needs (+ rollover,
 *                         paired with related_allocation_id); what doesn't fit becomes unallocated
 *     no consent        → take it off and set it aside as unallocated
 *   unallocated money of a PayPal checkout donation → a system create_refund PROPOSAL (staff still approve it)
 *   proposed/approved purchases of the need → superseded; the need → closed (closed_at)
 *
 * Runs every 10 minutes in the server and on demand with `pnpm --filter @needgrid/api job:rollover`.
 * Safe to run twice: a closed need is never picked again.
 */
import type { FastifyBaseLogger } from "fastify";
import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { publishNeedUpdated, type Executor } from "../core/needs";
import { db } from "../db/client";
import { agentActions, allocations, donations, needs, purchases } from "../db/schema";
import { allocate, distribute, lockNeed, withTxRetry } from "../money/ledger";
import { proposeSystemRefund } from "../money/refundProposal";

export interface RolloverResult {
  needId: string;
  title: string;
  /** Money moved to other needs. */
  movedCents: number;
  /** Money set aside (unallocated) because the donor didn't consent or nothing else needed it. */
  setAsideCents: number;
  /** System refund proposals created (still need staff approval). */
  refundProposals: number;
}

/** Needs whose deadline passed without being fully funded. */
async function expiredNeedIds(): Promise<string[]> {
  const rows = await db
    .select({ id: needs.id })
    .from(needs)
    .where(
      and(
        inArray(needs.status, ["open", "topping_up"]),
        isNotNull(needs.deadlineAt),
        lt(needs.deadlineAt, sql`now()`),
        lt(needs.fundedCents, needs.targetCents),
      ),
    )
    .orderBy(needs.deadlineAt)
    .limit(50);
  return rows.map((r) => r.id);
}

/**
 * One refund proposal per donation for ALL its unallocated money. Older proposed system refunds of that donation
 * are marked failed (approving them would fail anyway, because the unallocated amount changed).
 */
async function reproposeRefund(tx: Executor, orgId: string, donationId: string, unallocatedCents: number) {
  await tx
    .update(agentActions)
    .set({ status: "failed", error: "Replaced by a newer refund proposal for this donation.", decidedAt: sql`now()` })
    .where(
      and(
        eq(agentActions.tool, "create_refund"),
        eq(agentActions.origin, "system"),
        eq(agentActions.status, "proposed"),
        sql`${agentActions.args}->>'donationId' = ${donationId}`,
      ),
    );
  await proposeSystemRefund(tx, {
    orgId,
    donationId,
    refundCents: unallocatedCents,
    reason: "The item's deadline passed before it was fully funded",
  });
}

async function rollOverNeed(needId: string): Promise<{ result: RolloverResult | null; touched: string[] }> {
  const touched = new Set<string>();
  const result = await withTxRetry(() =>
    db.transaction(async (tx) => {
      touched.clear();
      const need = await lockNeed(tx, needId);
      // Re-check under the lock: someone may have funded or closed it since the scan.
      if (
        !need ||
        !["open", "topping_up"].includes(need.status) ||
        !need.deadlineAt ||
        need.fundedCents >= need.targetCents
      ) {
        return null;
      }
      const [stillExpired] = await tx
        .select({ id: needs.id })
        .from(needs)
        .where(and(eq(needs.id, need.id), lt(needs.deadlineAt, sql`now()`)));
      if (!stillExpired) return null;
      touched.add(need.id);

      const shares = await tx
        .select({
          donationId: allocations.donationId,
          net: sql<number>`sum(${allocations.amountCents})::int`,
        })
        .from(allocations)
        .where(eq(allocations.needId, need.id))
        .groupBy(allocations.donationId)
        .having(sql`sum(${allocations.amountCents}) > 0`)
        .orderBy(allocations.donationId);

      let movedCents = 0;
      let setAsideCents = 0;
      let refundProposals = 0;
      for (const share of shares) {
        const [don] = await tx.select().from(donations).where(eq(donations.id, share.donationId)).for("update");
        if (!don) continue;
        const outId = await allocate(tx, {
          donationId: don.id,
          needId: need.id,
          cents: -share.net,
          reason: "rollover",
        });
        let leftover = share.net;
        if (don.rollOverConsent) {
          const placed = await distribute(tx, {
            donationId: don.id,
            orgId: need.orgId,
            cents: share.net,
            reason: "rollover",
            excludeNeedId: need.id,
            relatedAllocationId: outId,
          });
          placed.needIds.forEach((id) => touched.add(id));
          movedCents += share.net - placed.leftoverCents;
          leftover = placed.leftoverCents;
        }
        if (leftover > 0) {
          const unallocated = don.unallocatedCents + leftover;
          await tx.update(donations).set({ unallocatedCents: unallocated }).where(eq(donations.id, don.id));
          setAsideCents += leftover;
          // Only PayPal checkout donations can be refunded by the create_refund executor.
          if (don.source === "order" && don.captureId) {
            await reproposeRefund(tx, need.orgId, don.id, unallocated);
            refundProposals++;
          }
        }
      }

      await tx
        .update(purchases)
        .set({ status: "superseded" })
        .where(and(eq(purchases.needId, need.id), inArray(purchases.status, ["proposed", "approved"])));
      await tx
        .update(needs)
        .set({ status: "closed", closedAt: sql`clock_timestamp()` })
        .where(eq(needs.id, need.id));
      return { needId: need.id, title: need.title, movedCents, setAsideCents, refundProposals };
    }),
  );
  return { result, touched: [...touched] };
}

/** Roll over every expired need (max 50 per run). Returns what happened to each. */
export async function rollOverExpiredNeeds(): Promise<RolloverResult[]> {
  const out: RolloverResult[] = [];
  for (const id of await expiredNeedIds()) {
    const { result, touched } = await rollOverNeed(id);
    if (result) out.push(result);
    for (const t of touched) await publishNeedUpdated(t);
  }
  return out;
}

/** Runs every `intervalMs` (never two runs at once). Returns a stop function. */
export function startRolloverJob(log: FastifyBaseLogger, intervalMs = 10 * 60_000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    rollOverExpiredNeeds()
      .then((done) => {
        if (done.length > 0) log.info({ rolledOver: done }, "rolled over expired needs");
      })
      .catch((err: unknown) => log.error({ err }, "roll-over failed"))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

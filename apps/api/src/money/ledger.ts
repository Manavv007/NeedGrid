/**
 * Ledger primitives. Every function here runs INSIDE the caller's transaction.
 *
 * The allocations table is the single record of which item each dollar paid for:
 * `allocate` is the only code that changes needs.funded_cents, and it inserts the
 * matching allocation row in the same transaction (money invariant 4).
 */
import type { AllocationReason, NeedStatus } from "@needgrid/shared";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { listDonatableNeeds, type Executor } from "../core/needs";
import { allocations, needs, reservations, type NeedRow } from "../db/schema";

export const DONATABLE: readonly NeedStatus[] = ["open", "topping_up"];

export const isDonatable = (status: string) => (DONATABLE as readonly string[]).includes(status);

/** SELECT … FOR UPDATE on one need. Callers that lock several needs must expect deadlock retries. */
export async function lockNeed(tx: Executor, needId: string): Promise<NeedRow | undefined> {
  const [need] = await tx.select().from(needs).where(eq(needs.id, needId)).for("update");
  return need;
}

/** Active, unexpired holds on a need (optionally excluding one reservation). Uses the database clock. */
export async function heldCents(tx: Executor, needId: string, excludeReservationId?: string): Promise<number> {
  const conditions = [
    eq(reservations.needId, needId),
    eq(reservations.status, "active"),
    gt(reservations.expiresAt, sql`now()`),
  ];
  if (excludeReservationId) conditions.push(ne(reservations.id, excludeReservationId));
  const [row] = await tx
    .select({ held: sql<number>`coalesce(sum(${reservations.amountCents}), 0)::int` })
    .from(reservations)
    .where(and(...conditions));
  return row?.held ?? 0;
}

/** Room left on a locked need: target − funded − holds (0 unless it accepts donations). */
export async function roomCents(tx: Executor, need: NeedRow, excludeReservationId?: string): Promise<number> {
  if (!isDonatable(need.status)) return 0;
  const held = await heldCents(tx, need.id, excludeReservationId);
  return Math.max(0, need.targetCents - need.fundedCents - held);
}

/**
 * open/topping_up and funded ≥ target → funded (sets funded_at once).
 * funded and funded < target (e.g. after a refund) → open.
 * Never touches draft/ordered/delivered/closed.
 */
export async function refreshNeedStatus(tx: Executor, need: NeedRow): Promise<NeedStatus> {
  const status = need.status as NeedStatus;
  if (isDonatable(status) && need.targetCents > 0 && need.fundedCents >= need.targetCents) {
    // Database clock (same as allocations.created_at), so timelines order correctly.
    await tx
      .update(needs)
      .set({ status: "funded", fundedAt: sql`coalesce(${needs.fundedAt}, clock_timestamp())` })
      .where(eq(needs.id, need.id));
    return "funded";
  }
  if (status === "funded" && need.fundedCents < need.targetCents) {
    await tx.update(needs).set({ status: "open" }).where(eq(needs.id, need.id));
    return "open";
  }
  return status;
}

/** Insert one allocation row and move funded_cents by the same amount (signed). Returns the allocation id. */
export async function allocate(
  tx: Executor,
  a: { donationId: string; needId: string; cents: number; reason: AllocationReason; relatedAllocationId?: string },
): Promise<string> {
  if (!Number.isSafeInteger(a.cents) || a.cents === 0) throw new Error(`allocate: invalid cents ${a.cents}`);
  const [row] = await tx
    .insert(allocations)
    .values({
      donationId: a.donationId,
      needId: a.needId,
      amountCents: a.cents,
      reason: a.reason,
      relatedAllocationId: a.relatedAllocationId,
      // now() is fixed for the whole transaction; clock_timestamp() keeps placement order
      // when one capture creates several allocations (direct, then overflow to need 1, need 2…).
      createdAt: sql`clock_timestamp()`,
    })
    .returning({ id: allocations.id });
  const [need] = await tx
    .update(needs)
    .set({ fundedCents: sql`${needs.fundedCents} + ${a.cents}` })
    .where(eq(needs.id, a.needId))
    .returning();
  if (!need) throw new Error(`allocate: need ${a.needId} not found`);
  await refreshNeedStatus(tx, need);
  return row!.id;
}

/**
 * Give `cents` of a donation to the org's most urgent donatable needs (max 10), filling each
 * up to its room. Holds of other donors are respected. Returns what couldn't be placed.
 */
export async function distribute(
  tx: Executor,
  d: { donationId: string; orgId: string; cents: number; reason: AllocationReason; excludeNeedId?: string },
): Promise<{ leftoverCents: number; needIds: string[] }> {
  let left = d.cents;
  const touched: string[] = [];
  const candidates = await listDonatableNeeds({ orgId: d.orgId, excludeNeedId: d.excludeNeedId, limit: 10 }, tx);
  for (const candidate of candidates) {
    if (left === 0) break;
    const need = await lockNeed(tx, candidate.id);
    if (!need) continue;
    const give = Math.min(left, await roomCents(tx, need));
    if (give <= 0) continue;
    await allocate(tx, { donationId: d.donationId, needId: need.id, cents: give, reason: d.reason });
    touched.push(need.id);
    left -= give;
  }
  return { leftoverCents: left, needIds: touched };
}

// ---------------------------------------------------------------------------------------------

/** Postgres error code of a failed query (drizzle wraps the driver error in `cause`). */
export function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  const code = e?.cause?.code ?? e?.code;
  return typeof code === "string" ? code : undefined;
}

const RETRYABLE = new Set(["40P01" /* deadlock_detected */, "40001" /* serialization_failure */]);

/**
 * Re-run a whole transaction when Postgres aborts it for a deadlock (possible when two
 * overflows lock the same needs in different orders). The function must be safe to repeat.
 */
export async function withTxRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const code = pgErrorCode(err);
      if (!code || !RETRYABLE.has(code) || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 25 * i + Math.floor(Math.random() * 50)));
    }
  }
}

/**
 * Release expired donation holds and push the change to open tile walls.
 *
 * Correctness never depends on this job: every read already ignores holds with expires_at <= now().
 * It exists so that bars on other screens move back when a donor abandons checkout (Render's free
 * plan sleeps, so it may not run for a while; that only delays the visual update).
 *
 * Sponsor-invoice holds (Phase 9) are not touched: they last until the invoice is paid or cancelled.
 */
import type { FastifyBaseLogger } from "fastify";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { publishNeedUpdated } from "../core/needs";
import { db } from "../db/client";
import { reservations } from "../db/schema";

/** Returns the number of holds released. */
export async function releaseExpiredHolds(): Promise<number> {
  const rows = await db
    .update(reservations)
    .set({ status: "released" })
    .where(
      and(
        eq(reservations.status, "active"),
        lt(reservations.expiresAt, sql`now()`),
        isNull(reservations.sponsorInvoiceId),
      ),
    )
    .returning({ needId: reservations.needId });
  for (const needId of new Set(rows.map((r) => r.needId))) await publishNeedUpdated(needId);
  return rows.length;
}

/** Runs every `intervalMs` (never two runs at once). Returns a stop function. */
export function startHoldReleaser(log: FastifyBaseLogger, intervalMs = 60_000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    releaseExpiredHolds()
      .then((n) => {
        if (n > 0) log.info({ released: n }, "released expired donation holds");
      })
      .catch((err: unknown) => log.error({ err }, "releasing expired holds failed"))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref(); // never keeps the process alive on its own
  return () => clearInterval(timer);
}

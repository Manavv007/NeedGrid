/**
 * System-originated refund proposals (money that has nowhere to go).
 *
 * Like every money action this only creates an `agent_actions` row with status "proposed":
 * nothing is sent to PayPal until a staff member approves it (executor arrives in Phase 10).
 * Runs inside the caller's transaction.
 */
import { CreateRefundArgs, formatUsd, type ActionPreview } from "@needgrid/shared";
import type { Executor } from "../core/needs";
import { agentActions } from "../db/schema";

export async function proposeSystemRefund(
  tx: Executor,
  p: { orgId: string; donationId: string; refundCents: number; reason: string },
): Promise<string> {
  const args = CreateRefundArgs.parse({ donationId: p.donationId, reason: p.reason });
  const preview: ActionPreview = {
    title: `Refund ${formatUsd(p.refundCents)} to a donor`,
    lines: [
      { label: "Donation", value: p.donationId },
      { label: "Reason", value: p.reason },
      { label: "Refund amount (computed by NeedGrid)", value: formatUsd(p.refundCents) },
    ],
    totalCents: p.refundCents,
  };
  const [row] = await tx
    .insert(agentActions)
    .values({
      orgId: p.orgId,
      tool: "create_refund",
      args,
      computed: { refundCents: p.refundCents, parts: [{ kind: "unallocated", cents: p.refundCents }] },
      preview,
      status: "proposed",
      origin: "system",
    })
    .returning({ id: agentActions.id });
  return row!.id;
}

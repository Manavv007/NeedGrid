import type { AgentAction } from "@needgrid/shared";
import { useIsMutating, useMutationState, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ApiClientError } from "@/lib/api";
import { decideActionKey, refreshActions, useDecideAction, type ActionDecision } from "@/lib/queries";
import { errorMessage } from "../staff/errorMessage";
import { invoiceFromResult } from "./actionText";

/**
 * Actions this tab has sent a decision for, per query client. Checked and set before anything
 * renders, so a double click, the same action's other card (inline and in the pending list) or a
 * re-render can never send a second approve or reject. An id is released only when the request
 * failed in a way worth retrying (network, server error); once the server has answered with a
 * decision (or said it's already decided), it stays blocked.
 */
const sent = new WeakMap<QueryClient, Set<string>>();

function sentFor(queryClient: QueryClient): Set<string> {
  let ids = sent.get(queryClient);
  if (!ids) {
    ids = new Set();
    sent.set(queryClient, ids);
  }
  return ids;
}

const isDecision = (value: unknown): value is ActionDecision => value === "approve" || value === "reject";

function toastOutcome(action: AgentAction): void {
  switch (action.status) {
    case "executed": {
      const invoice = invoiceFromResult(action);
      if (!invoice) toast.success("Approved. NeedGrid carried it out.");
      else if (invoice.status === "draft") toast.success("Invoice saved as a draft.");
      else toast.success(`Invoice sent to ${invoice.recipientEmail}.`);
      return;
    }
    case "failed":
      toast.error("Didn't go through", { description: action.error ?? undefined });
      return;
    case "rejected":
      toast.success("Rejected. Nothing was sent.");
      return;
    case "approved":
      toast("Approved. NeedGrid is finishing it now…");
      return;
    case "proposed":
      return;
  }
}

/**
 * Approve or reject one action, exactly once. Every card for the action sees the same pending state
 * (and which button was pressed). A `409 INVALID_STATE` means it was decided elsewhere: the actions
 * are refetched so the card shows what really happened, with one quiet note instead of an error.
 */
export function useActionDecision(action: AgentAction) {
  const queryClient = useQueryClient();
  const mutation = useDecideAction(action.id);
  const running = useIsMutating({ mutationKey: decideActionKey(action.id) });
  const [pendingDecision = null] = useMutationState({
    filters: { mutationKey: decideActionKey(action.id), status: "pending" },
    select: (m) => (isDecision(m.state.variables) ? m.state.variables : null),
  });
  const [problem, setProblem] = useState<string | null>(null);

  async function decide(decision: ActionDecision): Promise<void> {
    const ids = sentFor(queryClient);
    if (ids.has(action.id) || action.status !== "proposed") return;
    ids.add(action.id);
    setProblem(null);
    try {
      const { action: decided } = await mutation.mutateAsync(decision);
      toastOutcome(decided);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "INVALID_STATE") {
        await refreshActions(queryClient);
        toast("This was already decided, so here is what happened.", { id: `decided-${action.id}` });
        return;
      }
      // Nothing was decided (or we can't tell): the server only runs a proposed action once, so
      // trying again is safe.
      ids.delete(action.id);
      const text = errorMessage(error, "We couldn't send your decision. Please try again.");
      setProblem(text);
      toast.error(text, { id: `decision-${action.id}` });
    }
  }

  return { decide, pending: running > 0, pendingDecision, problem };
}

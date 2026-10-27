/**
 * The ONLY write API that B's code (apps/api/src/ai, scripts/seed) may use.
 * Signatures are a contract (AGENT_A_BACKEND.md §7.2): don't change them without telling B.
 *
 * Status (Phase 1): every function is a stub that throws "not implemented". B codes against
 * these signatures and mocks them in tests. A fills them in:
 *   Phase 2 (Wed Oct 28): getNeedCard(s), listDonatableNeeds, getNextMostUrgentNeed, setNeedEmbedding
 *   Phase 3 (Thu Oct 29): publishNeedUpdated
 *   Phase 6 (Mon Nov 2):  createProposedPurchase
 *   Phase 7 (Tue Nov 3):  recordDelivery, confirmDelivery, proposeAction, listPayPalTransactions, listRecordedDonations
 */
import type { AgentAction, DeliveryView, MoneyTool, NeedCard, PurchaseOffer, PurchaseView } from "@needgrid/shared";

function notImplemented(name: string): never {
  throw new Error(`not implemented: core.${name}`);
}

export async function getNeedCard(_needId: string): Promise<NeedCard | null> {
  return notImplemented("getNeedCard");
}

export async function getNeedCards(_needIds: string[]): Promise<NeedCard[]> {
  return notImplemented("getNeedCards");
}

/** Open/topping_up needs with remainingCents > 0, most urgent first. orgId undefined = all orgs. */
export async function listDonatableNeeds(_opts: { orgId?: string; limit?: number }): Promise<NeedCard[]> {
  return notImplemented("listDonatableNeeds");
}

export async function getNextMostUrgentNeed(_orgId: string, _excludeNeedId?: string): Promise<NeedCard | null> {
  return notImplemented("getNextMostUrgentNeed");
}

/** 768 dimensions. */
export async function setNeedEmbedding(_needId: string, _embedding: number[]): Promise<void> {
  return notImplemented("setNeedEmbedding");
}

/** Inserts a purchases row (status proposed) and marks older proposed rows for that need `superseded`. Need must be `funded`. Computes newTargetCents itself. */
export async function createProposedPurchase(_input: {
  needId: string;
  offer: PurchaseOffer;
  explanation: string;
  flags: string[];
}): Promise<PurchaseView> {
  return notImplemented("createProposedPurchase");
}

/** Inserts a delivery row. If !needsReview → need becomes `delivered` (+ delivered_at) and SSE is published. Need must be `ordered`. */
export async function recordDelivery(_input: {
  needId: string;
  photoUrl: string;
  matchScore: number;
  aiNotes: string;
  needsReview: boolean;
  message: string | null;
}): Promise<{ delivery: DeliveryView; need: NeedCard }> {
  return notImplemented("recordDelivery");
}

export async function confirmDelivery(
  _deliveryId: string,
  _orgId: string,
  _message?: string,
): Promise<{ delivery: DeliveryView; need: NeedCard }> {
  return notImplemented("confirmDelivery");
}

/**
 * Validates args with MONEY_TOOL_ARGS[tool], checks every referenced id belongs to orgId, computes amounts
 * into `computed`, builds `preview`, inserts agent_actions (status proposed). NEVER calls PayPal. Throws HttpError on bad input.
 */
export async function proposeAction(_input: {
  orgId: string;
  tool: MoneyTool;
  args: unknown;
  origin: "assistant" | "system";
}): Promise<AgentAction> {
  return notImplemented("proposeAction");
}

/** Read-only PayPal Transaction Search for the reconcile tool. Max 31-day window (PayPal limit). */
export async function listPayPalTransactions(_input: { start: Date; end: Date }): Promise<
  Array<{
    transactionId: string;
    status: string;
    amountCents: number;
    currency: string;
    at: string;
    invoiceId: string | null;
    customField: string | null;
    eventCode: string;
  }>
> {
  return notImplemented("listPayPalTransactions");
}

/** Donations recorded by us in a window (for reconcile). Excludes source = "seed". */
export async function listRecordedDonations(_input: { orgId: string; start: Date; end: Date }): Promise<
  Array<{
    donationId: string;
    captureId: string | null;
    paypalInvoiceId: string | null;
    amountCents: number;
    at: string;
  }>
> {
  return notImplemented("listRecordedDonations");
}

/** SSE fan-out of the need's current NeedCard to every open tile wall. */
export async function publishNeedUpdated(_needId: string): Promise<void> {
  return notImplemented("publishNeedUpdated");
}

export { findOrgByStaffKeyHash } from "./orgs";
export { db } from "../db/client";
export * as schema from "../db/schema";

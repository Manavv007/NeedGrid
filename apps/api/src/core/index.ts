/**
 * The ONLY write API that B's code (apps/api/src/ai, scripts/seed) may use.
 * Signatures are a contract (AGENT_A_BACKEND.md §7.2): don't change them without telling B.
 *
 * Status:
 *   Implemented (Phase 2): getNeedCard, getNeedCards, listDonatableNeeds, getNextMostUrgentNeed,
 *                          setNeedEmbedding, publishNeedUpdated (in-process fan-out; SSE route in Phase 3)
 *   Stubs that throw "not implemented" until:
 *     Phase 6 (Mon Nov 2): createProposedPurchase
 *     Phase 7 (Tue Nov 3): recordDelivery, confirmDelivery, proposeAction, listPayPalTransactions, listRecordedDonations
 */
import type { AgentAction, DeliveryView, MoneyTool, NeedCard, PurchaseOffer, PurchaseView } from "@needgrid/shared";
import * as needsCore from "./needs";

function notImplemented(name: string): never {
  throw new Error(`not implemented: core.${name}`);
}

export async function getNeedCard(needId: string): Promise<NeedCard | null> {
  return needsCore.getNeedCard(needId);
}

/** Cards in the same order as `needIds`; unknown ids are skipped. */
export async function getNeedCards(needIds: string[]): Promise<NeedCard[]> {
  return needsCore.getNeedCards(needIds);
}

/** Open/topping_up needs with remainingCents > 0, most urgent first. orgId undefined = all orgs. */
export async function listDonatableNeeds(opts: { orgId?: string; limit?: number }): Promise<NeedCard[]> {
  return needsCore.listDonatableNeeds({ orgId: opts.orgId, limit: opts.limit });
}

export async function getNextMostUrgentNeed(orgId: string, excludeNeedId?: string): Promise<NeedCard | null> {
  return needsCore.getNextMostUrgentNeed(orgId, excludeNeedId);
}

/** 768 dimensions; throws on any other size or non-finite values. */
export async function setNeedEmbedding(needId: string, embedding: number[]): Promise<void> {
  return needsCore.setNeedEmbedding(needId, embedding);
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

/** SSE fan-out of the need's current NeedCard to every open tile wall. Never throws. */
export async function publishNeedUpdated(needId: string): Promise<void> {
  return needsCore.publishNeedUpdated(needId);
}

export { findOrgByStaffKeyHash } from "./orgs";
export { db } from "../db/client";
export * as schema from "../db/schema";

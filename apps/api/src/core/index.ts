/**
 * The ONLY write API that B's code (apps/api/src/ai, scripts/seed) may use.
 * Signatures are a contract (AGENT_A_BACKEND.md §7.2): don't change them without telling B.
 *
 * Status: every function is implemented. Approve/reject/execute of proposed actions are staff-only HTTP routes
 * (routes/actions.ts → agent/executors.ts) and are deliberately NOT exported here: the assistant can only propose.
 */
import type { AgentAction, DeliveryView, MoneyTool, NeedCard, PurchaseOffer, PurchaseView } from "@needgrid/shared";
import * as actionsCore from "../agent/actions";
import * as purchasesCore from "../money/purchases";
import { transactionsGateway } from "../paypal/transactions";
import * as deliveriesCore from "./deliveries";
import * as needsCore from "./needs";
import * as recordsCore from "./records";

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
export async function createProposedPurchase(input: {
  needId: string;
  offer: PurchaseOffer;
  explanation: string;
  flags: string[];
}): Promise<PurchaseView> {
  return purchasesCore.createProposedPurchase(input);
}

/** Inserts a delivery row. If !needsReview → need becomes `delivered` (+ delivered_at) and SSE is published. Need must be `ordered`. */
export async function recordDelivery(input: {
  needId: string;
  photoUrl: string;
  matchScore: number;
  aiNotes: string;
  needsReview: boolean;
  message: string | null;
}): Promise<{ delivery: DeliveryView; need: NeedCard }> {
  return deliveriesCore.recordDelivery(input);
}

/** message: undefined = keep the stored message, "" = no donor message (null), otherwise the staff's text. */
export async function confirmDelivery(
  deliveryId: string,
  orgId: string,
  message?: string,
): Promise<{ delivery: DeliveryView; need: NeedCard }> {
  return deliveriesCore.confirmDelivery(deliveryId, orgId, message);
}

/**
 * Validates args with MONEY_TOOL_ARGS[tool], checks every referenced id belongs to orgId, computes amounts
 * into `computed`, builds `preview`, inserts agent_actions (status proposed). NEVER calls PayPal. Throws HttpError on bad input.
 */
export async function proposeAction(input: {
  orgId: string;
  tool: MoneyTool;
  args: unknown;
  origin: "assistant" | "system";
}): Promise<AgentAction> {
  return actionsCore.proposeAction(input);
}

/** Read-only PayPal Transaction Search for the reconcile tool. Max 31-day window (PayPal limit). Amounts are signed. */
export async function listPayPalTransactions(input: { start: Date; end: Date }): Promise<
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
  return transactionsGateway().list(input);
}

/** Donations recorded by us in a window (for reconcile). Excludes source = "seed". */
export async function listRecordedDonations(input: { orgId: string; start: Date; end: Date }): Promise<
  Array<{
    donationId: string;
    captureId: string | null;
    paypalInvoiceId: string | null;
    amountCents: number;
    at: string;
  }>
> {
  return recordsCore.listRecordedDonations(input);
}

/** SSE fan-out of the need's current NeedCard to every open tile wall. Never throws. */
export async function publishNeedUpdated(needId: string): Promise<void> {
  return needsCore.publishNeedUpdated(needId);
}

export { findOrgByStaffKeyHash } from "./orgs";
export { db } from "../db/client";
export * as schema from "../db/schema";

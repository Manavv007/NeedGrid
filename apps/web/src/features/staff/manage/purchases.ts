/**
 * Words and selectors for the purchase steps. Display only: every amount here is one the server
 * sent (`money`, `surplusMoved`, `gapCents`); nothing is added up or compared to decide money.
 */
import type { ApprovePurchaseRes, PurchasePlanRes, PurchaseView } from "@needgrid/shared";
import { ApiClientError } from "@/lib/api";
import { formatUsd, formatUsdShort } from "@/lib/format";
import { errorMessage } from "../errorMessage";

type PurchaseStatus = PurchaseView["status"];

/** `purchases` arrive newest first, so the first match is the current one. */
function latest(purchases: readonly PurchaseView[], status: PurchaseStatus): PurchaseView | null {
  return purchases.find((p) => p.status === status) ?? null;
}

export const proposedPurchase = (purchases: readonly PurchaseView[]) => latest(purchases, "proposed");
export const approvedPurchase = (purchases: readonly PurchaseView[]) => latest(purchases, "approved");
export const orderedPurchase = (purchases: readonly PurchaseView[]) => latest(purchases, "ordered");

export type PlanMoney = PurchasePlanRes["money"];

/** The primary button: approving a pricier offer also asks donors for the gap (NeedManageStates.dc.html). */
export function approveLabel(money: PlanMoney | null): string {
  return money?.kind === "gap" ? `Approve and ask for ${formatUsdShort(money.cents)} more` : "Approve purchase";
}

/** The toast after approval, built from what the server says it did. */
export function approvalToast(res: ApprovePurchaseRes): string {
  if (res.surplusMoved) {
    return `Approved. ${formatUsd(res.surplusMoved.amountCents)} moved to ${res.surplusMoved.toNeedTitle}.`;
  }
  if (res.gapCents) return `Approved. Donors will be asked for ${formatUsd(res.gapCents)} more.`;
  return "Approved.";
}

export const AI_NOT_SET_UP = "AI isn't set up on this server.";
export const PRICE_CHECK_FAILED = "Couldn't check the price, try again.";

/** Why a price check failed, in staff words. A refusal (409) is the server's own message. */
export function planErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 503) return AI_NOT_SET_UP;
    if (error.status === 502) return PRICE_CHECK_FAILED;
  }
  return errorMessage(error, PRICE_CHECK_FAILED);
}

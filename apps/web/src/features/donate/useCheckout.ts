/**
 * The donation flow behind the donate panel: create order → PayPal → capture → thank-you page.
 *
 * Money safety:
 * - the browser sends the need id and a REQUESTED amount; everything shown afterwards is the
 *   server's (`amountCents`, `wasClamped`, the capture's allocations)
 * - one payment at a time (`phaseRef` is checked synchronously, before any await)
 * - capture starts at most once per order (`captureStarted`); the only exceptions are the explicit
 *   "Try again" after a failed confirmation and PayPal's restart after a declined card, both of which
 *   are safe because the capture endpoint is idempotent and nothing was captured
 */
import { FullyFundedDetails, HOLD_MINUTES, type NeedCard } from "@needgrid/shared";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import { ApiClientError } from "@/lib/api";
import { thanksPath } from "@/lib/links";
import { useCapture, useCreateOrder } from "@/lib/queries";
import type { CheckoutHandlers } from "./checkout";
import type { Gift } from "./money-input";
import type { ThanksState } from "./thanksState";

/** An order the server created. `amountCents` is null only if PayPal reports an order we didn't start. */
export type ActiveOrder = { orderId: string; amountCents: number | null; clamped: boolean };

export type CheckoutPhase =
  | { name: "idle" }
  | { name: "creating" }
  /** The PayPal window is open. */
  | { name: "awaiting"; order: ActiveOrder }
  | { name: "capturing"; order: ActiveOrder }
  | { name: "fullyFunded"; nextNeed: NeedCard | null }
  /** `retry: "capture"` confirms the same order again; `"restart"` goes back to picking an amount. */
  | { name: "error"; message: string; retry: "capture" | "restart"; order: ActiveOrder | null };

export type CheckoutPhaseName = CheckoutPhase["name"];

const IDLE: CheckoutPhase = { name: "idle" };

const CANCELLED_MESSAGE = `Payment cancelled. Your hold is released in ${HOLD_MINUTES} minutes.`;
const DECLINED_MESSAGE = "Your card was declined, try another payment method.";
const DECLINED_RESTART_MESSAGE = "Your card was declined. Choose another payment method in PayPal.";
const CONFIRM_FAILED_MESSAGE =
  "We couldn't confirm your gift yet. Try again: if PayPal already took the payment, you won't be charged twice.";
const PAYPAL_ERROR_MESSAGE = "PayPal ran into a problem, so nothing was charged. Please try again.";

const PayPalIssue = z.object({ paypalIssue: z.string() });

/** `details.paypalIssue` of a `409 INVALID_STATE` from capture (NOTES.md §6), e.g. INSTRUMENT_DECLINED. */
function paypalIssueOf(error: unknown): string | null {
  if (!(error instanceof ApiClientError) || error.code !== "INVALID_STATE") return null;
  const parsed = PayPalIssue.safeParse(error.details);
  return parsed.success ? parsed.data.paypalIssue : null;
}

function createFailureMessage(error: unknown): string {
  const code = error instanceof ApiClientError ? error.code : null;
  switch (code) {
    case "NETWORK":
      return "We couldn't reach NeedGrid, so nothing was charged. Check your connection and try again.";
    case "RATE_LIMITED":
      return "Too many tries in a minute. Wait a moment, then try again.";
    case "NOT_FOUND":
      return "This item isn't available any more, so nothing was charged.";
    case "VALIDATION":
      return "That amount didn't work, so nothing was charged. Pick another one and try again.";
    default:
      return "We couldn't start the payment, so nothing was charged. Please try again.";
  }
}

function captureFailure(error: unknown): { message: string; retry: "capture" | "restart" } {
  const issue = paypalIssueOf(error);
  if (issue === "INSTRUMENT_DECLINED") return { message: DECLINED_MESSAGE, retry: "restart" };
  if (issue === "ORDER_EXPIRED") {
    return {
      message: "This payment took too long and expired, so nothing was charged. Please start again.",
      retry: "restart",
    };
  }
  if (issue === "PAYER_ACTION_REQUIRED") {
    return {
      message: "PayPal needs you to finish the payment, so nothing was charged. Please start again.",
      retry: "restart",
    };
  }
  if (error instanceof ApiClientError && error.code === "INVALID_STATE") {
    return { message: "The payment didn't go through, so nothing was charged. Please try again.", retry: "restart" };
  }
  if (error instanceof ApiClientError && error.code === "NOT_FOUND") {
    return { message: "We couldn't find this payment, so nothing was charged. Please start again.", retry: "restart" };
  }
  // Network, server or unexpected errors: PayPal may have taken the money. Only confirm again.
  return { message: CONFIRM_FAILED_MESSAGE, retry: "capture" };
}

type UseCheckoutOptions = {
  needId: string;
  /** The donor's current choice, or null while the amount is invalid. */
  gift: Gift | null;
  rollOverConsent: boolean;
  onPhaseChange?: (name: CheckoutPhaseName) => void;
};

export function useCheckout({ needId, gift, rollOverConsent, onPhaseChange }: UseCheckoutOptions) {
  const navigate = useNavigate();
  const createOrder = useCreateOrder();
  const capture = useCapture();
  const [phase, setPhaseState] = useState<CheckoutPhase>(IDLE);
  // Guards read this synchronously: React state would be one render behind a fast double click.
  const phaseRef = useRef<CheckoutPhase>(IDLE);
  const activeOrder = useRef<ActiveOrder | null>(null);
  const captureStarted = useRef(new Set<string>());
  // PayPal calls onError after a rejected createOrder; that failure is already on screen.
  const createFailureShown = useRef(false);

  function setPhase(next: CheckoutPhase): void {
    phaseRef.current = next;
    setPhaseState(next);
    onPhaseChange?.(next.name);
  }

  function orderFor(orderId: string): ActiveOrder {
    const known = activeOrder.current;
    return known?.orderId === orderId ? known : { orderId, amountCents: null, clamped: false };
  }

  function showCreateFailure(error: unknown): void {
    if (error instanceof ApiClientError && error.code === "FULLY_FUNDED") {
      const details = FullyFundedDetails.safeParse(error.details);
      if (!details.success && import.meta.env.DEV) {
        console.error("[donate] FULLY_FUNDED details don't match the shared schema", details.error.issues);
      }
      setPhase({ name: "fullyFunded", nextNeed: details.success ? details.data.nextNeed : null });
      return;
    }
    const message = createFailureMessage(error);
    setPhase({ name: "error", message, retry: "restart", order: null });
    toast.error(message);
  }

  async function startOrder(): Promise<string> {
    const current = phaseRef.current;
    const canStart = current.name === "idle" || (current.name === "error" && current.retry === "restart");
    if (!canStart) throw new Error("A payment is already in progress.");
    if (!gift) throw new Error("Choose an amount first.");

    createFailureShown.current = false;
    activeOrder.current = null;
    setPhase({ name: "creating" });
    try {
      const res = await createOrder.mutateAsync({ needId, amountCents: gift.requestCents, rollOverConsent });
      // The server lowered the gift below what the donor saw on the button: say so, with its amount.
      const order: ActiveOrder = {
        orderId: res.orderId,
        amountCents: res.amountCents,
        clamped: res.wasClamped && res.amountCents < gift.displayCents,
      };
      activeOrder.current = order;
      // Cancelled while the order was being created: stay idle.
      if (phaseRef.current.name === "creating") setPhase({ name: "awaiting", order });
      return res.orderId;
    } catch (error) {
      createFailureShown.current = true;
      showCreateFailure(error);
      throw error;
    }
  }

  async function approve(orderId: string, opts: { restart?: () => void } = {}): Promise<void> {
    if (captureStarted.current.has(orderId)) return;
    captureStarted.current.add(orderId);
    const order = orderFor(orderId);
    setPhase({ name: "capturing", order });
    let impactToken: string;
    try {
      impactToken = (await capture.mutateAsync(orderId)).impactToken;
    } catch (error) {
      if (paypalIssueOf(error) === "INSTRUMENT_DECLINED" && opts.restart) {
        // PayPal's recommended flow: reopen its window so the donor picks another payment method.
        // Nothing was captured, so this order may be confirmed once more after the new approval.
        captureStarted.current.delete(orderId);
        setPhase({ name: "awaiting", order });
        toast.error(DECLINED_RESTART_MESSAGE);
        opts.restart();
        return;
      }
      const failure = captureFailure(error);
      setPhase({ name: "error", message: failure.message, retry: failure.retry, order });
      toast.error(failure.message);
      return;
    }
    // Stay on "Confirming your gift…" until the thank-you page replaces the panel.
    toast.success("Thank you! Your gift went through.");
    const state: ThanksState | null =
      order.clamped && order.amountCents !== null ? { clampedAmountCents: order.amountCents } : null;
    await navigate(thanksPath(impactToken), { state });
  }

  function cancel(): void {
    const current = phaseRef.current.name;
    if (current !== "awaiting" && current !== "creating") return;
    setPhase(IDLE);
    toast(CANCELLED_MESSAGE);
  }

  function fail(error: unknown): void {
    if (createFailureShown.current) {
      createFailureShown.current = false;
      return;
    }
    const current = phaseRef.current;
    if (current.name === "capturing" || current.name === "fullyFunded") return;
    if (current.name === "error" && current.retry === "capture") return; // keep "confirm again"
    if (import.meta.env.DEV) console.error("[donate] PayPal reported an error", error);
    setPhase({ name: "error", message: PAYPAL_ERROR_MESSAGE, retry: "restart", order: null });
    toast.error(PAYPAL_ERROR_MESSAGE);
  }

  /** "Try again" on an error: confirm the same order again, or go back to picking an amount. */
  function retry(): void {
    const current = phaseRef.current;
    if (current.name !== "error") return;
    if (current.retry === "capture" && current.order) {
      captureStarted.current.delete(current.order.orderId);
      void approve(current.order.orderId);
      return;
    }
    setPhase(IDLE);
  }

  const handlers: CheckoutHandlers = { createOrder: startOrder, approve, cancel, fail };
  return { phase, handlers, retry };
}

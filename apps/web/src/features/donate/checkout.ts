import { env } from "@/env";

/**
 * What the payment buttons call. Both the real PayPal buttons and the mock button go through these,
 * so mock mode exercises exactly the code path a real payment takes.
 */
export type CheckoutHandlers = {
  /** Starts a donation with the server and returns its PayPal order id. Rejects if it couldn't. */
  createOrder: () => Promise<string>;
  /** The donor approved the payment in PayPal: confirm (capture) it. Never rejects. */
  approve: (orderId: string, opts?: { restart?: () => void }) => Promise<void>;
  /** The donor closed the PayPal window. */
  cancel: () => void;
  /** The PayPal SDK reported an error. */
  fail: (error: unknown) => void;
};

export type CheckoutButtonProps = {
  handlers: CheckoutHandlers;
  /** What the donor will give as shown in the panel, or null when no valid amount is chosen yet. */
  displayCents: number | null;
  disabled: boolean;
  /** Changes whenever the order the buttons would create changes (amount, consent). */
  renderKey: string;
};

export type CheckoutKind = { kind: "mock" } | { kind: "paypal"; clientId: string } | { kind: "unconfigured" };

/**
 * Mock button with VITE_USE_MOCKS=true, real PayPal buttons with a client id, otherwise a "not set
 * up" note. The literal `import.meta.env` comparison lets Vite drop the mock button from builds with
 * mocks off; env.ts only accepts "true"/"false" for it, so it agrees with `env.VITE_USE_MOCKS`.
 */
export function checkoutKind(): CheckoutKind {
  if (import.meta.env.VITE_USE_MOCKS === "true") return { kind: "mock" };
  return env.VITE_PAYPAL_CLIENT_ID ? { kind: "paypal", clientId: env.VITE_PAYPAL_CLIENT_ID } : { kind: "unconfigured" };
}

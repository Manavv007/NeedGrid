import { Component, lazy, Suspense, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { CheckoutButtonProps, CheckoutKind } from "./checkout";

// The literal comparison is replaced at build time, so with mocks off the mock button's import (and
// its chunk) is dropped from the bundle. The PayPal wrapper only loads when real buttons are shown.
const MockPayPalButton = lazy(() =>
  import.meta.env.VITE_USE_MOCKS === "true"
    ? import("./MockPayPalButton").then((m) => ({ default: m.MockPayPalButton }))
    : Promise.reject(new Error("The mock PayPal button only exists with VITE_USE_MOCKS=true.")),
);
const PayPalCheckout = lazy(() => import("./PayPalCheckout").then((m) => ({ default: m.PayPalCheckout })));

type CheckoutButtonsProps = CheckoutButtonProps & { kind: CheckoutKind };

/** The payment button(s) for this build: mock, real PayPal, or a note that payments aren't set up. */
export function CheckoutButtons({ kind, ...props }: CheckoutButtonsProps) {
  if (kind.kind === "unconfigured") {
    return (
      <p
        role="note"
        className="rounded-md bg-badge-warning-bg px-3.5 py-3 text-sm leading-normal text-badge-warning-text"
      >
        <strong>Payments aren't set up yet.</strong> This site has no PayPal client id configured, so gifts can't be
        made here right now.
      </p>
    );
  }
  return (
    <CheckoutLoadBoundary>
      <Suspense
        fallback={
          <div role="status" className="h-12 rounded-md bg-track motion-safe:animate-pulse">
            <span className="sr-only">Loading payment buttons…</span>
          </div>
        }
      >
        {kind.kind === "mock" ? (
          <MockPayPalButton {...props} />
        ) : (
          <PayPalCheckout clientId={kind.clientId} {...props} />
        )}
      </Suspense>
    </CheckoutLoadBoundary>
  );
}

type BoundaryState = { failed: boolean };

/** A payment chunk that fails to download (flaky network) shouldn't take the whole page down. */
class CheckoutLoadBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    if (import.meta.env.DEV) console.error("[donate] payment buttons failed to load", error);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        className="flex flex-col items-center gap-2 rounded-md border p-3 text-center text-sm text-soft"
      >
        The payment buttons didn't load. Check your connection, then reload the page.
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}

/**
 * Real PayPal buttons (sandbox). Loaded with a dynamic import, so the SDK wrapper never loads in mock
 * mode or when no client id is set.
 *
 * @paypal/react-paypal-js 10.6.0 ships two APIs: the JS SDK v5 components from the package root
 * (`PayPalScriptProvider`, `PayPalButtons`) and the v6 SDK under `/sdk-v6`. This uses the root (v5)
 * API because it is the one that provides everything the brief asks for: script options
 * `clientId` / `currency: "USD"` / `intent: "capture"`, `forceReRender` for amount changes, and
 * `actions.restart()` in `onApprove`, PayPal's recommended recovery from INSTRUMENT_DECLINED.
 * The v6 `onApprove` only receives `{ orderId }` and has no restart.
 */
import { PayPalButtons, PayPalScriptProvider, usePayPalScriptReducer } from "@paypal/react-paypal-js";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import type { CheckoutButtonProps } from "./checkout";

type PayPalCheckoutProps = CheckoutButtonProps & { clientId: string };

export function PayPalCheckout({ clientId, ...props }: PayPalCheckoutProps) {
  const options = useMemo(() => ({ clientId, currency: "USD", intent: "capture", components: "buttons" }), [clientId]);
  return (
    <PayPalScriptProvider options={options}>
      <Buttons {...props} />
    </PayPalScriptProvider>
  );
}

function Buttons({ handlers, disabled, renderKey }: CheckoutButtonProps) {
  const [{ isInitial, isPending, isRejected }] = usePayPalScriptReducer();

  if (isRejected) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center gap-2 rounded-md border p-3 text-center text-sm text-soft"
      >
        PayPal didn't load. Check your connection, then reload the page.
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
  if (isInitial || isPending) {
    return (
      <div role="status" className="h-12 rounded-md bg-track motion-safe:animate-pulse">
        <span className="sr-only">Loading PayPal…</span>
      </div>
    );
  }
  return (
    <PayPalButtons
      // Destroy and redraw the buttons whenever the order they'd create changes.
      forceReRender={[renderKey]}
      disabled={disabled}
      style={{ layout: "vertical", shape: "rect", label: "pay", height: 48 }}
      createOrder={() => handlers.createOrder()}
      onApprove={(data, actions) => handlers.approve(data.orderID, { restart: () => actions.restart() })}
      onCancel={() => handlers.cancel()}
      onError={(error) => handlers.fail(error)}
    />
  );
}

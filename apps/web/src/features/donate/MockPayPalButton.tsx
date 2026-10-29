/**
 * Mock mode only (VITE_USE_MOCKS=true): stands in for the PayPal buttons and runs create → capture
 * through the same handlers the real buttons use. Loaded with a dynamic import, so it isn't in
 * builds with mocks off. `?mock=cancel` makes the next click act like a closed PayPal window.
 */
import { useRef, useState } from "react";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { mockDb } from "@/mocks/mockDb";
import type { CheckoutButtonProps } from "./checkout";

export function MockPayPalButton({ handlers, displayCents, disabled }: CheckoutButtonProps) {
  const running = useRef(false);
  const [pending, setPending] = useState(false);

  async function pay(): Promise<void> {
    if (running.current || disabled) return;
    running.current = true;
    setPending(true);
    try {
      const orderId = await handlers.createOrder();
      if (mockDb.takeScenario("cancel")) {
        handlers.cancel();
        return;
      }
      // Like PayPal's actions.restart() after a declined card: the donor "picks another payment
      // method" and approves the same order again.
      let restarted = true;
      while (restarted) {
        restarted = false;
        await handlers.approve(orderId, {
          restart: () => {
            restarted = true;
          },
        });
      }
    } catch {
      // createOrder already showed what went wrong (just funded, network, …).
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      onClick={() => void pay()}
      className={cn(
        "h-12 w-full rounded-md px-4 text-[15px] font-extrabold transition-colors",
        "bg-paypal-mock text-foreground hover:brightness-95 disabled:cursor-not-allowed disabled:bg-track disabled:text-muted-foreground",
      )}
    >
      {displayCents === null ? "Mock PayPal" : `Mock PayPal · give ${formatUsd(displayCents)}`}
    </button>
  );
}

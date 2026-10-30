import type { NeedCard } from "@needgrid/shared";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { DonatePanel } from "@/features/donate/DonatePanel";
import type { CheckoutPhaseName } from "@/features/donate/useCheckout";
import { formatLeft, formatUsdShort } from "@/lib/format";

/**
 * Phones: "$14 left · Fund this item" (NeedDetailPhone.dc.html). Sticky, not fixed: it rides along
 * the bottom of the screen while the item is in view and stops above the site footer.
 */
export function PhoneDonateBar({ need, onOpen }: { need: NeedCard; onOpen: () => void }) {
  return (
    <div className="sticky bottom-0 z-40 -mx-4 mt-auto border-t bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg shadow-foreground/10 sm:-mx-6 sm:px-6">
      <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
        <p className="min-w-0 text-[15px]">
          <strong className="font-extrabold text-left-text">{formatLeft(need.status, need.remainingCents)}</strong>{" "}
          <span className="text-muted-foreground">of {formatUsdShort(need.targetCents)}</span>
        </p>
        <Button size="lg" onClick={onOpen} className="shrink-0">
          {need.status === "topping_up" ? "Help finish it" : "Fund this item"}
        </Button>
      </div>
    </div>
  );
}

type DonateSheetProps = {
  need: NeedCard;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPhaseChange: (name: CheckoutPhaseName) => void;
};

/**
 * The donate panel as a bottom sheet. Radix traps focus and closes on Esc; the page refuses to close
 * it while an order is being created or confirmed. Focus starts on the selected amount.
 */
export function DonateSheet({ need, open, onOpenChange, onPhaseChange }: DonateSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="max-h-[92svh] gap-4 overflow-y-auto rounded-t-[20px] px-5 pt-2.5 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      >
        <span aria-hidden="true" className="h-1.25 w-10 self-center rounded-full bg-border-strong" />
        <div className="flex items-center justify-between gap-3">
          <SheetTitle className="text-xl font-extrabold">Fund this item</SheetTitle>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" className="rounded-full bg-placeholder">
              <XIcon aria-hidden="true" className="size-4.5" />
              <span className="sr-only">Close</span>
            </Button>
          </SheetClose>
        </div>
        <SheetDescription className="sr-only">
          Choose an amount for {need.title}, then pay with PayPal.
        </SheetDescription>
        <DonatePanel need={need} variant="sheet" focusOnMount onPhaseChange={onPhaseChange} />
      </SheetContent>
    </Sheet>
  );
}

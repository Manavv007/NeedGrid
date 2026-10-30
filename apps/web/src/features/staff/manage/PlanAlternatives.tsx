import type { PurchaseOffer } from "@needgrid/shared";
import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { OfferLink } from "./OfferLink";

type PlanAlternativesProps = {
  offers: readonly PurchaseOffer[];
  /** Start open (a pricier plan shows them straight away, NeedManageStates.dc.html). */
  defaultOpen: boolean;
};

/**
 * The other offers the price check found, for comparison. The purchase-plan request takes `{}`, so
 * there is no way to plan with one of these: they are information with links, not a choice.
 */
export function PlanAlternatives({ offers, defaultOpen }: PlanAlternativesProps) {
  const [open, setOpen] = useState(defaultOpen);
  const listId = useId();
  if (offers.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="outline"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="w-full"
      >
        {open ? "Hide other offers" : "See other offers"}
        <ChevronDown aria-hidden="true" className={cn("transition-transform", open && "rotate-180")} />
      </Button>
      <div id={listId} hidden={!open} className="flex flex-col gap-2">
        <p className="text-[13px] font-bold">Other offers we found</p>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {offers.map((offer) => (
            <li
              key={offer.channel3Id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border-strong px-3 py-2.5 text-sm"
            >
              <span className="min-w-0 flex-1">
                {offer.title} <span aria-hidden="true">·</span> {offer.retailer}
              </span>
              <strong>{formatUsd(offer.unitPriceCents)}</strong>
              <OfferLink url={offer.url} className="inline-flex min-h-11 items-center text-[13px] font-semibold">
                Open offer<span className="sr-only">: {offer.title}</span>
              </OfferLink>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          For comparison only. NeedGrid plans the purchase with the offer above.
        </p>
      </div>
    </div>
  );
}

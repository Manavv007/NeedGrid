import type { PurchasePlanRes } from "@needgrid/shared";
import { ArrowDown, ArrowUp, Equal, type LucideIcon } from "lucide-react";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

type PriceChange = PurchasePlanRes["priceChange"];

// Text + icon, never colour alone (cheaper green, pricier amber, same neutral).
const CHANGE: Record<PriceChange, { label: string; Icon: LucideIcon; box: string; text: string; badge: string }> = {
  cheaper: {
    label: "Cheaper",
    Icon: ArrowDown,
    box: "border-2 border-success bg-success-soft",
    text: "text-badge-success-text",
    badge: "bg-badge-success-bg text-badge-success-text",
  },
  pricier: {
    label: "Pricier",
    Icon: ArrowUp,
    box: "border-2 border-warning bg-warning-soft",
    text: "text-badge-warning-text",
    badge: "bg-badge-warning-bg text-badge-warning-text",
  },
  same: {
    label: "Same price",
    Icon: Equal,
    box: "border",
    text: "text-foreground",
    badge: "bg-badge-low-bg text-badge-low-text",
  },
};

type PriceCompareProps = {
  /** The stored product's unit price (what the need was posted with). */
  postedCents: number;
  /** The plan's offer price. */
  offerCents: number;
  /** From the price check's response; null when this tab only has the stored purchase. */
  priceChange: PriceChange | null;
};

/** "Price when posted" next to "Price now" (PurchasePlan.dc.html), both prices as the server sent them. */
export function PriceCompare({ postedCents, offerCents, priceChange }: PriceCompareProps) {
  const change = priceChange ? CHANGE[priceChange] : null;
  return (
    <dl className="m-0 grid grid-cols-2 gap-3">
      <div className="rounded-lg border p-3.5">
        <dt className="text-xs text-muted-foreground">Price when posted</dt>
        <dd
          className={cn(
            "m-0 mt-1 text-[22px] font-extrabold text-muted-foreground",
            priceChange === "cheaper" && "line-through",
          )}
        >
          {formatUsd(postedCents)}
        </dd>
      </div>
      <div className={cn("rounded-lg p-3.5", change ? change.box : "border")}>
        <dt
          className={cn("flex flex-wrap items-center gap-1.5 text-xs", change ? change.text : "text-muted-foreground")}
        >
          {change ? "Price now" : "Price in this plan"}
          {change ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.75 py-0.5 text-xs font-bold",
                change.badge,
              )}
            >
              <change.Icon aria-hidden="true" className="size-3" strokeWidth={3} />
              {change.label}
            </span>
          ) : null}
        </dt>
        <dd className={cn("m-0 mt-1 text-[22px] font-extrabold", change ? change.text : "text-foreground")}>
          {formatUsd(offerCents)}
        </dd>
      </div>
    </dl>
  );
}

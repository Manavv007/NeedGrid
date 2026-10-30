import type { NeedCard, PurchaseView } from "@needgrid/shared";
import { ArrowUp, Check } from "lucide-react";
import { ProductPhoto } from "@/components/ProductPhoto";
import { formatShortDate, formatUsd } from "@/lib/format";
import { OfferLink } from "./OfferLink";
import { StepCard } from "./StepCard";

type ApprovedStepProps = { need: NeedCard; purchase: PurchaseView };

/**
 * Step 1 once approved: what was approved, and, after a pricier approval, how much donors still
 * have to give (the server's `remainingCents`) before Step 2 unlocks.
 */
export function ApprovedStep({ need, purchase }: ApprovedStepProps) {
  const { offer } = purchase;
  return (
    <StepCard
      title="Step 1 · Purchase approved"
      note={
        purchase.approvedAt ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-badge-success-text">
            <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
            Approved {formatShortDate(purchase.approvedAt)}
          </span>
        ) : null
      }
    >
      <div className="flex flex-col gap-4 p-4 sm:p-5.5">
        <div className="flex items-center gap-4">
          <ProductPhoto
            product={offer}
            className="size-16 rounded-lg border"
            placeholderClassName="rounded-lg"
            iconClassName="size-6"
          />
          <div className="min-w-0">
            <p className="font-bold">{offer.title}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {formatUsd(offer.unitPriceCents)} each at {offer.retailer} <span aria-hidden="true">·</span>{" "}
              <OfferLink url={offer.url} className="font-semibold">
                Open offer
              </OfferLink>
            </p>
          </div>
        </div>
        {need.status === "topping_up" ? <ToppingUp need={need} /> : null}
      </div>
    </StepCard>
  );
}

function ToppingUp({ need }: { need: NeedCard }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-warning bg-warning-soft p-3.5 text-badge-warning-text">
      <ArrowUp aria-hidden="true" className="mt-0.5 size-4.5 shrink-0" strokeWidth={2.5} />
      <div className="flex flex-col gap-1">
        <p className="font-bold">
          {need.remainingCents > 0
            ? `Waiting for ${formatUsd(need.remainingCents)} more from donors`
            : "Donors are paying for the rest right now"}
        </p>
        <p className="text-sm">
          The price went up, so the tile is back on your public page for the difference. Step 2 unlocks once it&apos;s
          fully funded again.
        </p>
      </div>
    </div>
  );
}

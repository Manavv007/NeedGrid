import { TARGET_BUFFER_BPS, type NeedCard, type PurchasePlanRes, type PurchaseView } from "@needgrid/shared";
import { Sparkles } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { ProductPhoto } from "@/components/ProductPhoto";
import { Button } from "@/components/ui/button";
import { formatRelativeTime, formatUsd } from "@/lib/format";
import { useApprovePurchase } from "@/lib/queries";
import { errorMessage } from "../errorMessage";
import { OfferLink } from "./OfferLink";
import { PlanAlternatives } from "./PlanAlternatives";
import { PriceCompare } from "./PriceCompare";
import { approvalToast, approveLabel, type PlanMoney } from "./purchases";
import { StepCard } from "./StepCard";

type PurchasePlanCardProps = {
  need: NeedCard;
  /** The `proposed` purchase. */
  purchase: PurchaseView;
  /**
   * The price check's response for this purchase, when this tab ran it. Only it carries
   * `priceChange`, `money` and the other offers; without it the card asks for a fresh check.
   */
  plan: PurchasePlanRes | null;
  onRecheck: () => void;
};

/** Step 1 · Approve the purchase (PurchasePlan.dc.html, NeedManageStates.dc.html "price went up"). */
export function PurchasePlanCard({ need, purchase, plan, onRecheck }: PurchasePlanCardProps) {
  const { offer } = purchase;
  return (
    <StepCard
      title="Step 1 · Approve the purchase"
      note={<time dateTime={purchase.createdAt}>Price checked {formatRelativeTime(purchase.createdAt)}</time>}
    >
      <div className="flex flex-wrap gap-7 p-4 sm:p-5.5">
        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-4.5">
          <div className="flex items-center gap-4">
            <ProductPhoto
              product={offer}
              className="size-22 rounded-lg border"
              placeholderClassName="rounded-lg"
              iconClassName="size-8"
            />
            <div className="min-w-0">
              <p className="text-base font-bold">{offer.title}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {offer.retailer} <span aria-hidden="true">·</span>{" "}
                <OfferLink url={offer.url} className="font-semibold">
                  Open offer
                </OfferLink>
              </p>
            </div>
          </div>

          {need.product ? (
            <PriceCompare
              postedCents={need.product.unitPriceCents}
              offerCents={offer.unitPriceCents}
              priceChange={plan?.priceChange ?? null}
            />
          ) : null}

          {purchase.flags.length > 0 ? (
            <ul aria-label="What the price check found" className="m-0 flex list-none flex-wrap gap-2 p-0">
              {purchase.flags.map((flag) => (
                <li key={flag} className="rounded-full bg-track px-2.5 py-1.25 text-xs font-semibold text-soft">
                  {flag}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex gap-2.5 rounded-lg bg-staff-bg p-3.5">
            <Sparkles aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-primary" />
            <p className="text-sm leading-[1.55]">
              <strong>AI check:</strong> {purchase.explanation}
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5">
          <MoneyBox need={need} purchase={purchase} money={plan?.money ?? null} />
          <ApproveButton need={need} purchase={purchase} money={plan?.money ?? null} />
          {plan ? (
            <PlanAlternatives offers={plan.alternatives} defaultOpen={plan.priceChange === "pricier"} />
          ) : (
            <Button variant="outline" onClick={onRecheck} className="w-full">
              Check the price again
            </Button>
          )}
        </div>
      </div>
    </StepCard>
  );
}

type MoneyProps = { need: NeedCard; purchase: PurchaseView; money: PlanMoney | null };

/** Raised vs the new cost, and the outcome in plain words. Every number is the server's. */
function MoneyBox({ need, purchase, money }: MoneyProps) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border p-4.5">
      <p className="text-[13px] font-bold tracking-[0.05em] text-muted-foreground uppercase">
        What happens to the money
      </p>
      <dl className="m-0 flex flex-col gap-2.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt>Raised</dt>
          <dd className="m-0 font-bold">{formatUsd(need.fundedCents)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>New cost with {TARGET_BUFFER_BPS / 100}% buffer</dt>
          <dd className="m-0 font-bold">{formatUsd(purchase.newTargetCents)}</dd>
        </div>
      </dl>
      <div aria-hidden="true" className="h-px bg-track" />
      <MoneyOutcome money={money} />
      <p className="text-xs text-muted-foreground">Calculated by NeedGrid, not the AI.</p>
    </div>
  );
}

function MoneyOutcome({ money }: { money: PlanMoney | null }) {
  const className = "text-[15px] leading-normal";
  if (!money) {
    return <p className={className}>Check the price again to see what happens to the money before you approve.</p>;
  }
  switch (money.kind) {
    case "exact":
      return <p className={className}>Funds match exactly.</p>;
    case "surplus":
      return (
        <p className={className}>
          <strong className="text-success">{formatUsd(money.cents)} surplus</strong>{" "}
          {money.nextNeed ? (
            <>
              will move to <strong>{money.nextNeed.title}</strong>, your next most urgent need.
            </>
          ) : (
            "will stay on this item."
          )}
        </p>
      );
    case "gap":
      return (
        <p className={className}>
          Price went up: the tile will ask donors for{" "}
          <strong className="text-badge-warning-text">{formatUsd(money.cents)} more</strong>.
        </p>
      );
  }
}

/**
 * `POST approve` exactly once: a ref blocks a second click before React re-renders, the button is
 * disabled while pending, and it stays disabled after success (the page then shows the approved step).
 */
function ApproveButton({ need, purchase, money }: MoneyProps) {
  const approve = useApprovePurchase();
  const busy = useRef(false);

  async function run() {
    if (busy.current) return;
    busy.current = true;
    try {
      const res = await approve.mutateAsync({ purchaseId: purchase.id, needId: need.id });
      toast.success(approvalToast(res));
    } catch (error) {
      busy.current = false;
      toast.error(errorMessage(error, "We couldn't approve the purchase. Please try again."));
    }
  }

  return (
    <Button
      size="lg"
      onClick={() => void run()}
      disabled={approve.isPending || approve.isSuccess}
      className="h-12.5 w-full font-extrabold"
    >
      {approve.isPending ? "Approving…" : approveLabel(money)}
    </Button>
  );
}

import type { NeedCard, PurchaseView } from "@needgrid/shared";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDonorCount, formatUsd } from "@/lib/format";
import { useCheckedPurchasePlan, usePurchasePlan } from "@/lib/queries";
import { PlanChecking } from "./PlanChecking";
import { planErrorMessage } from "./purchases";
import { PurchasePlanCard } from "./PurchasePlanCard";
import { StepCard } from "./StepCard";

type PlanStepProps = {
  /** A `funded` need with no approved purchase yet. */
  need: NeedCard;
  /** The newest `proposed` purchase, if there is one. */
  proposed: PurchaseView | null;
};

/**
 * Step 1 while nothing is approved: "Check price & plan purchase", the staged wait, then the plan
 * card. One price check at a time (ref guard); a refusal (409) refetches the page with its message.
 */
export function PlanStep({ need, proposed }: PlanStepProps) {
  const planPurchase = usePurchasePlan();
  const checked = useCheckedPurchasePlan(need.id);
  const busy = useRef(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function check() {
    if (busy.current) return;
    busy.current = true;
    setProblem(null);
    try {
      await planPurchase.mutateAsync(need.id);
      toast.success("Price checked. Review the plan before you approve.");
    } catch (error) {
      const message = planErrorMessage(error);
      setProblem(message);
      toast.error(message);
    } finally {
      busy.current = false;
    }
  }

  if (planPurchase.isPending) {
    return (
      <StepCard title="Step 1 · Check the price">
        <PlanChecking />
      </StepCard>
    );
  }

  // Right after a check the page may not have refetched yet: the response's purchase is the current one.
  const current = proposed ?? checked?.purchase ?? null;
  if (current) {
    const plan = checked?.purchase.id === current.id ? checked : null;
    return <PurchasePlanCard need={need} purchase={current} plan={plan} onRecheck={() => void check()} />;
  }

  return (
    <StepCard title="Step 1 · Check the price and plan the purchase">
      <div className="flex flex-col items-start gap-4 p-4 sm:p-5.5">
        <p className="max-w-150 text-[15px] leading-normal text-soft">
          Fully funded: {formatUsd(need.fundedCents)} from {formatDonorCount(need.donorCount).toLowerCase()}. NeedGrid
          checks today&apos;s price
          {need.product ? ` at ${need.product.retailer}` : ""} and works out what happens to the money. Nothing is
          bought until you approve.
        </p>
        <Button size="lg" onClick={() => void check()}>
          Check price &amp; plan purchase
        </Button>
        {problem ? <p className="text-sm font-semibold text-danger">{problem}</p> : null}
      </div>
    </StepCard>
  );
}

import type { StaffNeedDetailRes } from "@needgrid/shared";
import { ApprovedStep } from "./ApprovedStep";
import { OrderStep } from "./OrderStep";
import { PlanStep } from "./PlanStep";
import { approvedPurchase, proposedPurchase } from "./purchases";

/**
 * The two-step purchase (design decision: approve first; "Mark as ordered" stays locked until then).
 * For a `funded` need, and for a `topping_up` need whose pricier purchase is already approved.
 */
export function PurchaseSteps({ detail }: { detail: StaffNeedDetailRes }) {
  const { need, purchases } = detail;
  const approved = approvedPurchase(purchases);
  return (
    <>
      {approved ? (
        <ApprovedStep need={need} purchase={approved} />
      ) : (
        <PlanStep need={need} proposed={proposedPurchase(purchases)} />
      )}
      <OrderStep need={need} purchase={approved} />
    </>
  );
}

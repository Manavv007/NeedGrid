import type { StaffNeedDetailRes } from "@needgrid/shared";
import { ClosedSummary } from "./ClosedSummary";
import { DeliveredCard } from "./DeliveredCard";
import { OrderedState } from "./OrderedState";
import { approvedPurchase, orderedPurchase } from "./purchases";
import { PurchaseSteps } from "./PurchaseSteps";
import { WaitingForDonations } from "./WaitingForDonations";

/** What staff can do next, by status (brief §4 status machine). */
export function NeedBody({ detail }: { detail: StaffNeedDetailRes }) {
  const { need, purchases } = detail;
  switch (need.status) {
    case "draft":
    case "open":
      return <WaitingForDonations need={need} />;
    case "topping_up":
      // After a pricier approval: the approved purchase waits for donors to cover the gap.
      return approvedPurchase(purchases) ? <PurchaseSteps detail={detail} /> : <WaitingForDonations need={need} />;
    case "funded":
      return <PurchaseSteps detail={detail} />;
    case "ordered":
      return <OrderedState need={need} purchase={orderedPurchase(purchases)} />;
    case "delivered":
      return <DeliveredCard need={need} delivery={detail.delivery} />;
    case "closed":
      return <ClosedSummary timeline={detail.timeline} />;
  }
}

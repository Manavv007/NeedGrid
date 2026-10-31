import type { StaffNeedDetailRes } from "@needgrid/shared";
import { useState } from "react";
import { ClosedSummary } from "./ClosedSummary";
import { DeliveredCard } from "./DeliveredCard";
import { OrderedState } from "./OrderedState";
import { approvedPurchase, orderedPurchase } from "./purchases";
import { PurchaseSteps } from "./PurchaseSteps";
import { WaitingForDonations } from "./WaitingForDonations";

/** What staff can do next, by status (brief §4 status machine). */
export function NeedBody({ detail }: { detail: StaffNeedDetailRes }) {
  const { need, purchases } = detail;
  // Ordered → delivered while this page is open: the delivery panel goes away, so focus moves to
  // the success card instead of being lost.
  const [seenStatus, setSeenStatus] = useState(need.status);
  const [justDelivered, setJustDelivered] = useState(false);
  if (seenStatus !== need.status) {
    setSeenStatus(need.status);
    setJustDelivered(seenStatus === "ordered" && need.status === "delivered");
  }

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
      return <OrderedState need={need} purchase={orderedPurchase(purchases)} delivery={detail.delivery} />;
    case "delivered":
      return <DeliveredCard need={need} delivery={detail.delivery} focusHeading={justDelivered} />;
    case "closed":
      return <ClosedSummary timeline={detail.timeline} />;
  }
}

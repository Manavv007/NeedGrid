import type { DeliveryView, NeedCard, PurchaseView } from "@needgrid/shared";
import { Truck } from "lucide-react";
import { formatShortDate } from "@/lib/format";
import { deliveryToReview } from "../delivery/delivery";
import { DeliveryPanel } from "../delivery/DeliveryPanel";

type OrderedStateProps = { need: NeedCard; purchase: PurchaseView | null; delivery: DeliveryView | null };

/**
 * `ordered`: the order number and date from the ordered purchase, then the delivery panel. While an
 * arrival photo waits for review, the review is the only thing on the page (Delivery.dc.html).
 */
export function OrderedState({ need, purchase, delivery }: OrderedStateProps) {
  return (
    <>
      {deliveryToReview(delivery) ? null : <OrderSummary purchase={purchase} />}
      <DeliveryPanel need={need} delivery={delivery} />
    </>
  );
}

function OrderSummary({ purchase }: { purchase: PurchaseView | null }) {
  return (
    <section aria-labelledby="ordered-heading" className="flex gap-3 rounded-xl border bg-surface p-4 sm:p-5.5">
      <Truck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-badge-info-text" />
      <div className="flex min-w-0 flex-col gap-2">
        <h2 id="ordered-heading" className="text-lg font-extrabold">
          Waiting for delivery
        </h2>
        {purchase ? (
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[15px]">
            <dt className="text-muted-foreground">Ordered at</dt>
            <dd className="m-0 font-semibold">
              {purchase.offer.retailer}
              {purchase.orderedAt ? (
                <>
                  {" "}
                  on <time dateTime={purchase.orderedAt}>{formatShortDate(purchase.orderedAt)}</time>
                </>
              ) : null}
            </dd>
            {purchase.orderRef ? (
              <>
                <dt className="text-muted-foreground">Order number</dt>
                <dd className="m-0 font-semibold break-all">{purchase.orderRef}</dd>
              </>
            ) : null}
          </dl>
        ) : (
          <p className="text-[15px] text-soft">This item has been ordered.</p>
        )}
      </div>
    </section>
  );
}

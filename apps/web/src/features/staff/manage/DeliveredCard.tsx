import type { DeliveryView, NeedCard } from "@needgrid/shared";
import { Check, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { ProductPhoto } from "@/components/ProductPhoto";
import { formatDonorCount } from "@/lib/format";
import { checkDidNotRun, hasMessage } from "../delivery/delivery";
import { DeliveryPhoto } from "../delivery/DeliveryPhoto";
import { MatchMeter } from "../delivery/MatchMeter";

type DeliveredCardProps = {
  need: NeedCard;
  delivery: DeliveryView | null;
  /** Move focus to the heading: the delivery was just recorded or confirmed on this page. */
  focusHeading?: boolean;
};

/** `delivered`: read-only success card (NeedManageStates.dc.html), from `StaffNeedDetailRes.delivery`. */
export function DeliveredCard({ need, delivery, focusHeading = false }: DeliveredCardProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusHeading) headingRef.current?.focus();
  }, [focusHeading]);

  return (
    <section
      aria-labelledby="delivered-heading"
      className="overflow-hidden rounded-xl border-2 border-success bg-surface"
    >
      <div className="flex items-center gap-2.5 bg-badge-success-bg px-4 py-3.5 sm:px-5.5">
        <Check aria-hidden="true" className="size-4.5 text-badge-success-text" strokeWidth={3} />
        <h2
          id="delivered-heading"
          ref={headingRef}
          tabIndex={-1}
          className="text-base font-extrabold text-success-strong outline-none"
        >
          Delivered, donors have been updated
        </h2>
      </div>
      <div className="flex flex-wrap items-center gap-6 px-4 py-5 sm:px-5.5">
        <div className="flex gap-2.5">
          <ProductPhoto
            product={need.product}
            className="size-30 rounded-lg border"
            placeholderClassName="rounded-lg"
            iconClassName="size-8"
          />
          {delivery ? (
            <DeliveryPhoto
              url={delivery.photoUrl}
              alt={`${need.title} after it arrived`}
              className="size-30 rounded-lg"
            />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-2.5">
          <p className="text-lg font-extrabold">{need.title}</p>
          {delivery ? <PhotoCheck delivery={delivery} /> : null}
          {delivery && hasMessage(delivery.message) ? (
            <p className="rounded-md bg-quote-bg px-3 py-2.5 text-sm leading-normal text-quote-text">
              “{delivery.message}”
            </p>
          ) : null}
          <p className="text-[13px] text-muted-foreground">
            {formatDonorCount(need.donorCount)} can now see {delivery ? "this photo" : "that it arrived"} on their
            impact page.
          </p>
        </div>
      </div>
    </section>
  );
}

/** The server's photo check: its score, or that staff looked at the photo when the check didn't run. */
function PhotoCheck({ delivery }: { delivery: DeliveryView }) {
  if (checkDidNotRun(delivery)) {
    return (
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Check aria-hidden="true" className="size-4 text-success" strokeWidth={3} />
        Checked by staff (the automatic check didn&apos;t run)
      </p>
    );
  }
  return (
    <>
      <MatchMeter score={delivery.matchScore} confirmedByStaff={delivery.confirmedAt !== null} />
      <p className="flex gap-2 text-sm leading-normal text-soft">
        <Sparkles aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
        <span>
          <strong className="text-foreground">AI check:</strong> {delivery.aiNotes}
        </span>
      </p>
    </>
  );
}

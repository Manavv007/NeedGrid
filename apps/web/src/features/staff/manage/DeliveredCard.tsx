import { DELIVERY_MATCH_THRESHOLD, type DeliveryView, type NeedCard } from "@needgrid/shared";
import { Check, ImageIcon } from "lucide-react";
import { useState } from "react";
import { ProductPhoto } from "@/components/ProductPhoto";
import { formatDonorCount, percentOf } from "@/lib/format";
import { cn } from "@/lib/utils";

type DeliveredCardProps = { need: NeedCard; delivery: DeliveryView | null };

/** `delivered`: read-only success card (NeedManageStates.dc.html), from `StaffNeedDetailRes.delivery`. */
export function DeliveredCard({ need, delivery }: DeliveredCardProps) {
  return (
    <section
      aria-labelledby="delivered-heading"
      className="overflow-hidden rounded-xl border-2 border-success bg-surface"
    >
      <div className="flex items-center gap-2.5 bg-badge-success-bg px-4 py-3.5 sm:px-5.5">
        <Check aria-hidden="true" className="size-4.5 text-badge-success-text" strokeWidth={3} />
        <h2 id="delivered-heading" className="text-base font-extrabold text-success-strong">
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
          {delivery ? <DeliveryPhoto url={delivery.photoUrl} title={need.title} /> : null}
        </div>
        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-2.5">
          <p className="text-lg font-extrabold">{need.title}</p>
          {delivery ? <MatchScore score={delivery.matchScore} /> : null}
          {delivery?.message ? (
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

function DeliveryPhoto({ url, title }: { url: string; title: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        aria-hidden="true"
        className="flex size-30 items-center justify-center rounded-lg bg-placeholder-strong text-placeholder-icon"
      >
        <ImageIcon className="size-7" strokeWidth={1.5} />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={`${title} after it arrived`}
      decoding="async"
      className="size-30 rounded-lg bg-placeholder-strong object-cover"
      onError={() => setFailed(true)}
    />
  );
}

/** The AI's photo match score as a meter with its number in text (never colour alone). */
function MatchScore({ score }: { score: number }) {
  const percent = percentOf(score, 1);
  const good = score >= DELIVERY_MATCH_THRESHOLD;
  return (
    <div className="flex flex-wrap items-center gap-2.5 text-sm">
      <strong>Photo match {percent}%</strong>
      <span
        role="meter"
        aria-label="Photo match score"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}%`}
        className="block h-2 w-40 overflow-hidden rounded-full bg-track"
      >
        <span className={cn("block h-full", good ? "bg-success" : "bg-warning")} style={{ width: `${percent}%` }} />
      </span>
    </div>
  );
}

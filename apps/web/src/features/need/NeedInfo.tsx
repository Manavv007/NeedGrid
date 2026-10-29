import type { DeliveryPublic, NeedCard, OrgPublic } from "@needgrid/shared";
import { ExternalLink } from "lucide-react";
import { ProductPhoto } from "@/components/ProductPhoto";
import { StatusBadge } from "@/components/StatusBadge";
import { UrgencyBadge } from "@/components/UrgencyBadge";
import { isDonatable } from "@/features/tiles/filterNeeds";
import { formatNeededBy, formatShortDate } from "@/lib/format";
import { externalHttpUrl } from "@/lib/links";
import { ArrivalPhoto } from "./ArrivalPhoto";

type NeedInfoProps = { need: NeedCard; org: OrgPublic; delivery: DeliveryPublic | null };

/**
 * Photo, urgency + deadline, title, "2 × pack of 150 · View at Walmart" and why it's needed
 * (NeedDetail.dc.html). Once delivered with a photo, the arrival photo takes the product photo's place.
 */
export function NeedInfo({ need, org, delivery }: NeedInfoProps) {
  const arrived = need.status === "delivered" && delivery !== null;
  const text = <NeedText need={need} delivery={delivery} />;

  if (arrived) {
    return (
      <div className="flex flex-col gap-4">
        {text}
        <ArrivalPhoto delivery={delivery} needTitle={need.title} orgName={org.name} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:gap-6">
      <ProductPhoto
        product={need.product}
        loading="eager"
        className="h-50 w-full rounded-xl border p-4 sm:aspect-square sm:h-auto sm:max-w-90 sm:flex-[1_1_280px] sm:p-6"
        placeholderClassName="size-37.5 rounded-xl sm:size-[70%]"
        iconClassName="size-10 sm:size-11"
        placeholderText={<span className="hidden text-[13px] sm:block">Product photo</span>}
      />
      <div className="sm:flex-[1_1_280px]">{text}</div>
    </div>
  );
}

function NeedText({ need, delivery }: { need: NeedCard; delivery: DeliveryPublic | null }) {
  const product = need.product;
  const productUrl = product ? externalHttpUrl(product.url) : null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <NeedBadges need={need} delivery={delivery} />
      <h1 className="text-2xl leading-[1.15] font-extrabold tracking-[-0.02em] sm:text-[34px] sm:tracking-[-0.03em]">
        {need.title}
      </h1>
      <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground sm:text-[15px]">
        <span>
          {need.quantity} × {need.unit}
        </span>
        {product ? (
          <>
            <span aria-hidden="true">·</span>
            {productUrl ? (
              <a
                href={productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1 sm:min-h-0"
              >
                View at {product.retailer} <ExternalLink aria-hidden="true" className="size-3.5" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : (
              <span>{product.retailer}</span>
            )}
          </>
        ) : null}
      </p>
      {need.description ? (
        <p className="text-[15px] leading-relaxed text-soft sm:text-base">{need.description}</p>
      ) : null}
    </div>
  );
}

function NeedBadges({ need, delivery }: { need: NeedCard; delivery: DeliveryPublic | null }) {
  const neededBy = formatNeededBy(need.deadlineAt);
  const deliveredOn = need.status === "delivered" && delivery ? formatShortDate(delivery.deliveredAt) : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {need.status === "open" ? null : <StatusBadge status={need.status} suffix={deliveredOn} />}
      {isDonatable(need.status) ? (
        <UrgencyBadge urgency={need.urgency} suffix={neededBy ? `needed by ${neededBy}` : null} />
      ) : null}
    </div>
  );
}

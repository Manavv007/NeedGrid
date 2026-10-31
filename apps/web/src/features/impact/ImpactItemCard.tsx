import type { DeliveryPublic, ImpactItem } from "@needgrid/shared";
import { ImageIcon } from "lucide-react";
import { useId, useState } from "react";
import { ProductPhoto } from "@/components/ProductPhoto";
import { StatusBadge } from "@/components/StatusBadge";
import { Timeline } from "@/components/Timeline";
import { formatShortDate, formatUsd } from "@/lib/format";
import { arrivedAt, itemName, reasonLabel } from "./impactItems";

/**
 * One item the donor's gift paid for (ImpactPhone.dc.html): the arrival photo large once it has
 * arrived, otherwise the product with "We'll post a photo here when it arrives." Every amount,
 * status and date is the server's. Staff messages are plain text.
 */
export function ImpactItemCard({ item }: { item: ImpactItem }) {
  const titleId = useId();
  const { need, delivery } = item;
  const arrived = arrivedAt(item) !== null && delivery !== null;
  const timeline = (
    <Timeline need={need} events={item.timeline} label={`Progress of ${need.title}`} className="min-w-0" />
  );

  if (arrived) {
    return (
      <article aria-labelledby={titleId} className="overflow-hidden rounded-xl border bg-surface">
        <div className="relative">
          <ArrivalImage
            delivery={delivery}
            alt={`${need.title} after it arrived at ${item.orgName}`}
            orgName={item.orgName}
          />
          <StatusBadge status="delivered" className="absolute top-3 left-3" />
        </div>
        <div className="flex flex-col gap-3.5 p-4">
          <ItemSummary item={item} titleId={titleId} />
          <ArrivalNote title={need.title} delivery={delivery} orgName={item.orgName} />
          {timeline}
        </div>
      </article>
    );
  }

  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-3.5 rounded-xl border bg-surface p-4">
      <div className="flex items-start gap-3">
        <ProductPhoto
          product={need.product}
          className="size-16 rounded-[10px]"
          placeholderClassName="rounded-[10px]"
          iconClassName="size-6"
        />
        <ItemSummary item={item} titleId={titleId} showStatus />
      </div>
      {timeline}
      <p className="text-[13px] text-muted-foreground">
        {need.status === "delivered"
          ? `It arrived at ${item.orgName}. There's no photo for this one.`
          : "We'll post a photo here when it arrives."}
      </p>
    </article>
  );
}

type ItemSummaryProps = { item: ImpactItem; titleId: string; showStatus?: boolean };

/** Title, charity, why the money is here, and what this gift gave to it. */
function ItemSummary({ item, titleId, showStatus = false }: ItemSummaryProps) {
  const reason = reasonLabel(item.reason);
  const refunded = item.reason === "refund";
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex justify-between gap-2">
        <h2 id={titleId} className="min-w-0 text-base font-bold">
          {item.need.title}
        </h2>
        <p className="shrink-0 text-[15px] font-extrabold">
          {refunded ? `−${formatUsd(item.amountCents)}` : formatUsd(item.amountCents)}
        </p>
      </div>
      <p className="text-[13px] text-muted-foreground">
        {item.orgName}
        {reason ? ` · ${reason}` : null}
      </p>
      {showStatus ? <StatusBadge status={item.need.status} className="self-start" /> : null}
    </div>
  );
}

type ArrivalImageProps = { delivery: DeliveryPublic; alt: string; orgName: string };

function ArrivalImage({ delivery, alt, orgName }: ArrivalImageProps) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        role="img"
        aria-label={`${alt} (the photo didn't load)`}
        className="flex h-57.5 flex-col items-center justify-center gap-2 bg-placeholder-strong text-muted-foreground sm:h-80"
      >
        <ImageIcon aria-hidden="true" className="size-10" strokeWidth={1.5} />
        <span className="text-[13px]">Arrival photo from {orgName}</span>
      </div>
    );
  }
  return (
    <img
      src={delivery.photoUrl}
      alt={alt}
      decoding="async"
      className="h-57.5 w-full bg-placeholder-strong object-cover sm:h-80"
      onError={() => setFailed(true)}
    />
  );
}

type ArrivalNoteProps = { title: string; delivery: DeliveryPublic; orgName: string };

/** "Your diapers arrived!", the date, and the charity's message in their words. */
function ArrivalNote({ title, delivery, orgName }: ArrivalNoteProps) {
  const message = delivery.message?.trim() ?? "";
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] bg-quote-bg px-3.5 py-3 text-quote-text">
      <h3 className="text-[15px] font-extrabold">Your {itemName(title)} arrived!</h3>
      <p className="text-xs text-soft">
        Arrived <time dateTime={delivery.deliveredAt}>{formatShortDate(delivery.deliveredAt)}</time>
      </p>
      {message !== "" ? (
        <blockquote className="m-0 text-sm leading-normal">
          “{message}”<span className="mt-1 block text-xs text-soft">{orgName} staff</span>
        </blockquote>
      ) : null}
    </div>
  );
}

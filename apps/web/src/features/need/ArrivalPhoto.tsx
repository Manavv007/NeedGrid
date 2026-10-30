import type { DeliveryPublic } from "@needgrid/shared";
import { ImageIcon } from "lucide-react";
import { useState } from "react";

type ArrivalPhotoProps = { delivery: DeliveryPublic; needTitle: string; orgName: string };

/** The staff's arrival photo, large, with their message (NeedDeliveredPhone.dc.html). Text is plain text. */
export function ArrivalPhoto({ delivery, needTitle, orgName }: ArrivalPhotoProps) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="m-0 overflow-hidden rounded-xl border bg-surface">
      {failed ? (
        <div
          aria-hidden="true"
          className="flex h-70 items-center justify-center gap-2 bg-placeholder-strong text-[13px] text-muted-foreground"
        >
          <ImageIcon className="size-5.5" strokeWidth={1.5} />
          Arrival photo
        </div>
      ) : (
        <img
          src={delivery.photoUrl}
          alt={`${needTitle} after it arrived at ${orgName}`}
          decoding="async"
          className="max-h-120 w-full bg-placeholder-strong object-cover"
          onError={() => setFailed(true)}
        />
      )}
      {delivery.message ? (
        <figcaption className="bg-quote-bg px-4 py-3.5 text-[15px] leading-normal text-quote-text">
          “{delivery.message}”<span className="mt-1.5 block text-xs text-soft">{orgName} staff</span>
        </figcaption>
      ) : null}
    </figure>
  );
}

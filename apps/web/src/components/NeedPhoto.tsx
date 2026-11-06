import type { NeedCard } from "@needgrid/shared";
import { Camera } from "lucide-react";
import { useState } from "react";
import { arrivalPhotoUrl } from "@/lib/arrivalPhoto";
import { cn } from "@/lib/utils";
import { ProductPhoto } from "./ProductPhoto";

type NeedPhotoProps = {
  need: NeedCard;
  /** The frame: size, border, radius. Padding only affects the product photo; the arrival photo fills the frame. */
  className?: string;
  /** Passed to the product photo (see ProductPhoto). */
  placeholderClassName?: string;
  iconClassName?: string;
  labelClassName?: string;
  loading?: "lazy" | "eager";
  /** Size and position of the "Arrived" label over the arrival photo. */
  badgeClassName?: string;
  /**
   * The small product photo in the arrival photo's corner (TileStates.dc.html "Delivered"): its size
   * and visibility. Leave it out for none.
   */
  productInsetClassName?: string;
};

/**
 * The need's picture: once it is delivered with an arrival photo (`deliveryPhotoUrl`, Cloudinary
 * only), that photo fills the frame with an "Arrived" label, so donors see what really arrived.
 * Otherwise, or when the arrival photo fails to load, the product photo (ProductPhoto).
 */
export function NeedPhoto({
  need,
  className,
  placeholderClassName,
  iconClassName,
  labelClassName,
  loading = "lazy",
  badgeClassName,
  productInsetClassName,
}: NeedPhotoProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const arrival = arrivalPhotoUrl(need);

  if (arrival === null || arrival === failedSrc) {
    return (
      <ProductPhoto
        product={need.product}
        category={need.category}
        className={className}
        placeholderClassName={placeholderClassName}
        iconClassName={iconClassName}
        labelClassName={labelClassName}
        loading={loading}
      />
    );
  }

  return (
    <div className={cn("relative shrink-0 overflow-hidden bg-placeholder-strong", className)}>
      {/* eslint-disable-next-line jsx-a11y/img-redundant-alt -- "Arrival photo" tells donors it's the real arrival, not the product's stock image. */}
      <img
        src={arrival}
        alt={`Arrival photo of ${need.title}`}
        loading={loading}
        decoding="async"
        className="absolute inset-0 size-full object-cover"
        onError={() => setFailedSrc(arrival)}
      />
      {/* The alt text already says it's the arrival photo; this label is for sighted donors. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-foreground",
          badgeClassName,
        )}
      >
        <Camera className="size-[1.1em]" strokeWidth={2.5} />
        Arrived
      </span>
      {productInsetClassName === undefined ? null : (
        <div aria-hidden="true" className={cn("absolute right-3 bottom-3", productInsetClassName)}>
          <ProductPhoto
            product={need.product}
            category={need.category}
            className="size-full rounded-lg border-3 border-surface"
            placeholderClassName="rounded-[5px]"
            iconClassName="size-5"
          />
        </div>
      )}
    </div>
  );
}

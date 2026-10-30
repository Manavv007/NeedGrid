import type { ProductSnapshot } from "@needgrid/shared";
import { Package } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type ProductPhotoProps = {
  product: Pick<ProductSnapshot, "title" | "imageUrl"> | null;
  /** The frame: size, border, radius, padding. Its content is centred. */
  className?: string;
  /** The grey placeholder shown when there's no photo (or it fails to load). */
  placeholderClassName?: string;
  iconClassName?: string;
  /** Optional text under the placeholder icon, e.g. "No photo yet". */
  placeholderText?: ReactNode;
  loading?: "lazy" | "eager";
};

/**
 * A product photo, square-ish and `object-contain` on white, `alt` = product title. Falls back to the
 * designs' grey placeholder when there's no image URL or the image fails to load.
 */
export function ProductPhoto({
  product,
  className,
  placeholderClassName,
  iconClassName,
  placeholderText,
  loading = "lazy",
}: ProductPhotoProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = product?.imageUrl ?? null;
  const showImage = product !== null && src !== null && src !== failedSrc;

  return (
    <div className={cn("flex shrink-0 items-center justify-center overflow-hidden bg-surface", className)}>
      {showImage ? (
        <img
          src={src}
          alt={product.title}
          loading={loading}
          decoding="async"
          className="size-full object-contain"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <div
          aria-hidden="true"
          className={cn(
            "flex size-full flex-col items-center justify-center gap-2 bg-placeholder text-placeholder-icon",
            placeholderClassName,
          )}
        >
          <Package className={iconClassName} strokeWidth={1.5} />
          {placeholderText}
        </div>
      )}
    </div>
  );
}

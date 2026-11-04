import type { Category, ProductSnapshot } from "@needgrid/shared";
import {
  Apple,
  Baby,
  Backpack,
  BedDouble,
  Droplets,
  House,
  Package,
  PawPrint,
  Pill,
  Shirt,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { CATEGORY_LABELS } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Placeholder tint (C-11 tokens in globals.css) and icon per category. Class names are literal for Tailwind. */
const CATEGORY_LOOK: Readonly<Record<Category, { icon: LucideIcon; className: string }>> = {
  food: { icon: Apple, className: "bg-category-food-bg text-category-food-text" },
  hygiene: { icon: Droplets, className: "bg-category-hygiene-bg text-category-hygiene-text" },
  baby: { icon: Baby, className: "bg-category-baby-bg text-category-baby-text" },
  clothing: { icon: Shirt, className: "bg-category-clothing-bg text-category-clothing-text" },
  bedding: { icon: BedDouble, className: "bg-category-bedding-bg text-category-bedding-text" },
  school: { icon: Backpack, className: "bg-category-school-bg text-category-school-text" },
  pet: { icon: PawPrint, className: "bg-category-pet-bg text-category-pet-text" },
  medical: { icon: Pill, className: "bg-category-medical-bg text-category-medical-text" },
  household: { icon: House, className: "bg-category-household-bg text-category-household-text" },
  other: { icon: Package, className: "bg-category-other-bg text-category-other-text" },
};

type ProductPhotoProps = {
  product: Pick<ProductSnapshot, "title" | "imageUrl"> | null;
  /** The need's category: the placeholder's tint, icon and label. */
  category: Category;
  /** The frame: size, border, radius, padding. Its content is centred. */
  className?: string;
  /** The tinted placeholder shown when there's no photo (or it fails to load). */
  placeholderClassName?: string;
  iconClassName?: string;
  /**
   * Size (and, if needed, responsive visibility) of the category name under the placeholder icon.
   * Leave it out on compact thumbnails: they show only the tinted icon.
   */
  labelClassName?: string;
  loading?: "lazy" | "eager";
};

/**
 * A product photo, square-ish and `object-contain` on white, `alt` = product title. Without an image
 * URL, or when the image fails to load, a placeholder tinted for the need's category: its icon and,
 * on larger sizes, its plain-English name (food items have no Channel3 photo, so this is common).
 */
export function ProductPhoto({
  product,
  category,
  className,
  placeholderClassName,
  iconClassName,
  labelClassName,
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
        <CategoryPlaceholder
          title={product?.title ?? null}
          category={category}
          className={placeholderClassName}
          iconClassName={iconClassName}
          labelClassName={labelClassName}
        />
      )}
    </div>
  );
}

type CategoryPlaceholderProps = {
  title: string | null;
  category: Category;
  className: string | undefined;
  iconClassName: string | undefined;
  labelClassName: string | undefined;
};

function CategoryPlaceholder({ title, category, className, iconClassName, labelClassName }: CategoryPlaceholderProps) {
  const { icon: Icon, className: tint } = CATEGORY_LOOK[category];
  const label = CATEGORY_LABELS[category];
  return (
    <div
      role="img"
      aria-label={`No photo for ${title ?? "this item"} (${label})`}
      className={cn("flex size-full flex-col items-center justify-center gap-2 px-1.5 text-center", tint, className)}
    >
      <Icon aria-hidden="true" className={iconClassName} strokeWidth={1.75} />
      {labelClassName === undefined ? null : (
        <span className={cn("leading-tight font-semibold", labelClassName)}>{label}</span>
      )}
    </div>
  );
}

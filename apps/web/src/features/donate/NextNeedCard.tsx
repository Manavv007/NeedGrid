import type { NeedCard } from "@needgrid/shared";
import { useId } from "react";
import { Link } from "react-router";
import { ProductPhoto } from "@/components/ProductPhoto";
import { ProgressBar } from "@/components/ProgressBar";
import { UrgencyBadge } from "@/components/UrgencyBadge";
import { formatLeft, formatUsdShort } from "@/lib/format";
import { needPath } from "@/lib/links";

type NextNeedCardProps = {
  need: NeedCard;
  /**
   * `card`: photo, urgency, progress (JustFundedPhone.dc.html), with the Fund button outside.
   * `link`: one compact row that is itself the Fund link (NeedFundedPhone.dc.html).
   */
  variant?: "card" | "link";
};

/** The charity's next most urgent need, offered after "this one is covered". Amounts as the server sent them. */
export function NextNeedCard({ need, variant = "card" }: NextNeedCardProps) {
  const titleId = useId();
  const left = formatLeft(need.status, need.remainingCents);
  const target = formatUsdShort(need.targetCents);

  if (variant === "link") {
    return (
      <Link
        to={needPath(need.orgSlug, need.id, { donate: true })}
        aria-label={`Fund ${need.title}, ${left} of ${target}`}
        className="flex items-center gap-3 rounded-xl border bg-surface p-3 text-foreground no-underline hover:border-border-strong hover:text-foreground"
      >
        <ProductPhoto
          product={need.product}
          className="size-13 rounded-md border"
          placeholderClassName="rounded-md"
          iconClassName="size-5"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <strong className="text-[15px] leading-snug">{need.title}</strong>
          <span className="text-[13px]">
            <strong className="font-extrabold text-left-text">{left}</strong>{" "}
            <span className="text-muted-foreground">of {target}</span>
          </span>
        </span>
        <span className="shrink-0 text-sm font-bold text-primary">Fund</span>
      </Link>
    );
  }

  const meta = need.product
    ? `${need.quantity} × ${need.unit} · ${need.product.retailer}`
    : `${need.quantity} × ${need.unit}`;
  return (
    <article aria-labelledby={titleId} className="flex gap-3 rounded-xl border bg-surface p-3">
      <ProductPhoto
        product={need.product}
        className="size-21 rounded-[10px] border"
        placeholderClassName="rounded-[10px]"
        iconClassName="size-6.5"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.75">
        <div className="flex items-start justify-between gap-2">
          <h3 id={titleId} className="text-[15px] leading-snug font-bold">
            {need.title}
          </h3>
          <UrgencyBadge urgency={need.urgency} className="px-2 py-0.5 text-[11px]" />
        </div>
        <p className="text-xs text-muted-foreground">{meta}</p>
        <ProgressBar
          size="sm"
          fundedCents={need.fundedCents}
          heldCents={need.heldCents}
          targetCents={need.targetCents}
          label={`${need.title} funding`}
          valueText={`${formatUsdShort(need.fundedCents)} of ${target} raised, ${left}`}
        />
        <p className="text-sm">
          <strong className="font-extrabold text-left-text">{left}</strong>{" "}
          <span className="text-xs text-muted-foreground">of {target}</span>
        </p>
      </div>
    </article>
  );
}

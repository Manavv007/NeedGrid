import type { NeedCard, ProductSnapshot } from "@needgrid/shared";
import { Clock } from "lucide-react";
import { useId } from "react";
import { Link } from "react-router";
import { ProductPhoto } from "@/components/ProductPhoto";
import { ProgressBar } from "@/components/ProgressBar";
import { StatusBadge } from "@/components/StatusBadge";
import { UrgencyBadge } from "@/components/UrgencyBadge";
import { buttonVariants } from "@/components/ui/button";
import { formatDonorCount, formatNeededBy, formatUsdShort } from "@/lib/format";
import { needPath } from "@/lib/links";
import { cn } from "@/lib/utils";
import { isDonatable, tabOf } from "./filterNeeds";

/** Grid for TileCards (brief §9.2): 1 column on phones, 2 at 640 px, 3 at 1024 px, 4 at 1440 px. */
export const TILE_GRID = "grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 min-[90rem]:grid-cols-4";

/** Copy under the bar for tiles that no longer take donations (TileStates.dc.html). */
const DONE_NOTE = {
  funded: "Fully funded. We're buying it now.",
  ordered: "On its way. Photo coming when it lands.",
  delivered: "Delivered · photo on the item page",
} as const;

// Phone badges are a size smaller so they fit beside the title (TileWallPhone.dc.html).
const BADGE_SIZE = "px-2 py-0.5 text-[11px] sm:px-2.5 sm:py-1 sm:text-xs";

type TileCardProps = {
  need: NeedCard;
  /** Just became funded: a brief green highlight (no animation with reduced motion). */
  highlight?: boolean;
};

/**
 * One need on the tile wall. Under 640 px it is the compact horizontal card from
 * TileWallPhone.dc.html; from 640 px the vertical card from Main.dc.html. Same markup, CSS only.
 *
 * Links never nest: the title link stretches over the whole card with an ::after overlay, and the
 * fund / photo links sit above that overlay (`relative z-10`).
 */
export function TileCard({ need, highlight = false }: TileCardProps) {
  const titleId = useId();
  if (tabOf(need.status) === null) return null; // drafts and closed needs are never public

  const href = needPath(need.orgSlug, need.id);
  const quantity = `${need.quantity} × ${need.unit}`;
  const meta = need.product ? `${quantity} · ${need.product.retailer}` : quantity;

  return (
    <article
      aria-labelledby={titleId}
      data-just-funded={highlight || undefined}
      className={cn(
        "group relative flex flex-1 gap-3 rounded-xl border bg-surface p-3 transition-colors hover:border-border-strong sm:flex-col sm:gap-0 sm:p-0",
        highlight && "border-success hover:border-success motion-safe:animate-just-funded",
      )}
    >
      <ProductImage product={need.product} />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.75 sm:flex-col sm:flex-nowrap sm:items-stretch sm:gap-2.5 sm:px-4 sm:pt-3.5 sm:pb-4">
        <div className="flex w-full items-start justify-between gap-2">
          <h2 id={titleId} className="min-w-0 text-[15px] leading-[1.3] font-bold sm:text-base">
            <Link
              to={href}
              className="text-foreground no-underline group-hover:underline after:absolute after:inset-0 after:rounded-xl hover:text-foreground focus-visible:outline-none focus-visible:after:outline-3 focus-visible:after:outline-offset-2 focus-visible:after:outline-primary"
            >
              {need.title}
            </Link>
          </h2>
          <TileBadges need={need} />
        </div>
        <p className="w-full text-xs text-muted-foreground sm:-mt-1.5 sm:text-[13px]">{meta}</p>
        {isDonatable(need.status) ? <DonatableBody need={need} /> : <DoneBody need={need} href={href} />}
      </div>
    </article>
  );
}

/** Square product photo on white, or the design's grey placeholder. Fixed size, so nothing jumps. */
function ProductImage({ product }: { product: ProductSnapshot | null }) {
  return (
    <ProductPhoto
      product={product}
      className="size-24 rounded-[10px] border sm:aspect-square sm:h-auto sm:w-full sm:rounded-none sm:rounded-t-xl sm:border-0 sm:border-b sm:p-4"
      placeholderClassName="sm:size-[62%] sm:rounded-xl"
      iconClassName="size-7.5 sm:size-9"
      placeholderText={<span className="hidden text-xs sm:block">No photo yet</span>}
    />
  );
}

/**
 * Status and urgency. Phones: beside the title. From 640 px: over the photo's top-left corner.
 * Urgency only matters while a tile takes donations; done tiles show their status instead.
 */
function TileBadges({ need }: { need: NeedCard }) {
  const donatable = isDonatable(need.status);
  return (
    <div className="pointer-events-none flex shrink-0 flex-col items-end gap-1 sm:absolute sm:inset-x-3 sm:top-3 sm:flex-row sm:flex-wrap sm:items-start">
      {need.status === "open" ? null : <StatusBadge status={need.status} className={BADGE_SIZE} />}
      {donatable ? <UrgencyBadge urgency={need.urgency} className={BADGE_SIZE} /> : null}
    </div>
  );
}

/** open / topping_up: progress with the held segment, what's left, donors, deadline, fund button. */
function DonatableBody({ need }: { need: NeedCard }) {
  const toppingUp = need.status === "topping_up";
  const left = formatUsdShort(need.remainingCents);
  const target = formatUsdShort(need.targetCents);
  const leftLabel = toppingUp ? `${left} more needed` : `${left} left`;
  const held = need.heldCents > 0 ? `, ${formatUsdShort(need.heldCents)} being paid now` : "";
  const neededBy = formatNeededBy(need.deadlineAt);
  const canFund = need.remainingCents > 0;

  return (
    <>
      <ProgressBar
        fundedCents={need.fundedCents}
        heldCents={need.heldCents}
        targetCents={need.targetCents}
        label={`${need.title} funding`}
        valueText={`${formatUsdShort(need.fundedCents)} of ${target} raised${held}, ${leftLabel}`}
        className="h-2 w-full sm:h-2.5"
      />
      {/* Phones: amount and fund button share a row (this wrapper vanishes). From 640 px: amount | donors. */}
      <div className="contents sm:flex sm:items-baseline sm:justify-between sm:gap-2">
        <p className="min-w-0 flex-1 text-sm sm:text-[15px]">
          <strong className="font-extrabold text-left-text">{leftLabel}</strong>{" "}
          <span className="text-xs text-muted-foreground sm:text-[15px]">of {target}</span>
        </p>
        <p className="hidden shrink-0 text-xs text-muted-foreground sm:block">{formatDonorCount(need.donorCount)}</p>
      </div>
      {neededBy ? (
        <p className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <Clock aria-hidden="true" className="size-3.25" />
          Needed by {neededBy}
        </p>
      ) : null}
      {canFund ? (
        <Link
          to={needPath(need.orgSlug, need.id, { donate: true })}
          className={cn(buttonVariants(), "relative z-10 ml-auto sm:mt-auto sm:ml-0 sm:w-full")}
        >
          {toppingUp ? (
            "Help finish it"
          ) : (
            // One flex item, and the space sits outside the hidden span so names read "Fund this item".
            <span>
              Fund <span className="hidden sm:inline">this item</span>
            </span>
          )}
          <span className="sr-only">: {need.title}</span>
        </Link>
      ) : (
        <p className="w-full text-xs text-soft sm:text-[13px]">Donors are paying for the rest right now.</p>
      )}
    </>
  );
}

/** funded / ordered / delivered: what was raised and what happens next. No fund button. */
function DoneBody({ need, href }: { need: NeedCard; href: string }) {
  const status = need.status === "funded" || need.status === "ordered" ? need.status : "delivered";
  return (
    <>
      {status === "delivered" ? null : (
        <ProgressBar
          complete
          fundedCents={need.fundedCents}
          heldCents={0}
          targetCents={need.targetCents}
          label={`${need.title} funding`}
          valueText={`${formatUsdShort(need.fundedCents)} of ${formatUsdShort(need.targetCents)} raised, fully funded`}
          className="h-2 w-full sm:h-2.5"
        />
      )}
      <p className="w-full text-sm font-extrabold text-success sm:text-[15px]">
        {formatUsdShort(need.fundedCents)} raised · {formatDonorCount(need.donorCount)}
      </p>
      <p className="w-full text-xs text-soft sm:text-[13px]">{DONE_NOTE[status]}</p>
      {status === "delivered" ? (
        <Link
          to={href}
          className="relative z-10 inline-flex min-h-11 items-center self-start text-sm font-bold sm:-my-1.5"
        >
          See the photo<span className="sr-only">: {need.title}</span>
        </Link>
      ) : null}
    </>
  );
}

/** Loading placeholder with the same responsive shape as TileCard (States.dc.html "Loading"). */
export function TileCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex gap-3 rounded-xl border bg-surface p-3 motion-safe:animate-pulse sm:flex-col sm:gap-3.5 sm:p-5.5"
    >
      <div className="size-24 shrink-0 rounded-[10px] bg-track sm:aspect-square sm:h-auto sm:w-full" />
      <div className="flex flex-1 flex-col gap-2.5 sm:gap-3.5">
        <div className="h-4 w-[70%] rounded-md bg-track" />
        <div className="h-3 w-[45%] rounded-md bg-placeholder" />
        <div className="h-2 rounded-full bg-track sm:h-2.5" />
        <div className="h-11 rounded-md bg-track" />
      </div>
    </div>
  );
}

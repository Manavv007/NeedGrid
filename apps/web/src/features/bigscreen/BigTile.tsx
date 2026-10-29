import type { NeedCard } from "@needgrid/shared";
import { useId } from "react";
import { ProductPhoto } from "@/components/ProductPhoto";
import { ProgressBar } from "@/components/ProgressBar";
import { isDonatable } from "@/features/tiles/filterNeeds";
import { formatLeft, formatUsdShort } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The line under the bar: what's left, or the tile's good news. Amounts are the server's. */
function statusLine(need: NeedCard): string {
  if (need.status === "funded") return "Funded ✓";
  if (need.status === "ordered") return "Ordered, on its way";
  if (need.remainingCents === 0) return "Being paid for now";
  return formatLeft(need.status, need.remainingCents);
}

type BigTileProps = {
  need: NeedCard;
  /** Just became funded: a short green pulse (none with reduced motion). */
  highlight: boolean;
};

/**
 * A large, compact tile for the wall (BigScreen.dc.html): photo, title, bar, what's left. Not a
 * link: nobody clicks a wall; donors scan the QR code. Sizes are in rem, which scale with the screen.
 * One ProgressBar in every state, so a tile that gets funded fills up and turns green.
 */
export function BigTile({ need, highlight }: BigTileProps) {
  const titleId = useId();
  const done = !isDonatable(need.status);
  const left = formatLeft(need.status, need.remainingCents);
  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "flex h-full items-center gap-5 rounded-[1.125rem] border bg-surface p-5.5",
        done && "border-3 border-success",
        highlight && "motion-safe:animate-just-funded",
      )}
    >
      <ProductPhoto
        product={need.product}
        loading="eager"
        className="size-[8.75rem] rounded-[0.875rem] border"
        placeholderClassName="rounded-[0.875rem]"
        iconClassName="size-11"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <h2 id={titleId} className="line-clamp-2 text-[1.75rem] leading-[1.15] font-extrabold">
          {need.title}
        </h2>
        <ProgressBar
          size="xl"
          complete={done}
          fundedCents={need.fundedCents}
          heldCents={done ? 0 : need.heldCents}
          targetCents={need.targetCents}
          label={`${need.title} funding`}
          valueText={
            done
              ? `${formatUsdShort(need.fundedCents)} of ${formatUsdShort(need.targetCents)} raised, fully funded`
              : `${formatUsdShort(need.fundedCents)} of ${formatUsdShort(need.targetCents)} raised, ${left}`
          }
        />
        <p className={cn("text-[1.625rem] leading-tight font-extrabold", done ? "text-success" : "text-left-text")}>
          {statusLine(need)}
        </p>
      </div>
    </article>
  );
}

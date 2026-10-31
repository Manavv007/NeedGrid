import type { NeedCard } from "@needgrid/shared";
import { ChevronLeft } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { Link } from "react-router";
import { ProgressBar } from "@/components/ProgressBar";
import { StatusBadge } from "@/components/StatusBadge";
import { consoleTabPath, DEFAULT_TAB, tabForStatus } from "@/features/staff/console/consoleTabs";
import { formatDonorCount, formatUsdShort } from "@/lib/format";
import { needPath } from "@/lib/links";

type NeedHeaderProps = {
  need: NeedCard;
  headingRef: Ref<HTMLHeadingElement>;
  /** The Edit need button (and its dialog), when the need can still be edited. */
  actions: ReactNode;
};

const COMPLETE: readonly NeedCard["status"][] = ["funded", "ordered", "delivered"];
/** Statuses the public site shows (drafts and closed needs are 404 there). */
const PUBLIC: readonly NeedCard["status"][] = ["open", "topping_up", "funded", "ordered", "delivered"];

/** Title, status, quantity, funding and links (PurchasePlan.dc.html header). Amounts are the server's. */
export function NeedHeader({ need, headingRef, actions }: NeedHeaderProps) {
  const tab = tabForStatus(need.status);
  return (
    <div className="flex flex-col gap-4">
      <Link
        to={tab === DEFAULT_TAB ? "/staff" : consoleTabPath(tab)}
        className="-ml-2 inline-flex min-h-11 items-center gap-1.5 self-start rounded-md px-2 text-[15px] font-semibold text-foreground no-underline hover:text-foreground"
      >
        <ChevronLeft aria-hidden="true" className="size-4.5" />
        Back to needs
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-[28px] leading-tight font-extrabold tracking-[-0.02em] outline-none"
            >
              {need.title}
            </h1>
            <StatusBadge status={need.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {need.quantity} × {need.unit}
            {PUBLIC.includes(need.status) ? (
              <>
                {" "}
                <span aria-hidden="true">·</span> <Link to={needPath(need.orgSlug, need.id)}>View public page</Link>
              </>
            ) : null}
          </p>
        </div>
        {actions}
      </div>
      <div className="flex max-w-md flex-col gap-1.5">
        <ProgressBar
          fundedCents={need.fundedCents}
          heldCents={need.heldCents}
          targetCents={need.targetCents}
          label={`${need.title} funding`}
          complete={COMPLETE.includes(need.status)}
        />
        <p className="text-sm text-soft">
          {formatUsdShort(need.fundedCents)} of {formatUsdShort(need.targetCents)} <span aria-hidden="true">·</span>{" "}
          {formatDonorCount(need.donorCount)}
        </p>
      </div>
    </div>
  );
}

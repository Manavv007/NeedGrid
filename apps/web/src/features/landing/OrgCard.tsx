import type { OrgSummary } from "@needgrid/shared";
import { Link } from "react-router";
import { formatUsdShort } from "@/lib/format";

/** One charity on the landing page; the whole card links to its tile wall. */
export function OrgCard({ org }: { org: OrgSummary }) {
  const eyebrow = [...org.causeTags, org.city].filter(Boolean).join(" · ");
  return (
    <Link
      to={`/o/${encodeURIComponent(org.slug)}`}
      className="flex flex-col gap-3 rounded-xl border bg-surface p-5 text-foreground no-underline transition-colors hover:border-border-strong hover:text-foreground"
    >
      <div>
        <p className="mb-1 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">{eyebrow}</p>
        <h3 className="text-[19px] font-extrabold">{org.name}</h3>
      </div>
      <p className="flex flex-wrap gap-x-4.5 gap-y-1 text-[13px] text-muted-foreground">
        <span>
          <strong className="text-[15px] text-foreground">{formatUsdShort(org.stats.raisedCents)}</strong> raised
        </span>
        <span>
          <strong className="text-[15px] text-foreground">{org.stats.itemsDelivered}</strong> delivered
        </span>
        <span>
          <strong className="text-[15px] text-left-text">{org.stats.openNeeds}</strong> still needed
        </span>
      </p>
      <span className="text-sm font-bold text-primary">
        See their list <span aria-hidden="true">→</span>
      </span>
    </Link>
  );
}

/** Loading placeholder with the same shape as OrgCard. */
export function OrgCardSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3 rounded-xl border bg-surface p-5 motion-safe:animate-pulse">
      <div className="h-3 w-36 rounded-md bg-placeholder" />
      <div className="h-5 w-48 rounded-md bg-track" />
      <div className="h-4 w-56 rounded-md bg-placeholder" />
      <div className="h-4 w-28 rounded-md bg-track" />
    </div>
  );
}

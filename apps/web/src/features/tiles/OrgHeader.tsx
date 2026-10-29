import type { OrgPublic, OrgStats } from "@needgrid/shared";
import { Link as LinkIcon, Printer, Share } from "lucide-react";
import { Link, useLocation } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { features } from "@/lib/features";
import { formatUsdWhole } from "@/lib/format";
import { orgFlyerPath } from "@/lib/links";

type OrgHeaderProps = { org: OrgPublic; stats: OrgStats };

/** Charity name, description, Share / Print flyer and the four stats (Main.dc.html, TileWallPhone.dc.html). */
export function OrgHeader({ org, stats }: OrgHeaderProps) {
  const eyebrow = [...org.causeTags, org.city].filter(Boolean).join(" · ");
  return (
    <header className="relative pt-5 sm:pt-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        {/* Phones keep room on the right for the Share icon button. */}
        <div className="max-w-160 pr-14 sm:pr-0">
          {eyebrow ? (
            <p className="mb-1 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase sm:mb-1.5 sm:text-[13px]">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="mb-2 text-[28px] leading-[1.15] font-extrabold tracking-[-0.03em] sm:mb-2.5 sm:text-[40px] sm:leading-[1.1]">
            {org.name}
          </h1>
          {org.description ? (
            <p className="text-[15px] leading-normal text-soft sm:text-base sm:leading-[1.55]">{org.description}</p>
          ) : null}
        </div>
        <div className="absolute top-5 right-0 flex gap-2.5 sm:static">
          <ShareButton orgName={org.name} />
          {features.flyers ? (
            <Button variant="outline" asChild className="hidden sm:inline-flex">
              <Link to={orgFlyerPath(org.slug)}>
                <Printer aria-hidden="true" />
                Print flyer
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
      <OrgStatList stats={stats} />
    </header>
  );
}

/**
 * Phones: the system share sheet. Elsewhere (or if sharing fails): copy the link. Cancelling the
 * share sheet is not an error.
 */
function ShareButton({ orgName }: { orgName: string }) {
  const location = useLocation();

  async function share() {
    const url = new URL(`${location.pathname}${location.search}`, window.location.origin).toString();
    if ("share" in navigator) {
      try {
        await navigator.share({ title: `${orgName} on NeedGrid`, url });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("We couldn't copy the link", { description: "Copy it from your browser's address bar instead." });
    }
  }

  return (
    <Button variant="outline" size="icon" className="sm:w-auto sm:gap-2 sm:px-4" onClick={() => void share()}>
      <Share aria-hidden="true" className="size-4.5 sm:hidden" />
      <LinkIcon aria-hidden="true" className="hidden sm:block" />
      <span className="sr-only sm:not-sr-only">Share</span>
    </Button>
  );
}

/** Four stat cards from 640 px; on phones a compact, wrapping line of "$532 raised"-style pairs. */
function OrgStatList({ stats }: { stats: OrgStats }) {
  const items = [
    { label: "Raised", value: formatUsdWhole(stats.raisedCents) },
    { label: "Items delivered", value: stats.itemsDelivered.toLocaleString("en-US") },
    { label: "Still needed", value: stats.openNeeds.toLocaleString("en-US") },
    { label: "Items funded", value: stats.itemsFunded.toLocaleString("en-US") },
  ];
  return (
    <dl className="mt-3.5 flex flex-wrap gap-x-4.5 gap-y-1 sm:mt-6 sm:grid sm:grid-cols-2 sm:gap-3 md:grid-cols-4">
      {items.map(({ label, value }) => (
        // DOM order is label → value (read as "Raised, $532"); phones show the value first.
        <div
          key={label}
          className="flex flex-row-reverse items-baseline justify-end gap-1 text-[13px] text-muted-foreground sm:flex-col sm:justify-start sm:rounded-xl sm:border sm:bg-surface sm:p-4"
        >
          <dt className="lowercase sm:normal-case">{label}</dt>
          <dd className="text-base font-bold text-foreground sm:text-[26px] sm:leading-tight sm:font-extrabold sm:tracking-[-0.02em]">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Loading placeholder with the same shape as OrgHeader. */
export function OrgHeaderSkeleton() {
  return (
    <div aria-hidden="true" className="pt-5 motion-safe:animate-pulse sm:pt-8">
      <div className="flex max-w-160 flex-col gap-3">
        <div className="h-3 w-40 rounded-md bg-placeholder" />
        <div className="h-8 w-72 max-w-full rounded-md bg-track sm:h-10" />
        <div className="h-4 w-full rounded-md bg-placeholder" />
        <div className="h-4 w-[80%] rounded-md bg-placeholder" />
      </div>
      <div className="mt-3.5 grid grid-cols-2 gap-3 sm:mt-6 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-11 rounded-xl bg-track sm:h-20" />
        ))}
      </div>
    </div>
  );
}

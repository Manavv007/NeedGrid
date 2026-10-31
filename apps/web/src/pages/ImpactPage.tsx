import type { ImpactItem, ImpactRes } from "@needgrid/shared";
import { Gift } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/button";
import { WakingUp } from "@/components/WakingUp";
import { UnassignedNote } from "@/features/impact/GiftSplit";
import { ImpactItemCard } from "@/features/impact/ImpactItemCard";
import { arrivedAt, impactHeadline, sortImpactItems } from "@/features/impact/impactItems";
import { SaveImpactLink } from "@/features/impact/SaveImpactLink";
import { ApiClientError } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { orgPath } from "@/lib/links";
import { useImpact } from "@/lib/queries";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { NotFoundPage } from "./NotFoundPage";

const PAGE = "mx-auto w-full max-w-xl px-4";
/** Arrival photos are checked for once a minute while the page is open (brief §9.5). */
export const IMPACT_REFRESH_MS = 60_000;

const isNotFound = (error: unknown) => error instanceof ApiClientError && error.code === "NOT_FOUND";

/**
 * `/impact/:token`: everything one gift paid for, with arrival photos (brief §9.5, ImpactPhone.dc.html).
 * A private link: kept out of search engines. Fresh through a 60 s refetch, no live stream.
 */
export function ImpactPage() {
  const { token = "" } = useParams();
  const impact = useImpact(token, { refetchInterval: IMPACT_REFRESH_MS });
  const notFound = !impact.data && isNotFound(impact.error);

  useDocumentTitle(notFound ? "Gift not found · NeedGrid" : "Your impact · NeedGrid");

  // Data first: a failed background refetch keeps showing what we already have.
  const content = impact.data ? (
    <Impact token={token} impact={impact.data} />
  ) : notFound ? (
    <NotFoundPage
      title="We couldn't find that gift"
      message="Check that the link was copied in full. Your gift is safe either way."
      linkLabel="Go to NeedGrid"
    />
  ) : impact.isError ? (
    <div className={`${PAGE} py-12`}>
      <ErrorState onRetry={() => void impact.refetch()} />
    </div>
  ) : (
    <ImpactLoading />
  );

  return (
    <>
      {/* React puts this in <head> while the page is shown. */}
      <meta name="robots" content="noindex" />
      {content}
    </>
  );
}

function Impact({ token, impact }: { token: string; impact: ImpactRes }) {
  const items = sortImpactItems(impact.items);
  const orgSlug = impact.items[0]?.need.orgSlug ?? null;
  const announcement = useArrivalAnnouncement(items);
  const count = items.length;

  return (
    <div className={`${PAGE} flex flex-col gap-4 pt-6 pb-14`}>
      <header className="flex flex-col gap-1.5">
        <p className="text-sm text-muted-foreground">Your impact</p>
        <h1 className="text-[28px] leading-[1.15] font-extrabold tracking-[-0.03em]">
          {impactHeadline(impact.donorFirstName, items)}
        </h1>
        <p className="text-[15px] text-soft">
          You&apos;ve given <strong className="text-foreground">{formatUsd(impact.totalCents)}</strong>
          {count > 0 ? ` across ${count} ${count === 1 ? "item" : "items"}` : ""}.
        </p>
      </header>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {count > 0 ? (
        <ul aria-label="What your gift paid for" className="m-0 flex list-none flex-col gap-4 p-0">
          {items.map((item) => (
            <li key={`${item.need.id}:${item.reason}`}>
              <ImpactItemCard item={item} />
            </li>
          ))}
        </ul>
      ) : impact.totalCents === 0 ? (
        <EmptyState
          icon={<Gift className="size-6.5" />}
          title="This gift was refunded"
          message="It isn't paying for any items now. Thank you for giving."
        />
      ) : null}
      <UnassignedNote totalCents={impact.totalCents} items={impact.items} />

      <SaveImpactLink token={token} variant="quiet" />
      <Button asChild size="lg" variant="outline">
        <Link to={orgSlug ? orgPath(orgSlug) : { pathname: "/", hash: "#orgs" }}>Fund another item</Link>
      </Button>
      <p className="mt-1 text-center text-xs leading-normal text-muted-foreground">
        This page is not a tax receipt. PayPal sandbox demo.
      </p>
    </div>
  );
}

/**
 * "Women's socks arrived. The photo is on this page." when a refetch brings a new arrival while the
 * donor is here. Nothing is announced for what was already there on the first load.
 */
function useArrivalAnnouncement(items: readonly ImpactItem[]): string {
  const arrived = items.filter((item) => arrivedAt(item) !== null);
  const key = arrived.map((item) => item.need.id).join(",");
  const [seenKey, setSeenKey] = useState(key);
  const [announcement, setAnnouncement] = useState("");
  if (key !== seenKey) {
    const before = new Set(seenKey.split(","));
    const fresh = arrived.filter((item) => !before.has(item.need.id));
    setSeenKey(key);
    if (fresh.length > 0) {
      setAnnouncement(`${fresh.map((item) => `${item.need.title} arrived.`).join(" ")} The photo is on this page.`);
    }
  }
  return announcement;
}

/** Shaped like the page: greeting, a photo card and an item card; "Waking up the server…" after 3 s. */
function ImpactLoading() {
  return (
    <div role="status" className={`${PAGE} flex flex-col gap-4 pt-6 pb-14`}>
      <span className="sr-only">Loading your impact…</span>
      <div aria-hidden="true" className="flex flex-col gap-4 motion-safe:animate-pulse">
        <div className="h-4 w-24 rounded-md bg-placeholder" />
        <div className="h-8 w-[85%] rounded-md bg-track" />
        <div className="h-4 w-56 rounded-md bg-placeholder" />
        <div className="h-80 w-full rounded-xl bg-track" />
        <div className="h-36 w-full rounded-xl bg-track" />
      </div>
      <WakingUp />
    </div>
  );
}

import { Id, type NeedDetailRes } from "@needgrid/shared";
import { ChevronLeft } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router";
import { ErrorState } from "@/components/ErrorState";
import { Timeline } from "@/components/Timeline";
import { WakingUp } from "@/components/WakingUp";
import { DonatePanel } from "@/features/donate/DonatePanel";
import type { CheckoutPhaseName } from "@/features/donate/useCheckout";
import { FundNextNeed } from "@/features/need/FundNextNeed";
import { NeedInfo } from "@/features/need/NeedInfo";
import { NeedStatusBox } from "@/features/need/NeedStatusBox";
import { DonateSheet, PhoneDonateBar } from "@/features/need/PhoneDonate";
import { LiveStatus } from "@/features/live/LiveStatus";
import { useLiveUpdates } from "@/features/live/useLiveUpdates";
import { isDonatable } from "@/features/tiles/filterNeeds";
import { ApiClientError } from "@/lib/api";
import { needPath, orgPath } from "@/lib/links";
import { useNeed } from "@/lib/queries";
import { useOrgStream } from "@/lib/sse";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { NotFoundPage } from "./NotFoundPage";

const PAGE = "mx-auto w-full max-w-300 px-4 sm:px-6";
const NOT_FOUND_TITLE = "Item not found · NeedGrid";

const isNotFound = (error: unknown) => error instanceof ApiClientError && error.code === "NOT_FOUND";

/** `/o/:slug/n/:needId`: one need and its donate panel (brief §9.3). */
export function NeedPage() {
  const { slug = "", needId = "" } = useParams();
  // A malformed id is simply "not found", like the API; no request needed.
  if (!Id.safeParse(needId).success) return <NeedNotFound />;
  // Keyed so "Fund the next need" starts a fresh panel instead of reusing this one's state.
  return <NeedPageContent key={needId} slug={slug} needId={needId} />;
}

function NeedNotFound() {
  useDocumentTitle(NOT_FOUND_TITLE);
  return (
    <NotFoundPage
      title="We couldn't find that item"
      message="It may have been removed, or the link was mistyped. Every charity's list is on the home page."
      linkLabel="See all charities"
    />
  );
}

function NeedPageContent({ slug, needId }: { slug: string; needId: string }) {
  const need = useNeed(needId);
  const location = useLocation();
  const detail = need.data;
  // Live from the first render (and kept from the tile wall when the donor came from there).
  useOrgStream(slug);

  useDocumentTitle(detail ? `${detail.need.title} · ${detail.org.name} · NeedGrid` : null);

  // Data first: a failed background refetch keeps showing what we already have.
  if (detail) {
    // Never show one charity's need under another charity's address.
    if (detail.need.orgSlug !== slug) {
      return (
        <Navigate replace to={{ pathname: needPath(detail.need.orgSlug, detail.need.id), search: location.search }} />
      );
    }
    return <NeedView detail={detail} />;
  }
  if (isNotFound(need.error)) return <NeedNotFound />;
  if (need.isError) {
    return (
      <div className={`${PAGE} py-12`}>
        <ErrorState onRetry={() => void need.refetch()} />
      </div>
    );
  }
  return <NeedPageLoading />;
}

function NeedView({ detail }: { detail: NeedDetailRes }) {
  const { need, org, timeline, delivery } = detail;
  const timelineId = useId();
  const [params, setParams] = useSearchParams();
  // `?donate=1` (the tile's Fund button) is read once, then dropped so Back or a refresh doesn't reopen it.
  const [cameToDonate] = useState(() => params.get("donate") === "1");
  const isDesktop = useMediaQuery(DESKTOP_QUERY, true);
  const [sheetOpen, setSheetOpen] = useState(() => cameToDonate && !isDesktop);
  const [phase, setPhase] = useState<CheckoutPhaseName>("idle");

  useEffect(() => {
    if (params.get("donate") === null) return;
    const next = new URLSearchParams(params);
    next.delete("donate");
    setParams(next, { replace: true, preventScrollReset: true });
  }, [params, setParams]);

  const takesDonations = isDonatable(need.status) && need.remainingCents > 0;
  // Once a payment has started, the panel stays even if the need fills up meanwhile (often with
  // this donor's own hold), so the donor sees how their payment ends.
  const showPanel = takesDonations || phase !== "idle";
  const busy = phase === "creating" || phase === "capturing";
  // Someone else funded it while the donor was only choosing an amount: the status view replaces the
  // panel, and the sheet must not pop back open if the item takes donations again later.
  if (!showPanel && sheetOpen) setSheetOpen(false);
  // Live changes to this item are announced, except while the donor is paying (they're the donor's).
  const live = useLiveUpdates(need.orgSlug, { needId: need.id, quiet: phase !== "idle" });
  // Never move a panel mid-payment: an open sheet stays a sheet if the window grows (a phone
  // rotating), and a payment started in the column stays there if the window shrinks.
  const panelInColumn = showPanel && !sheetOpen && (isDesktop || phase !== "idle");
  const panelInSheet = showPanel && !panelInColumn && (!isDesktop || sheetOpen);
  const showBar = panelInSheet && !isDesktop;

  function changeSheet(open: boolean) {
    if (!open && busy) return; // never lose a payment that is being created or confirmed
    setSheetOpen(open);
    if (!open) setPhase("idle");
  }

  return (
    <div className={`${PAGE} flex flex-1 flex-col pt-3 md:pt-5 ${showBar ? "" : "pb-14"}`}>
      <Link
        to={orgPath(org.slug)}
        className="-ml-2 inline-flex min-h-11 items-center gap-1.5 self-start rounded-md px-2 text-[15px] font-semibold text-foreground no-underline hover:text-foreground"
      >
        <ChevronLeft aria-hidden="true" className="size-4.5" />
        {org.name}
      </Link>

      <div
        className={`mt-3 grid grid-cols-1 gap-6 md:mt-4 md:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] md:grid-rows-[auto_1fr] md:gap-x-8 md:gap-y-7 ${showBar ? "mb-6" : ""}`}
      >
        <div className="min-w-0 md:col-start-1 md:row-start-1">
          <NeedInfo need={need} org={org} delivery={delivery} />
        </div>

        {panelInColumn || !showPanel ? (
          <aside
            aria-label={showPanel ? "Donate" : "What happens next"}
            className="flex min-w-0 flex-col gap-4 md:sticky md:top-6 md:col-start-2 md:row-span-2 md:row-start-1 md:self-start"
          >
            {panelInColumn ? (
              <DonatePanel need={need} focusOnMount={cameToDonate} onPhaseChange={setPhase} />
            ) : (
              <>
                {need.status === "delivered" && delivery ? null : <NeedStatusBox need={need} />}
                <FundNextNeed need={need} orgName={org.name} />
              </>
            )}
          </aside>
        ) : null}

        <section
          aria-labelledby={timelineId}
          className="min-w-0 self-start rounded-xl border bg-surface px-4 py-4 sm:px-6 sm:py-5 md:col-start-1 md:row-start-2"
        >
          <h2 id={timelineId} className="mb-3 text-[15px] font-extrabold sm:mb-4 sm:text-[17px] sm:font-bold">
            {need.status === "delivered" ? "How it got here" : "Where this item is"}
          </h2>
          <Timeline need={need} events={timeline} variant={need.status === "delivered" ? "list" : "steps"} />
        </section>
      </div>

      {showBar ? <PhoneDonateBar need={need} onOpen={() => setSheetOpen(true)} /> : null}
      {panelInSheet ? (
        <DonateSheet need={need} open={sheetOpen} onOpenChange={changeSheet} onPhaseChange={setPhase} />
      ) : null}
      <LiveStatus {...live} aboveBottomBar={showBar} />
    </div>
  );
}

/** Layout-shaped skeleton; "Waking up the server…" joins it after 3 s. */
function NeedPageLoading() {
  return (
    <div role="status" className={`${PAGE} pt-5 pb-14`}>
      <span className="sr-only">Loading this item…</span>
      <div aria-hidden="true" className="flex flex-col gap-6 motion-safe:animate-pulse md:flex-row md:gap-8">
        <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:gap-6">
          <div className="h-50 w-full rounded-xl bg-track sm:aspect-square sm:h-auto sm:max-w-90" />
          <div className="flex flex-1 flex-col gap-3">
            <div className="h-6 w-32 rounded-full bg-placeholder" />
            <div className="h-9 w-[80%] rounded-md bg-track" />
            <div className="h-4 w-[60%] rounded-md bg-placeholder" />
            <div className="h-4 w-full rounded-md bg-placeholder" />
          </div>
        </div>
        <div className="hidden h-110 w-full rounded-xl bg-track md:block md:max-w-100" />
      </div>
      <div className="pt-6">
        <WakingUp />
      </div>
    </div>
  );
}

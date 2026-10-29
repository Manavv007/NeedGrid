import type { OrgPageRes } from "@needgrid/shared";
import { useParams, useSearchParams } from "react-router";
import { ErrorState } from "@/components/ErrorState";
import { WakingUp } from "@/components/WakingUp";
import { BigScreen } from "@/features/bigscreen/BigScreen";
import { isBigScreenSearch } from "@/features/bigscreen/bigScreenMode";
import { becameFunded } from "@/features/live/liveMessage";
import { LiveStatus } from "@/features/live/LiveStatus";
import { useLiveUpdates } from "@/features/live/useLiveUpdates";
import { useRecentIds } from "@/features/live/useRecentIds";
import { OrgHeader, OrgHeaderSkeleton } from "@/features/tiles/OrgHeader";
import { TILE_GRID, TileCardSkeleton } from "@/features/tiles/TileCard";
import { TileWall } from "@/features/tiles/TileWall";
import { ApiClientError } from "@/lib/api";
import { useOrg } from "@/lib/queries";
import { useOrgStream } from "@/lib/sse";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { NotFoundPage } from "./NotFoundPage";

const PAGE = "mx-auto w-full max-w-300 px-4 pb-12 sm:px-6";

/** How long a tile that was just funded stays highlighted. */
const JUST_FUNDED_HIGHLIGHT_MS = 3_000;

const isNotFound = (error: unknown) => error instanceof ApiClientError && error.code === "NOT_FOUND";

/**
 * `/o/:slug`: a charity's tile wall (brief §9.2), or with `?display=1` the big-screen wall (§9.2).
 * One request for the whole page, then live updates keep it current.
 */
export function OrgPage() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const org = useOrg(slug);
  // Connect while the page loads too, and keep the connection when the donor opens a need.
  useOrgStream(slug);
  const notFound = !org.data && isNotFound(org.error);

  useDocumentTitle(org.data ? `${org.data.org.name} · NeedGrid` : notFound ? "Charity not found · NeedGrid" : null);

  // Data first: a failed background refetch keeps showing what we already have.
  if (org.data) {
    return isBigScreenSearch(params) ? <BigScreen page={org.data} /> : <LiveTileWall page={org.data} />;
  }
  if (notFound) {
    return (
      <NotFoundPage
        title="We couldn't find that charity"
        message="The link may be old or mistyped. Every charity on NeedGrid is listed on the home page."
        linkLabel="See all charities"
      />
    );
  }
  if (org.isError) {
    return (
      <div className={`${PAGE} pt-12`}>
        <ErrorState onRetry={() => void org.refetch()} />
      </div>
    );
  }
  return <OrgPageLoading />;
}

/** The tile wall with live updates: bars move, tiles change tabs, just-funded tiles light up. */
function LiveTileWall({ page }: { page: OrgPageRes }) {
  const justFunded = useRecentIds(JUST_FUNDED_HIGHLIGHT_MS);
  const live = useLiveUpdates(page.org.slug, {
    onUpdate: (update) => {
      if (becameFunded(update)) justFunded.mark(update.card.id);
    },
  });
  return (
    <div className={PAGE}>
      <OrgHeader org={page.org} stats={page.stats} />
      <TileWall org={page.org} needs={page.needs} justFunded={justFunded.ids} />
      <LiveStatus {...live} />
    </div>
  );
}

/** Header and tile skeletons; "Waking up the server…" joins them after 3 s. */
function OrgPageLoading() {
  return (
    <div role="status" className={PAGE}>
      <span className="sr-only">Loading this charity's list…</span>
      <OrgHeaderSkeleton />
      <div className="py-6">
        <WakingUp />
      </div>
      <div className={TILE_GRID}>
        {Array.from({ length: 8 }, (_, i) => (
          <TileCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

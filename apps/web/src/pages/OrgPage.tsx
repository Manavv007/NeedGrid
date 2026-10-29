import { useParams } from "react-router";
import { ErrorState } from "@/components/ErrorState";
import { WakingUp } from "@/components/WakingUp";
import { OrgHeader, OrgHeaderSkeleton } from "@/features/tiles/OrgHeader";
import { TILE_GRID, TileCardSkeleton } from "@/features/tiles/TileCard";
import { TileWall } from "@/features/tiles/TileWall";
import { ApiClientError } from "@/lib/api";
import { useOrg } from "@/lib/queries";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { NotFoundPage } from "./NotFoundPage";

const PAGE = "mx-auto w-full max-w-300 px-4 pb-12 sm:px-6";

const isNotFound = (error: unknown) => error instanceof ApiClientError && error.code === "NOT_FOUND";

/** `/o/:slug`: a charity's tile wall (brief §9.2). One request for the whole page. */
export function OrgPage() {
  const { slug = "" } = useParams();
  const org = useOrg(slug);
  const notFound = !org.data && isNotFound(org.error);

  useDocumentTitle(org.data ? `${org.data.org.name} · NeedGrid` : notFound ? "Charity not found · NeedGrid" : null);

  // Data first: a failed background refetch keeps showing what we already have.
  if (org.data) {
    return (
      <div className={PAGE}>
        <OrgHeader org={org.data.org} stats={org.data.stats} />
        <TileWall org={org.data.org} needs={org.data.needs} />
      </div>
    );
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

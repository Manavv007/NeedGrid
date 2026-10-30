/**
 * Big-screen mode (`/o/:slug?display=1`, brief §9.2): which tiles the wall shows and in what order.
 * Pure functions over the server's cards, like the tile wall's filters.
 */
import type { NeedCard, NeedStatus } from "@needgrid/shared";
import { useMatch, useSearchParams } from "react-router";
import { compareMostUrgent, isDonatable, TAB_STATUSES, visibleNeeds } from "@/features/tiles/filterNeeds";

export const DISPLAY_PARAM = "display";

/** How many funded tiles follow the ones still needed. */
export const RECENTLY_FUNDED_MAX = 8;

const FUNDED: readonly NeedStatus[] = TAB_STATUSES.funded;

export function isBigScreenSearch(params: URLSearchParams): boolean {
  return params.get(DISPLAY_PARAM) === "1";
}

/** True on `/o/:slug?display=1`: the public layout drops its header and footer there. */
export function useIsBigScreen(): boolean {
  const onTileWall = useMatch("/o/:slug") !== null;
  const [params] = useSearchParams();
  return onTileWall && isBigScreenSearch(params);
}

const newestFirst = (a: NeedCard, b: NeedCard) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);

/**
 * Still needed first (most urgent first), then the most recently funded. A tile in `lingering`
 * (just funded) keeps its place for a moment, so the wall shows it fill up before it moves.
 */
export function bigScreenNeeds(needs: readonly NeedCard[], lingering: ReadonlySet<string>): NeedCard[] {
  const visible = visibleNeeds(needs);
  const stillNeeded = visible
    .filter((need) => isDonatable(need.status) || (lingering.has(need.id) && FUNDED.includes(need.status)))
    .sort(compareMostUrgent);
  const recentlyFunded = visible
    .filter((need) => FUNDED.includes(need.status) && !lingering.has(need.id))
    .sort(newestFirst)
    .slice(0, RECENTLY_FUNDED_MAX);
  return [...stillNeeded, ...recentlyFunded];
}

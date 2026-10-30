import type { NeedCard, OrgPublic } from "@needgrid/shared";
import { HandHeart, PackageCheck, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { FilterBar } from "./FilterBar";
import {
  applyFilters,
  categoriesIn,
  countByTab,
  hasNarrowingFilters,
  parseFilters,
  resultSummary,
  TABS,
  visibleNeeds,
  writeFilters,
  type Filters,
} from "./filterNeeds";
import { TILE_GRID, TileCard } from "./TileCard";

type TileWallProps = {
  org: OrgPublic;
  needs: readonly NeedCard[];
  /** Tiles that just became funded (live updates): highlighted for a moment. */
  justFunded?: ReadonlySet<string>;
};

const NONE: ReadonlySet<string> = new Set();

/**
 * Tabs, filters, sort and the tile grid. All filter state lives in the URL search params, so links
 * are shareable and Back undoes a filter change. Invalid params fall back to the defaults.
 * Live updates change `needs`: tiles move between tabs and the counts follow.
 */
export function TileWall({ org, needs, justFunded = NONE }: TileWallProps) {
  const [params, setParams] = useSearchParams();
  const visible = useMemo(() => visibleNeeds(needs), [needs]);
  const categories = useMemo(() => categoriesIn(visible), [visible]);
  const counts = useMemo(() => countByTab(visible), [visible]);
  const filters = parseFilters(params, categories);
  const results = applyFilters(visible, filters);
  // Announce result counts only after the donor changes something, not on page load, and only when
  // the filters change: live changes have the page's own live region (LiveStatus).
  const [announce, setAnnounce] = useState(false);
  const filtersKey = writeFilters(filters).toString();
  const [summary, setSummary] = useState<{ filtersKey: string; text: string } | null>(null);
  if (announce && summary?.filtersKey !== filtersKey) {
    setSummary({ filtersKey, text: resultSummary(results.length, filters) });
  }

  function update(next: Partial<Filters>) {
    const nextParams = writeFilters({ ...filters, ...next }, params);
    if (nextParams.toString() === params.toString()) return; // no duplicate history entries
    setAnnounce(true);
    setParams(nextParams, { preventScrollReset: true });
  }

  return (
    // Manual activation: arrow keys move focus, Enter/Space/click picks a tab. Every pick is a
    // history entry, so arrowing across the tabs shouldn't create three of them.
    <Tabs
      value={filters.tab}
      activationMode="manual"
      onValueChange={(value) => {
        const tab = TABS.find((t) => t === value);
        if (tab) update({ tab });
      }}
      className="mt-3 gap-0 sm:mt-6"
    >
      <FilterBar filters={filters} counts={counts} categories={categories} onChange={update} />
      <p role="status" className="sr-only">
        {summary?.text ?? ""}
      </p>
      <TabsContent
        value={filters.tab}
        className="pt-4 text-base focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-primary"
      >
        {results.length > 0 ? (
          <ul className={TILE_GRID}>
            {results.map((need) => (
              <li key={need.id} className="flex">
                <TileCard need={need} highlight={justFunded.has(need.id)} />
              </li>
            ))}
          </ul>
        ) : (
          <NoResults
            filters={filters}
            orgName={org.name}
            hasAnyNeeds={visible.length > 0}
            onClearFilters={() => update({ category: null, urgentOnly: false })}
            onShowNeeded={() => update({ tab: "needed" })}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}

type NoResultsProps = {
  filters: Filters;
  orgName: string;
  hasAnyNeeds: boolean;
  onClearFilters: () => void;
  onShowNeeded: () => void;
};

/** An empty state that fits the tab (States.dc.html "Empty"). */
function NoResults({ filters, orgName, hasAnyNeeds, onClearFilters, onShowNeeded }: NoResultsProps) {
  const otherCharities = (
    <Button asChild>
      <Link to={{ pathname: "/", hash: "#orgs" }}>See other charities</Link>
    </Button>
  );
  const showNeeded = (
    <Button variant="outline" onClick={onShowNeeded}>
      See what's still needed
    </Button>
  );

  if (hasNarrowingFilters(filters)) {
    return (
      <EmptyState
        icon={<SearchX className="size-6.5" />}
        title="No items match"
        message="Nothing on this list matches these filters. Try another category or turn off Urgent only."
        action={
          <Button variant="outline" onClick={onClearFilters}>
            Clear filters
          </Button>
        }
      />
    );
  }
  if (!hasAnyNeeds) {
    return (
      <EmptyState
        icon={<HandHeart className="size-6.5" />}
        title="No items yet"
        message={`${orgName} hasn't posted any items yet. Other charities still need help.`}
        action={otherCharities}
      />
    );
  }
  if (filters.tab === "needed") {
    return (
      <EmptyState
        title="Everything here is funded"
        message={`${orgName} has nothing left to fund right now. Other charities still need help.`}
        action={otherCharities}
      />
    );
  }
  if (filters.tab === "funded") {
    return (
      <EmptyState
        icon={<HandHeart className="size-6.5" />}
        title="Nothing being bought right now"
        message={`Items appear here once they're fully funded, until they arrive at ${orgName}.`}
        action={showNeeded}
      />
    );
  }
  return (
    <EmptyState
      icon={<PackageCheck className="size-6.5" />}
      title="Nothing delivered yet"
      message={`When a funded item arrives, ${orgName} posts a photo and it shows up here.`}
      action={showNeeded}
    />
  );
}

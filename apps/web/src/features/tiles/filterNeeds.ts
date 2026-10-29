/**
 * Tile wall filtering and sorting. Pure functions over needs the server already sent: no money
 * maths, no status decisions, only which loaded tiles to show and in what order.
 */
import {
  CATEGORIES,
  DONATABLE_STATUSES,
  URGENCY_MAX,
  type Category,
  type NeedCard,
  type NeedStatus,
} from "@needgrid/shared";
import { CATEGORY_LABELS } from "@/lib/format";

/** Status tabs, in display order. */
export const TABS = ["needed", "funded", "delivered"] as const;
export type Tab = (typeof TABS)[number];

export const SORTS = ["urgent", "newest"] as const;
export type Sort = (typeof SORTS)[number];

export type Filters = {
  tab: Tab;
  /** null = all categories. */
  category: Category | null;
  /** Only urgency 3 ("Urgent"). */
  urgentOnly: boolean;
  sort: Sort;
};

export const DEFAULT_FILTERS: Readonly<Filters> = {
  tab: "needed",
  category: null,
  urgentOnly: false,
  sort: "urgent",
};

/** Statuses on each tab. Drafts and closed needs are on none: the public never sees them. */
export const TAB_STATUSES: Readonly<Record<Tab, readonly NeedStatus[]>> = {
  needed: DONATABLE_STATUSES,
  funded: ["funded", "ordered"],
  delivered: ["delivered"],
};

/** Search param names. Anything else in the URL (e.g. C-5's `display`) is left untouched. */
export const FILTER_PARAMS = { tab: "tab", category: "category", urgent: "urgent", sort: "sort" } as const;

export function tabOf(status: NeedStatus): Tab | null {
  return TABS.find((tab) => TAB_STATUSES[tab].includes(status)) ?? null;
}

/** Statuses that accept donations (`open`, `topping_up`). */
export function isDonatable(status: NeedStatus): boolean {
  return TAB_STATUSES.needed.includes(status);
}

/** Drops drafts and closed needs, even if the API sent them. */
export function visibleNeeds(needs: readonly NeedCard[]): NeedCard[] {
  return needs.filter((need) => tabOf(need.status) !== null);
}

/** Tab counts over all visible needs (before category and urgency filters). */
export function countByTab(needs: readonly NeedCard[]): Record<Tab, number> {
  const counts: Record<Tab, number> = { needed: 0, funded: 0, delivered: 0 };
  for (const need of needs) {
    const tab = tabOf(need.status);
    if (tab) counts[tab] += 1;
  }
  return counts;
}

/** Categories that have at least one visible need, in the shared `CATEGORIES` order. */
export function categoriesIn(needs: readonly NeedCard[]): Category[] {
  const present = new Set(visibleNeeds(needs).map((need) => need.category));
  return CATEGORIES.filter((category) => present.has(category));
}

const time = (iso: string) => Date.parse(iso);

/** "Most urgent first" exactly as in shared enums.ts: urgency DESC, deadline ASC with none last, created ASC. */
export function compareMostUrgent(a: NeedCard, b: NeedCard): number {
  if (a.urgency !== b.urgency) return b.urgency - a.urgency;
  if (a.deadlineAt !== b.deadlineAt) {
    if (a.deadlineAt === null) return 1;
    if (b.deadlineAt === null) return -1;
    const byDeadline = time(a.deadlineAt) - time(b.deadlineAt);
    if (byDeadline !== 0) return byDeadline;
  }
  return time(a.createdAt) - time(b.createdAt);
}

/** Newest first: created DESC. */
export function compareNewest(a: NeedCard, b: NeedCard): number {
  return time(b.createdAt) - time(a.createdAt);
}

const COMPARE: Readonly<Record<Sort, (a: NeedCard, b: NeedCard) => number>> = {
  urgent: compareMostUrgent,
  newest: compareNewest,
};

/** The tiles to show for `filters`, sorted. Never includes drafts or closed needs. */
export function applyFilters(needs: readonly NeedCard[], filters: Filters): NeedCard[] {
  return needs
    .filter((need) => tabOf(need.status) === filters.tab)
    .filter((need) => filters.category === null || need.category === filters.category)
    .filter((need) => !filters.urgentOnly || need.urgency === URGENCY_MAX)
    .sort(COMPARE[filters.sort]);
}

/** Category or urgency narrows the tab (the "No items match" + "Clear filters" case). */
export function hasNarrowingFilters(filters: Filters): boolean {
  return filters.category !== null || filters.urgentOnly;
}

function isOneOf<T extends string>(options: readonly T[], value: string | null): value is T {
  return value !== null && (options as readonly string[]).includes(value);
}

/**
 * Filters from the URL. Unknown or invalid values fall back to the defaults; a category is only
 * kept when it's in `available` (a chip for it exists on this page).
 */
export function parseFilters(params: URLSearchParams, available: readonly Category[] = CATEGORIES): Filters {
  const tab = params.get(FILTER_PARAMS.tab);
  const category = params.get(FILTER_PARAMS.category);
  const sort = params.get(FILTER_PARAMS.sort);
  return {
    tab: isOneOf(TABS, tab) ? tab : DEFAULT_FILTERS.tab,
    category: isOneOf(available, category) ? category : DEFAULT_FILTERS.category,
    urgentOnly: params.get(FILTER_PARAMS.urgent) === "1",
    sort: isOneOf(SORTS, sort) ? sort : DEFAULT_FILTERS.sort,
  };
}

function setOrDelete(params: URLSearchParams, key: string, value: string | null): void {
  if (value === null) params.delete(key);
  else params.set(key, value);
}

/** `filters` written into a copy of `base`. Defaults are left out so plain links stay plain. */
export function writeFilters(filters: Filters, base: URLSearchParams = new URLSearchParams()): URLSearchParams {
  const next = new URLSearchParams(base);
  setOrDelete(next, FILTER_PARAMS.tab, filters.tab === DEFAULT_FILTERS.tab ? null : filters.tab);
  setOrDelete(next, FILTER_PARAMS.category, filters.category);
  setOrDelete(next, FILTER_PARAMS.urgent, filters.urgentOnly ? "1" : null);
  setOrDelete(next, FILTER_PARAMS.sort, filters.sort === DEFAULT_FILTERS.sort ? null : filters.sort);
  return next;
}

const TAB_PHRASE: Readonly<Record<Tab, string>> = {
  needed: "still needed",
  funded: "funded",
  delivered: "delivered",
};

/** Screen-reader summary after a filter change, e.g. "2 items still needed in Baby, urgent only". */
export function resultSummary(count: number, filters: Filters): string {
  let text = `${count} ${count === 1 ? "item" : "items"} ${TAB_PHRASE[filters.tab]}`;
  if (filters.category) text += ` in ${CATEGORY_LABELS[filters.category]}`;
  if (filters.urgentOnly) text += ", urgent only";
  return text;
}

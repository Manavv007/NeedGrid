import type { Category } from "@needgrid/shared";
import { TriangleAlert } from "lucide-react";
import { useId, type ReactNode } from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CATEGORY_LABELS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SORTS, TABS, type Filters, type Sort, type Tab } from "./filterNeeds";

const TAB_LABELS: Readonly<Record<Tab, string>> = {
  needed: "Still needed",
  funded: "Funded",
  delivered: "Delivered",
};

const SORT_LABELS: Readonly<Record<Sort, string>> = {
  urgent: "Most urgent first",
  newest: "Newest",
};

type FilterBarProps = {
  filters: Filters;
  counts: Readonly<Record<Tab, number>>;
  /** Categories with visible needs, in display order. */
  categories: readonly Category[];
  onChange: (next: Partial<Filters>) => void;
};

/**
 * Status tabs (with counts) and sort on one bordered row, category chips + "Urgent only" below
 * (Main.dc.html). Phones: tabs, then chips, then sort. Must render inside the page's <Tabs>.
 */
export function FilterBar({ filters, counts, categories, onChange }: FilterBarProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <TabsList
        variant="line"
        aria-label="Filter by status"
        className="w-full justify-start gap-0.5 overflow-x-auto overflow-y-hidden rounded-none border-b p-0 group-data-horizontal/tabs:h-auto"
      >
        {TABS.map((tab) => (
          <TabsTrigger
            key={tab}
            value={tab}
            className="h-11 flex-none rounded-none px-2 py-0 text-sm font-medium text-muted-foreground after:bg-primary hover:text-foreground focus-visible:ring-inset data-active:font-bold data-active:text-primary sm:px-3.5 group-data-horizontal/tabs:after:bottom-0"
          >
            {TAB_LABELS[tab]} <span aria-hidden="true">·</span> {counts[tab]}
          </TabsTrigger>
        ))}
      </TabsList>
      <SortSelect
        value={filters.sort}
        onChange={(sort) => onChange({ sort })}
        className="row-start-3 pt-3 sm:col-start-2 sm:row-start-1 sm:border-b sm:pt-0 sm:pb-1.5 sm:pl-4"
      />
      <div className="row-start-2 flex flex-wrap items-center gap-2 pt-3.5 pb-1 sm:col-span-2">
        <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
          <Chip pressed={filters.category === null} onClick={() => onChange({ category: null })}>
            All
          </Chip>
          {categories.map((category) => (
            <Chip key={category} pressed={filters.category === category} onClick={() => onChange({ category })}>
              {CATEGORY_LABELS[category]}
            </Chip>
          ))}
        </div>
        {/* Phones: the chips wrap, and a divider would start a row on its own. */}
        <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-border-strong sm:block" />
        <Chip urgent pressed={filters.urgentOnly} onClick={() => onChange({ urgentOnly: !filters.urgentOnly })}>
          <TriangleAlert aria-hidden="true" className="size-3" strokeWidth={2.5} />
          Urgent only
        </Chip>
      </div>
    </div>
  );
}

type ChipProps = { pressed: boolean; urgent?: boolean; onClick: () => void; children: ReactNode };

/** A 36 px pill with a 44 px tap area (the ::before extends it 4 px above and below). */
function Chip({ pressed, urgent = false, onClick, children }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "relative inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] whitespace-nowrap transition-colors before:absolute before:inset-x-0 before:-inset-y-1",
        urgent
          ? pressed
            ? "border-badge-urgent-text bg-badge-urgent-text font-semibold text-primary-foreground"
            : "border-badge-urgent-text/35 bg-surface font-semibold text-badge-urgent-text hover:bg-badge-urgent-bg"
          : pressed
            ? "border-primary bg-primary font-semibold text-primary-foreground"
            : "border-border-strong bg-surface font-medium text-foreground hover:bg-placeholder",
      )}
    >
      {children}
    </button>
  );
}

type SortSelectProps = { value: Sort; onChange: (sort: Sort) => void; className?: string };

function SortSelect({ value, onChange, className }: SortSelectProps) {
  const id = useId();
  return (
    <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
      <label htmlFor={id}>Sort</label>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          const next = SORTS.find((sort) => sort === event.target.value);
          if (next) onChange(next);
        }}
        // 16 px on phones: iOS zooms the page into any smaller form control.
        className="h-11 rounded-md border border-border-strong bg-surface px-2 text-base text-foreground sm:text-sm"
      >
        {SORTS.map((sort) => (
          <option key={sort} value={sort}>
            {SORT_LABELS[sort]}
          </option>
        ))}
      </select>
    </div>
  );
}

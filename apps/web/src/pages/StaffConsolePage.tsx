import type { NeedCard } from "@needgrid/shared";
import { Plus } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WakingUp } from "@/components/WakingUp";
import {
  CONSOLE_TABS,
  countByTab,
  DEFAULT_TAB,
  needsInTab,
  parseTab,
  TAB_LABELS,
  type ConsoleTab,
} from "@/features/staff/console/consoleTabs";
import { NeedsTable } from "@/features/staff/console/NeedsTable";
import { WaitingOnYou } from "@/features/staff/console/WaitingOnYou";
import { useStaffOrg } from "@/features/staff/useStaffOrg";
import { LiveStatus } from "@/features/live/LiveStatus";
import { useLiveUpdates } from "@/features/live/useLiveUpdates";
import { useStaffNeeds } from "@/lib/queries";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

const PAGE = "mx-auto w-full max-w-300 px-4 pt-6 pb-12 sm:px-6";

const EMPTY: Readonly<Record<ConsoleTab, { title: string; message: string }>> = {
  drafts: {
    title: "No drafts",
    message: "Items you save as drafts wait here until you publish them.",
  },
  open: {
    title: "Nothing is open for donations",
    message: "Publish a draft or add new needs to put them on your public page.",
  },
  funded: {
    title: "Nothing waiting to be bought",
    message: "When an item is fully funded it shows up here, ready for you to check the price and buy it.",
  },
  ordered: {
    title: "Nothing is on its way",
    message: "Items you mark as ordered show up here until they arrive.",
  },
  delivered: {
    title: "No deliveries yet",
    message: "Once an item arrives and you add its photo, it is listed here.",
  },
  closed: {
    title: "No closed needs",
    message: "Needs you close before any money arrives are kept here.",
  },
};

/** `/staff`: needs by status with a next step per row (brief A9.7, StaffConsole.dc.html). Live via the org stream. */
export function StaffConsolePage() {
  const org = useStaffOrg();
  useDocumentTitle(`Needs · ${org.name} · NeedGrid staff`);
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get("tab"));
  const needs = useStaffNeeds();
  // Every live update invalidates the staff lists, so rows, counts and tabs follow donations.
  const live = useLiveUpdates(org.slug);

  function selectTab(next: ConsoleTab) {
    const nextParams = new URLSearchParams(params);
    if (next === DEFAULT_TAB) nextParams.delete("tab");
    else nextParams.set("tab", next);
    setParams(nextParams, { preventScrollReset: true });
  }

  return (
    <div className={PAGE}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-[-0.03em]">Needs</h1>
        <Link to="/staff/intake" className={buttonVariants({ size: "lg" })}>
          <Plus aria-hidden="true" strokeWidth={2.5} />
          Add needs
        </Link>
      </div>

      {needs.data ? (
        <Loaded needs={needs.data.needs} tab={tab} onSelectTab={selectTab} />
      ) : needs.isError ? (
        <ErrorState className="mt-8" onRetry={() => void needs.refetch()} />
      ) : (
        <ConsoleSkeleton />
      )}
      <LiveStatus {...live} />
    </div>
  );
}

type LoadedProps = {
  needs: readonly NeedCard[];
  tab: ConsoleTab;
  onSelectTab: (tab: ConsoleTab) => void;
};

function Loaded({ needs, tab, onSelectTab }: LoadedProps) {
  const counts = countByTab(needs);
  const rows = needsInTab(needs, tab);
  const empty = EMPTY[tab];

  return (
    <>
      <WaitingOnYou counts={counts} approvals={null} />
      <div className="mt-8">
        <Tabs
          value={tab}
          activationMode="manual"
          onValueChange={(value) => {
            const next = CONSOLE_TABS.find((t) => t === value);
            if (next) onSelectTab(next);
          }}
          className="gap-3"
        >
          <TabsList
            variant="line"
            aria-label="Needs by status"
            className="w-full justify-start gap-0.5 overflow-x-auto overflow-y-hidden rounded-none border-b p-0 group-data-horizontal/tabs:h-auto"
          >
            {CONSOLE_TABS.map((id) => (
              <TabsTrigger
                key={id}
                value={id}
                className="h-11 flex-none rounded-none px-2 py-0 text-sm font-medium text-muted-foreground after:bg-primary hover:text-foreground focus-visible:ring-inset data-active:font-bold data-active:text-primary sm:px-3.5 group-data-horizontal/tabs:after:bottom-0"
              >
                {TAB_LABELS[id]} <span aria-hidden="true">·</span> {counts[id]}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={tab}>
            {rows.length > 0 ? (
              <NeedsTable needs={rows} />
            ) : (
              <EmptyState
                title={empty.title}
                message={empty.message}
                action={
                  tab === "drafts" || tab === "open" ? (
                    <Button asChild>
                      <Link to="/staff/intake">Add needs</Link>
                    </Button>
                  ) : undefined
                }
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function ConsoleSkeleton() {
  return (
    <div role="status" className="mt-8">
      <span className="sr-only">Loading your needs…</span>
      <div aria-hidden="true" className="flex flex-col gap-3 motion-safe:animate-pulse">
        <Skeleton className="h-11 w-full max-w-md" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
      <div className="pt-6">
        <WakingUp />
      </div>
    </div>
  );
}

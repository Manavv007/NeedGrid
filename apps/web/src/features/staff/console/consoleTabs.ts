import type { NeedCard, NeedStatus } from "@needgrid/shared";

/** The staff console's status tabs (brief A9.7). Open includes needs topping up after a price rise. */
export const CONSOLE_TABS = ["drafts", "open", "funded", "ordered", "delivered", "closed"] as const;
export type ConsoleTab = (typeof CONSOLE_TABS)[number];

export const DEFAULT_TAB: ConsoleTab = "open";

export const TAB_LABELS: Readonly<Record<ConsoleTab, string>> = {
  drafts: "Drafts",
  open: "Open",
  funded: "Funded",
  ordered: "Ordered",
  delivered: "Delivered",
  closed: "Closed",
};

const TAB_STATUSES: Readonly<Record<ConsoleTab, readonly NeedStatus[]>> = {
  drafts: ["draft"],
  open: ["open", "topping_up"],
  funded: ["funded"],
  ordered: ["ordered"],
  delivered: ["delivered"],
  closed: ["closed"],
};

/** The tab named in `?tab=`; anything unknown falls back to the default. */
export function parseTab(raw: string | null): ConsoleTab {
  return CONSOLE_TABS.find((tab) => tab === raw) ?? DEFAULT_TAB;
}

export function needsInTab(needs: readonly NeedCard[], tab: ConsoleTab): NeedCard[] {
  const statuses = TAB_STATUSES[tab];
  return needs.filter((need) => statuses.includes(need.status));
}

export function countByTab(needs: readonly NeedCard[]): Record<ConsoleTab, number> {
  return {
    drafts: needsInTab(needs, "drafts").length,
    open: needsInTab(needs, "open").length,
    funded: needsInTab(needs, "funded").length,
    ordered: needsInTab(needs, "ordered").length,
    delivered: needsInTab(needs, "delivered").length,
    closed: needsInTab(needs, "closed").length,
  };
}

/** Where a "Waiting on you" card or a link to a tab points. */
export function consoleTabPath(tab: ConsoleTab): string {
  return `/staff?tab=${tab}`;
}

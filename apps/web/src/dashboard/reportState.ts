/**
 * The built-in dashboard report (AGENT_B_AI_DATA.md §10.1): page "Impact" and page "Charities".
 * Field ids ('allocations.amountUsd') refer to the data sources in ./data.ts.
 * Edits live only in this browser's localStorage (needgrid.dashboard.v1); Reset brings this back.
 */
import type { AgPageState, AgReportState, AgWidgetLayoutState } from "ag-studio";

/** Bump when the default report changes shape, so old saved edits are dropped instead of breaking. */
export const REPORT_VERSION = 1;
export const STORAGE_KEY = "needgrid.dashboard.v1";

// 24 columns wide; rows are studioCanvasRowHeight tall (theme.ts).
const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({
  xTrack,
  yTrack,
  xSpan,
  ySpan,
});
const title = (text: string) => ({ title: { enabled: true, text } });
const sum = (id: string) => ({ id, aggregation: "sum" as const });
const avg = (id: string) => ({ id, aggregation: "avg" as const });

const FONT = '"Inter Variable", ui-sans-serif, system-ui, sans-serif';
const typography = (fontSize: number, fontWeight: "normal" | "bold" = "normal") => ({
  fontFamily: FONT,
  fontSize,
  fontWeight,
  fontStyle: "normal" as const,
});

const kpi = (text: string, value: { id: string; aggregation?: "sum" | "avg" }, sparklineX?: string) => ({
  type: "value" as const,
  dataMapping: { value: [value], ...(sparklineX ? { sparklineX: [{ id: sparklineX }] } : {}) },
  format: {
    title: { enabled: true, text, typography: typography(14, "bold") },
    caption: { enabled: true, text: "", typography: typography(0) },
    style: { typography: typography(26, "bold") },
  },
});

const legend = { style: { theme: { common: { legend: { enabled: true } } } } };

const impact: AgPageState = {
  id: "impact",
  widgets: {
    "donated-on": {
      type: "date-filter",
      dataMapping: { value: [{ id: "donations.donatedAt" }] },
      // No default period: Studio 3.0 fails to apply a saved relative date filter on load (boilerplate note).
      format: { style: { filterType: "relative" } },
    },
    "kpi-raised": kpi("Total raised", sum("donations.amountUsd"), "calendar::week"),
    "kpi-funded": kpi("Items funded", sum("needs.fundedCount")),
    "kpi-delivered": kpi("Items delivered", sum("needs.deliveredCount")),
    "kpi-days": kpi("Avg days, funded to delivered", avg("needs.daysFundedToDelivered")),
    "by-category-month": {
      type: "column-chart-stacked",
      dataMapping: {
        categoryKey: [{ id: "calendar::month" }],
        valueKey: [sum("allocations.amountUsd")],
        legendKey: [{ id: "allocations.categoryLabel" }],
      },
      format: { ...title("What donations bought, by category and month"), ...legend },
    },
    "per-week": {
      type: "area-chart",
      dataMapping: {
        categoryKey: [{ id: "calendar::week" }],
        valueKey: [sum("donations.amountUsd")],
      },
      format: title("Donations per week"),
    },
    "still-needed": {
      type: "bar-chart-stacked",
      dataMapping: {
        categoryKey: [{ id: "needs.categoryLabel" }],
        valueKey: [sum("needs.stillNeededUsd")],
        legendKey: [{ id: "needs.urgencyLabel" }],
      },
      format: { ...title("Still needed, by category and urgency"), ...legend },
    },
    delivered: {
      type: "grid",
      dataMapping: {
        cols: [
          { id: "needs.title" },
          { id: "needs.orgName" },
          { id: "needs.categoryLabel" },
          { id: "needs.deliveredAt" },
          { id: "needs.daysFundedToDelivered" },
          { id: "needs.photoUrl" },
        ],
      },
      sort: [{ field: { id: "needs.deliveredAt" }, direction: "desc" }],
      format: title("Delivered items, newest first"),
    },
  },
  widgetLayout: {
    "kpi-raised": at(0, 0, 5, 7),
    "kpi-funded": at(5, 0, 4, 7),
    "kpi-delivered": at(9, 0, 4, 7),
    "kpi-days": at(13, 0, 5, 7),
    "donated-on": at(18, 0, 6, 7),
    "by-category-month": at(0, 7, 15, 18),
    "per-week": at(15, 7, 9, 18),
    "still-needed": at(0, 25, 10, 20),
    delivered: at(10, 25, 14, 20),
  },
  filter: {
    widget: {
      delivered: [{ field: { id: "needs.isDelivered" }, model: { operator: "isTrue" } }],
    },
  },
};

const charities: AgPageState = {
  id: "charities",
  widgets: {
    "kpi-raised": kpi("Total raised", sum("donations.amountUsd")),
    "kpi-funded": kpi("Items funded", sum("needs.fundedCount")),
    "kpi-delivered": kpi("Items delivered", sum("needs.deliveredCount")),
    "kpi-still": kpi("Still needed", sum("needs.stillNeededUsd")),
    "raised-by-org": {
      type: "donut-chart",
      dataMapping: { categoryKey: [{ id: "donations.orgName" }], valueKey: [sum("donations.amountUsd")] },
      format: {
        ...title("Raised by charity"),
        style: { custom: { pieDataLabel: { enabled: true }, totalLabel: { enabled: true } } },
      },
    },
    "funded-vs-needed": {
      type: "bar-chart-grouped",
      dataMapping: {
        categoryKey: [{ id: "needs.orgName" }],
        valueKey: [sum("needs.fundedUsd"), sum("needs.stillNeededUsd")],
      },
      format: { ...title("Funded vs still needed, by charity"), ...legend },
    },
    "items-by-org": {
      type: "column-chart-grouped",
      dataMapping: {
        categoryKey: [{ id: "needs.orgName" }],
        valueKey: [sum("needs.fundedCount"), sum("needs.deliveredCount")],
      },
      format: { ...title("Items funded and delivered, by charity"), ...legend },
    },
    "org-table": {
      type: "pivot-grid",
      dataMapping: {
        rows: [{ id: "needs.orgName" }, { id: "needs.categoryLabel" }],
        columns: [{ id: "needs.statusLabel" }],
        values: [sum("needs.fundedUsd")],
      },
      format: {
        ...title("Funded by charity, category and status"),
        style: { totalColumns: true, totalColumnsPlacement: "before", grandTotalRow: { enabled: true } },
      },
    },
  },
  widgetLayout: {
    "kpi-raised": at(0, 0, 6, 7),
    "kpi-funded": at(6, 0, 6, 7),
    "kpi-delivered": at(12, 0, 6, 7),
    "kpi-still": at(18, 0, 6, 7),
    "raised-by-org": at(0, 7, 8, 18),
    "funded-vs-needed": at(8, 7, 16, 18),
    "items-by-org": at(0, 25, 10, 18),
    "org-table": at(10, 25, 14, 18),
  },
};

export const PAGE_TITLES: Record<string, string> = { impact: "Impact", charities: "Charities" };

export function defaultReport(): AgReportState {
  return structuredClone({ selectedPageId: impact.id, pages: [impact, charities] });
}

/** Panels: the filters panel open in view mode (its only panel), closed in edit mode (boilerplate pattern). */
export function withPanelsFor(mode: "view" | "edit", state: AgReportState): AgReportState {
  return { ...state, panels: { ...state.panels, filters: { ...state.panels?.filters, collapsed: mode === "edit" } } };
}

interface Saved {
  version: number;
  state: AgReportState;
}

/** The saved report, or null if there is none or it's from an older layout. Never throws. */
export function loadSaved(storage: Storage = localStorage): AgReportState | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved;
    if (saved?.version !== REPORT_VERSION || !Array.isArray(saved.state?.pages) || saved.state.pages.length === 0) {
      return null;
    }
    return saved.state;
  } catch {
    return null;
  }
}

export function save(state: AgReportState, storage: Storage = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: REPORT_VERSION, state } satisfies Saved));
  } catch {
    // Storage full or blocked (private mode): edits just aren't kept.
  }
}

export function clearSaved(storage: Storage = localStorage): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

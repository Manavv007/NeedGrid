/**
 * The dashboard's data (AGENT_B_AI_DATA.md §10.1): the three no-personal-data datasets from
 * GET /api/dashboard/datasets/:name, parsed with the shared schemas, turned into AG Studio data sources.
 *
 * A few display fields are derived here (flags, "still needed", org names on every table) so the default report
 * and the AI can answer common questions without filters or joins. Every number comes from the server's rows.
 */
import {
  DatasetAllocationRow,
  DatasetDonationRow,
  DatasetNeedRow,
  DatasetRes,
  paths,
  type DatasetName,
} from "@needgrid/shared";
import { useQuery } from "@tanstack/react-query";
import type { AgDataSourcesDefinition, AgFieldDefinition, AgFormat, AgRelationDefinition } from "ag-studio";
import { z } from "zod";
import { apiGet } from "@/lib/api";

export interface DashboardData {
  needs: DatasetNeedRow[];
  donations: DatasetDonationRow[];
  allocations: DatasetAllocationRow[];
  generatedAt: string;
}

async function fetchRows<T extends z.ZodType>(name: DatasetName, row: T, signal?: AbortSignal): Promise<z.infer<T>[]> {
  const res = await apiGet(paths.dataset(name), DatasetRes, { signal });
  return z.array(row).parse(res.rows);
}

export async function fetchDashboardData(signal?: AbortSignal): Promise<DashboardData> {
  const [needs, donations, allocations] = await Promise.all([
    fetchRows("needs", DatasetNeedRow, signal),
    fetchRows("donations", DatasetDonationRow, signal),
    fetchRows("allocations", DatasetAllocationRow, signal),
  ]);
  return { needs, donations, allocations, generatedAt: new Date().toISOString() };
}

export function useDashboardData() {
  return useQuery({
    queryKey: ["dashboardData"],
    queryFn: ({ signal }) => fetchDashboardData(signal),
    // The server caches datasets for 60 s; there is nothing newer to fetch sooner.
    staleTime: 60_000,
  });
}

/** Rows for one charity only (`/dashboard?org=<slug>`). Unknown slug → everything. */
export function filterByOrg(data: DashboardData, org: string | null): DashboardData {
  if (!org || !data.needs.some((n) => n.orgSlug === org)) return data;
  return {
    ...data,
    needs: data.needs.filter((r) => r.orgSlug === org),
    donations: data.donations.filter((r) => r.orgSlug === org),
    allocations: data.allocations.filter((r) => r.orgSlug === org),
  };
}

const URGENCY_LABEL: Record<number, string> = { 1: "Nice to have", 2: "Needed", 3: "Urgent" };
const STATUS_LABEL: Record<string, string> = {
  open: "Still needed",
  topping_up: "Still needed",
  funded: "Funded",
  ordered: "Ordered",
  delivered: "Delivered",
  closed: "Closed",
  draft: "Draft",
};
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const round2 = (n: number) => Math.round(n * 100) / 100;

// --- Studio data sources -------------------------------------------------------------

const CALENDAR_ID = "calendar";

type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean];
const fields = (specs: FieldSpec[]): AgFieldDefinition[] =>
  specs.map(([id, name, format, hide]) => ({ id, name, format, ...(hide ? { hide } : {}) }));

const manyToOne = (id: string, source: string, target: string): AgRelationDefinition => {
  const [sourceTable, sourceField] = source.split(".") as [string, string];
  const [targetTable, targetField] = target.split(".") as [string, string];
  return {
    id,
    source: { tableId: sourceTable, fieldId: sourceField },
    target: { tableId: targetTable, fieldId: targetField },
    type: "many-to-one",
  };
};

const onCalendar = (tableId: string, fieldId: string): AgRelationDefinition => ({
  id: `${tableId}-${fieldId}-calendar`,
  source: { tableId, fieldId },
  target: { calendarId: CALENDAR_ID },
  truncate: "day",
});

export function buildStudioData(data: DashboardData): AgDataSourcesDefinition {
  const orgName = new Map(data.needs.map((n) => [n.orgSlug, n.orgName]));
  const needs = data.needs.map((n) => {
    const stillNeeded = n.status === "open" || n.status === "topping_up";
    return {
      ...n,
      categoryLabel: titleCase(n.category),
      statusLabel: STATUS_LABEL[n.status] ?? n.status,
      urgencyLabel: URGENCY_LABEL[n.urgency] ?? String(n.urgency),
      isFunded: n.fundedAt !== null,
      isDelivered: n.status === "delivered",
      fundedCount: n.fundedAt !== null ? 1 : 0,
      deliveredCount: n.status === "delivered" ? 1 : 0,
      stillNeededUsd: stillNeeded ? round2(Math.max(0, n.targetUsd - n.fundedUsd)) : 0,
    };
  });
  const donations = data.donations.map((d) => ({ ...d, orgName: orgName.get(d.orgSlug) ?? d.orgSlug }));
  const allocations = data.allocations.map((a) => ({
    ...a,
    orgName: orgName.get(a.orgSlug) ?? a.orgSlug,
    categoryLabel: titleCase(a.category),
  }));

  const dates = [...data.donations.map((d) => d.donatedAt), ...data.allocations.map((a) => a.allocatedAt)]
    .map((d) => d.slice(0, 10))
    .sort();
  const today = data.generatedAt.slice(0, 10);

  return {
    description:
      "NeedGrid's public impact data. Charities post the exact items they need; donors fund them through PayPal; " +
      "staff buy each item once it's funded and upload a photo when it arrives. All money is in US dollars. " +
      "There is no personal data: donors are anonymous keys.",
    sources: [
      {
        id: "needs",
        description:
          "One row per item a charity asked for (drafts excluded). Funded = fully paid for; still needed = target minus funded, for items still collecting money.",
        data: needs,
        fields: fields([
          ["needId", "Need ID", "textFormat", true],
          ["orgSlug", "Charity slug", "textFormat", true],
          ["orgName", "Charity", "textFormat"],
          ["title", "Item", "textFormat"],
          ["category", "Category code", "textFormat", true],
          ["categoryLabel", "Category", "textFormat"],
          ["urgency", "Urgency level", "integerFormat", true],
          ["urgencyLabel", "Urgency", "textFormat"],
          ["status", "Status code", "textFormat", true],
          ["statusLabel", "Status", "textFormat"],
          ["quantity", "Quantity", "integerFormat"],
          ["unit", "Unit", "textFormat"],
          ["retailer", "Retailer", "textFormat"],
          ["targetUsd", "Target", "currencyFormat"],
          ["fundedUsd", "Funded", "currencyFormat"],
          ["stillNeededUsd", "Still needed", "currencyFormat"],
          ["fundedCount", "Items funded", "integerFormat"],
          ["deliveredCount", "Items delivered", "integerFormat"],
          ["isFunded", "Is funded", "booleanFormat"],
          ["isDelivered", "Is delivered", "booleanFormat"],
          ["createdAt", "Posted", "dateTimeFormat"],
          ["fundedAt", "Funded on", "dateTimeFormat"],
          ["orderedAt", "Ordered on", "dateTimeFormat"],
          ["deliveredAt", "Delivered on", "dateTimeFormat"],
          ["daysFundedToDelivered", "Days from funded to delivered", "integerFormat"],
          ["photoUrl", "Arrival photo", "textFormat"],
        ]),
      },
      {
        id: "donations",
        description:
          "One row per gift, net of refunds. Source 'seed' is demo history, 'order' a PayPal checkout, 'invoice' a sponsor invoice.",
        data: donations,
        fields: fields([
          ["donationKey", "Donation key", "textFormat", true],
          ["orgSlug", "Charity slug", "textFormat", true],
          ["orgName", "Charity", "textFormat"],
          ["amountUsd", "Donated", "currencyFormat"],
          ["source", "Source", "textFormat"],
          ["donatedAt", "Donated on", "dateTimeFormat"],
          ["month", "Month", "textFormat"],
        ]),
      },
      {
        id: "allocations",
        description:
          "Which item each dollar paid for. One donation can be split over several items. Negative amounts are money moved out of an item (to the next need after a price drop, or refunded); sum them for net.",
        data: allocations,
        fields: fields([
          ["allocationId", "Allocation ID", "textFormat", true],
          ["donationKey", "Donation key", "textFormat", true],
          ["needId", "Need ID", "textFormat", true],
          ["orgSlug", "Charity slug", "textFormat", true],
          ["orgName", "Charity", "textFormat"],
          ["category", "Category code", "textFormat", true],
          ["categoryLabel", "Category", "textFormat"],
          ["amountUsd", "Allocated", "currencyFormat"],
          ["reason", "Reason", "textFormat"],
          ["allocatedAt", "Allocated on", "dateTimeFormat"],
          ["month", "Month", "textFormat"],
        ]),
      },
    ],
    relationships: [
      manyToOne("allocation-need", "allocations.needId", "needs.needId"),
      manyToOne("allocation-donation", "allocations.donationKey", "donations.donationKey"),
      onCalendar("donations", "donatedAt"),
      onCalendar("allocations", "allocatedAt"),
    ],
    calendars: [
      {
        id: CALENDAR_ID,
        label: "Calendar",
        range: {
          from: { type: "date", value: dates[0] ?? today },
          to: { type: "date", value: dates.at(-1) ?? today },
        },
        fragments: ["year", "quarter", "month", "week", "day", "dayOfWeek"],
      },
    ],
  };
}

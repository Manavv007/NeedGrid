import { NEED_STATUSES, NeedCard, type Category, type NeedStatus } from "@needgrid/shared";
import { describe, expect, it } from "vitest";
import {
  applyFilters,
  categoriesIn,
  compareMostUrgent,
  countByTab,
  DEFAULT_FILTERS,
  hasNarrowingFilters,
  isDonatable,
  parseFilters,
  resultSummary,
  tabOf,
  visibleNeeds,
  writeFilters,
  type Filters,
} from "@/features/tiles/filterNeeds";

let seq = 0;

/** A valid NeedCard (parsed with the shared schema) with just the fields a test cares about. */
function need(over: Partial<NeedCard> & { title: string }): NeedCard {
  seq += 1;
  return NeedCard.parse({
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    orgId: "4c1f7a2e-9b3d-4e5f-8a6b-000000000001",
    orgSlug: "harbor-food-bank",
    description: "",
    category: "food",
    urgency: 2,
    quantity: 1,
    unit: "pack",
    status: "open",
    targetCents: 1000,
    fundedCents: 0,
    heldCents: 0,
    remainingCents: 1000,
    donorCount: 0,
    product: null,
    deadlineAt: null,
    createdAt: "2026-10-20T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
    ...over,
  });
}

const titles = (needs: NeedCard[]) => needs.map((n) => n.title);
const filters = (over: Partial<Filters> = {}): Filters => ({ ...DEFAULT_FILTERS, ...over });

const byStatus = Object.fromEntries(NEED_STATUSES.map((status) => [status, need({ title: status, status })])) as Record<
  NeedStatus,
  NeedCard
>;
const all = Object.values(byStatus);

describe("tabs", () => {
  it("puts open + topping_up in Still needed, funded + ordered in Funded, delivered in Delivered", () => {
    expect(titles(applyFilters(all, filters({ tab: "needed" })))).toEqual(
      expect.arrayContaining(["open", "topping_up"]),
    );
    expect(applyFilters(all, filters({ tab: "needed" }))).toHaveLength(2);
    expect(titles(applyFilters(all, filters({ tab: "funded" })))).toEqual(
      expect.arrayContaining(["funded", "ordered"]),
    );
    expect(applyFilters(all, filters({ tab: "funded" }))).toHaveLength(2);
    expect(titles(applyFilters(all, filters({ tab: "delivered" })))).toEqual(["delivered"]);
  });

  it("never shows drafts or closed needs, even if the API sent them", () => {
    expect(tabOf("draft")).toBeNull();
    expect(tabOf("closed")).toBeNull();
    expect(titles(visibleNeeds(all))).not.toContain("draft");
    expect(titles(visibleNeeds(all))).not.toContain("closed");
    for (const tab of ["needed", "funded", "delivered"] as const) {
      expect(titles(applyFilters(all, filters({ tab })))).not.toEqual(expect.arrayContaining(["draft"]));
      expect(titles(applyFilters(all, filters({ tab })))).not.toEqual(expect.arrayContaining(["closed"]));
    }
  });

  it("counts every visible need once", () => {
    expect(countByTab(all)).toEqual({ needed: 2, funded: 2, delivered: 1 });
  });

  it("treats only open and topping_up as donatable", () => {
    expect(NEED_STATUSES.filter(isDonatable)).toEqual(["open", "topping_up"]);
  });
});

describe("categories and urgency", () => {
  const needs = [
    need({ title: "beans", category: "food", urgency: 3 }),
    need({ title: "diapers", category: "baby", urgency: 3 }),
    need({ title: "wipes", category: "baby", urgency: 1 }),
    need({ title: "soap", category: "hygiene", urgency: 2 }),
    need({ title: "secret draft", category: "pet", status: "draft" }),
    need({ title: "closed coat", category: "clothing", status: "closed" }),
  ];

  it("lists only categories with visible needs, in CATEGORIES order", () => {
    expect(categoriesIn(needs)).toEqual<Category[]>(["food", "hygiene", "baby"]);
  });

  it("filters by category", () => {
    expect(titles(applyFilters(needs, filters({ category: "baby" })))).toEqual(["diapers", "wipes"]);
  });

  it("filters to urgency 3 with Urgent only, combined with a category", () => {
    expect(titles(applyFilters(needs, filters({ urgentOnly: true })))).toEqual(["beans", "diapers"]);
    expect(titles(applyFilters(needs, filters({ urgentOnly: true, category: "baby" })))).toEqual(["diapers"]);
  });

  it("knows when the tab is narrowed", () => {
    expect(hasNarrowingFilters(filters())).toBe(false);
    expect(hasNarrowingFilters(filters({ tab: "funded", sort: "newest" }))).toBe(false);
    expect(hasNarrowingFilters(filters({ category: "baby" }))).toBe(true);
    expect(hasNarrowingFilters(filters({ urgentOnly: true }))).toBe(true);
  });
});

describe("sorting", () => {
  const needs = [
    need({
      title: "low, soon",
      urgency: 1,
      deadlineAt: "2026-10-30T10:00:00.000Z",
      createdAt: "2026-10-01T00:00:00.000Z",
    }),
    need({ title: "urgent, no deadline", urgency: 3, deadlineAt: null, createdAt: "2026-10-02T00:00:00.000Z" }),
    need({
      title: "urgent, later",
      urgency: 3,
      deadlineAt: "2026-11-05T10:00:00.000Z",
      createdAt: "2026-10-03T00:00:00.000Z",
    }),
    need({
      title: "urgent, sooner",
      urgency: 3,
      deadlineAt: "2026-10-31T10:00:00.000Z",
      createdAt: "2026-10-09T00:00:00.000Z",
    }),
    need({
      title: "urgent, sooner, older",
      urgency: 3,
      deadlineAt: "2026-10-31T10:00:00.000Z",
      createdAt: "2026-10-04T00:00:00.000Z",
    }),
    need({ title: "medium, no deadline, newest", urgency: 2, deadlineAt: null, createdAt: "2026-10-10T00:00:00.000Z" }),
  ];

  it("most urgent first: urgency desc, deadline asc with none last, then oldest first", () => {
    expect(titles(applyFilters(needs, filters({ sort: "urgent" })))).toEqual([
      "urgent, sooner, older",
      "urgent, sooner",
      "urgent, later",
      "urgent, no deadline",
      "medium, no deadline, newest",
      "low, soon",
    ]);
  });

  it("compares deadlines as instants, whatever the ISO spelling", () => {
    const a = need({ title: "a", deadlineAt: "2026-10-31T10:00:00Z", createdAt: "2026-10-02T00:00:00.000Z" });
    const b = need({ title: "b", deadlineAt: "2026-10-31T10:00:00.000Z", createdAt: "2026-10-01T00:00:00.000Z" });
    expect(compareMostUrgent(a, b)).toBeGreaterThan(0); // same deadline → older (b) first
  });

  it("newest: created desc", () => {
    expect(titles(applyFilters(needs, filters({ sort: "newest" })))).toEqual([
      "medium, no deadline, newest",
      "urgent, sooner",
      "urgent, sooner, older",
      "urgent, later",
      "urgent, no deadline",
      "low, soon",
    ]);
  });

  it("doesn't reorder the array it was given", () => {
    const before = titles(needs);
    applyFilters(needs, filters({ sort: "newest" }));
    expect(titles(needs)).toEqual(before);
  });
});

describe("URL params", () => {
  const parse = (query: string, available?: Category[]) => parseFilters(new URLSearchParams(query), available);

  it("defaults to Still needed, all categories, most urgent first", () => {
    expect(parse("")).toEqual({ tab: "needed", category: null, urgentOnly: false, sort: "urgent" });
  });

  it("reads valid values", () => {
    expect(parse("tab=delivered&category=baby&urgent=1&sort=newest")).toEqual({
      tab: "delivered",
      category: "baby",
      urgentOnly: true,
      sort: "newest",
    });
  });

  it("falls back to the defaults for bad values", () => {
    expect(parse("tab=closed&category=weapons&urgent=yes&sort=cheapest")).toEqual(DEFAULT_FILTERS);
    expect(parse("tab=&category=&urgent=&sort=")).toEqual(DEFAULT_FILTERS);
    expect(parse("tab=FUNDED&category=Baby&urgent=true")).toEqual(DEFAULT_FILTERS);
  });

  it("drops a category this page has no chip for", () => {
    expect(parse("category=pet", ["food", "baby"]).category).toBeNull();
    expect(parse("category=baby", ["food", "baby"]).category).toBe("baby");
  });

  it("writes only non-default values and keeps unrelated params", () => {
    expect(writeFilters(DEFAULT_FILTERS).toString()).toBe("");
    expect(writeFilters(filters({ tab: "funded", urgentOnly: true })).toString()).toBe("tab=funded&urgent=1");
    const next = writeFilters(
      filters({ category: "food", sort: "newest" }),
      new URLSearchParams("display=1&tab=funded"),
    );
    expect(next.toString()).toBe("display=1&category=food&sort=newest");
  });

  it("round-trips", () => {
    const f = filters({ tab: "delivered", category: "hygiene", urgentOnly: true, sort: "newest" });
    expect(parseFilters(writeFilters(f))).toEqual(f);
  });
});

describe("resultSummary", () => {
  it("says how many items the tab shows, with the active filters", () => {
    expect(resultSummary(8, filters())).toBe("8 items still needed");
    expect(resultSummary(1, filters({ tab: "funded" }))).toBe("1 item funded");
    expect(resultSummary(0, filters({ tab: "delivered" }))).toBe("0 items delivered");
    expect(resultSummary(2, filters({ category: "baby", urgentOnly: true }))).toBe(
      "2 items still needed in Baby, urgent only",
    );
  });
});

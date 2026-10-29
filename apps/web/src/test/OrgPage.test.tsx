import { OrgPageRes } from "@needgrid/shared";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { mockDb } from "@/mocks/mockDb";
import { server } from "@/mocks/node";
import { renderRoute } from "./render";

const API = "http://api.test";
const HARBOR = "/o/harbor-food-bank";
/** MSW pattern for GET /api/orgs/:slug (paths.org would URL-encode the ":"). */
const ORG_ROUTE = `${API}/api/orgs/:slug`;

const STILL_NEEDED = [
  "Diapers, size 4",
  "Infant formula, 12.4 oz",
  "Baby wipes, unscented",
  "Canned chicken, 12.5 oz",
  "Peanut butter, 40 oz",
  "Canned tuna, 5 oz",
  "Toothpaste, 4 oz",
  "Rolled oats, 42 oz",
];

async function renderHarbor(query = "") {
  const utils = renderRoute(`${HARBOR}${query}`);
  await screen.findByRole("heading", { level: 1, name: "Harbor Food Bank" });
  return utils;
}

/** Tile titles in the visible tab panel, in display order. */
function tileTitles(): string[] {
  return within(screen.getByRole("tabpanel"))
    .getAllByRole("article")
    .map((article) => within(article).getByRole("heading", { level: 2 }).textContent ?? "");
}

const search = (router: { state: { location: { search: string } } }) => router.state.location.search;

describe("Tile wall /o/:slug", () => {
  it("shows a loading state, then Harbor's header, stats and still-needed tiles", async () => {
    document.title = "NeedGrid";
    const { router } = renderRoute(HARBOR);
    expect(screen.getByText("Loading this charity's list…")).toBeInTheDocument();

    await screen.findByRole("heading", { level: 1, name: "Harbor Food Bank" });
    expect(screen.getByText("Food bank · Portland, ME")).toBeInTheDocument();
    expect(screen.getAllByRole("term").map((t) => t.textContent)).toEqual([
      "Raised",
      "Items delivered",
      "Still needed",
      "Items funded",
    ]);
    expect(screen.getAllByRole("definition").map((d) => d.textContent)).toEqual(["$532", "1", "8", "4"]);

    expect(screen.getByRole("tab", { name: /Still needed/, selected: true })).toHaveTextContent("Still needed · 8");
    expect(screen.getByRole("tab", { name: /Funded/ })).toHaveTextContent("Funded · 3");
    expect(screen.getByRole("tab", { name: /Delivered/ })).toHaveTextContent("Delivered · 1");
    expect(tileTitles()).toEqual(STILL_NEEDED);

    // Drafts and closed needs are never on the public page.
    expect(screen.queryByText("Hand soap, 7.5 oz")).not.toBeInTheDocument();
    expect(screen.queryByText("Paper towels")).not.toBeInTheDocument();

    const chips = within(screen.getByRole("group", { name: "Filter by category" })).getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual(["All", "Food", "Hygiene", "Baby", "Clothing", "Household"]);

    // No filter has changed yet, so nothing is announced.
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    expect(document.title).toBe("Harbor Food Bank · NeedGrid");
    await act(async () => {
      await router.navigate("/");
    });
    expect(document.title).toBe("NeedGrid");
  });

  it("switches tabs, keeps the tab in the URL, and Back undoes it", async () => {
    const { router } = await renderHarbor();

    await userEvent.click(screen.getByRole("tab", { name: /Funded/ }));
    expect(screen.getByRole("tab", { name: /Funded/, selected: true })).toBeInTheDocument();
    expect(tileTitles()).toEqual(["Kids' toothbrushes", "Women's socks", "Laundry detergent"]);
    expect(search(router)).toBe("?tab=funded");
    expect(screen.getByRole("status")).toHaveTextContent("3 items funded");

    await userEvent.click(screen.getByRole("tab", { name: /Delivered/ }));
    expect(tileTitles()).toEqual(["Diapers, size 3"]);
    expect(search(router)).toBe("?tab=delivered");
    expect(screen.getByRole("status")).toHaveTextContent("1 item delivered");

    await act(async () => {
      await router.navigate(-1);
    });
    expect(screen.getByRole("tab", { name: /Funded/, selected: true })).toBeInTheDocument();
    expect(tileTitles()).toHaveLength(3);
    expect(search(router)).toBe("?tab=funded");
  });

  it("filters with Urgent only and category chips, and sorts newest first", async () => {
    const { router } = await renderHarbor();
    const urgent = screen.getByRole("button", { name: "Urgent only" });

    await userEvent.click(urgent);
    expect(urgent).toHaveAttribute("aria-pressed", "true");
    expect(tileTitles()).toEqual(["Diapers, size 4", "Infant formula, 12.4 oz"]);
    expect(search(router)).toBe("?urgent=1");
    expect(screen.getByRole("status")).toHaveTextContent("2 items still needed, urgent only");

    await userEvent.click(urgent);
    expect(urgent).toHaveAttribute("aria-pressed", "false");
    expect(tileTitles()).toEqual(STILL_NEEDED);

    await userEvent.click(screen.getByRole("button", { name: "Baby" }));
    expect(screen.getByRole("button", { name: "Baby" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false");
    expect(tileTitles()).toEqual(["Diapers, size 4", "Infant formula, 12.4 oz", "Baby wipes, unscented"]);
    expect(search(router)).toBe("?category=baby");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "newest");
    expect(tileTitles()).toEqual(["Baby wipes, unscented", "Infant formula, 12.4 oz", "Diapers, size 4"]);
    expect(search(router)).toBe("?category=baby&sort=newest");
  });

  it("shows No items match with Clear filters when the filters leave nothing", async () => {
    const { router } = await renderHarbor("?tab=funded&urgent=1");
    expect(screen.getByRole("heading", { name: "No items match" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(tileTitles()).toHaveLength(3);
    expect(search(router)).toBe("?tab=funded");
    expect(screen.getByRole("button", { name: "Urgent only" })).toHaveAttribute("aria-pressed", "false");
  });

  it("falls back to the defaults for invalid URL params", async () => {
    await renderHarbor("?tab=closed&sort=cheapest&category=pet&urgent=maybe");
    expect(screen.getByRole("tab", { name: /Still needed/, selected: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "Sort" })).toHaveValue("urgent");
    expect(tileTitles()).toEqual(STILL_NEEDED);
  });

  it("says everything is funded when nothing is still needed", async () => {
    server.use(
      http.get(ORG_ROUTE, () => {
        const page = OrgPageRes.parse(mockDb.getOrgPage("harbor-food-bank"));
        const needs = page.needs.filter((n) => n.status !== "open" && n.status !== "topping_up");
        return HttpResponse.json({ ...page, needs });
      }),
    );
    await renderHarbor();
    expect(screen.getByRole("heading", { name: "Everything here is funded" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See other charities" })).toHaveAttribute("href", "/#orgs");
  });

  it("copies the page link when the share sheet isn't available", async () => {
    const user = userEvent.setup();
    await renderHarbor("?tab=funded");
    await user.click(screen.getByRole("button", { name: "Share" }));
    await expect(navigator.clipboard.readText()).resolves.toBe(`${window.location.origin}${HARBOR}?tab=funded`);
  });

  it("shows a not-found state for an unknown charity", async () => {
    renderRoute("/o/no-such-charity");
    expect(await screen.findByRole("heading", { name: "We couldn't find that charity" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See all charities" })).toHaveAttribute("href", "/");
    expect(document.title).toBe("Charity not found · NeedGrid");
  });

  it("shows the error state with Try again on a server error, then recovers", async () => {
    let fail = true;
    server.use(
      http.get(ORG_ROUTE, () =>
        fail
          ? HttpResponse.json({ error: { code: "INTERNAL", message: "boom" } }, { status: 500 })
          : HttpResponse.json(mockDb.getOrgPage("harbor-food-bank")),
      ),
    );
    renderRoute(HARBOR);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("heading", { name: "We couldn't load this" })).toBeInTheDocument();

    fail = false;
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Harbor Food Bank" })).toBeInTheDocument();
  });
});

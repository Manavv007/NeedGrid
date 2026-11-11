import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatUsdWhole } from "@/lib/format";
import { DEMO_IMPACT_TOKEN, DEMO_NEEDS } from "@/mocks/fixtures";
import { mockDb } from "@/mocks/mockDb";
import { renderRoute } from "./render";

const HARBOR = "/o/harbor-food-bank";
const GITHUB = "https://github.com/Manavv007/NeedGrid";

// jsdom has no scrollIntoView; React Router's ScrollRestoration calls it for a #hash target.
const originalScrollIntoView = Element.prototype.scrollIntoView;
beforeAll(() => {
  Element.prototype.scrollIntoView = () => undefined;
});
afterAll(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

const landing = async () => {
  const utils = renderRoute("/");
  await screen.findByRole("link", { name: /Harbor Food Bank/ });
  return utils;
};

describe("Public site header", () => {
  it("shows the logo, the main nav, For charities and Give an item", async () => {
    await landing();
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "NeedGrid" })).toHaveAttribute("href", "/");

    const nav = within(header).getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Charities" })).toHaveAttribute("href", "/#orgs");
    expect(within(nav).getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/#how-it-works");
    expect(within(nav).getByRole("link", { name: "Impact" })).toHaveAttribute("href", "/dashboard");
    // Hash links to landing sections are never "the current page"; only the Impact page can be.
    for (const link of within(nav).getAllByRole("link")) expect(link).not.toHaveAttribute("aria-current");

    expect(within(header).getByRole("link", { name: "For charities" })).toHaveAttribute("href", "/staff/login");
    expect(within(header).getByRole("link", { name: "Give an item" })).toHaveAttribute("href", "/#orgs");
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
  });

  it("links to the landing sections it names", async () => {
    await landing();
    expect(document.getElementById("orgs")).toHaveAccessibleName("Charities on NeedGrid");
    expect(document.getElementById("how-it-works")).toHaveAccessibleName("How it works");
    expect(document.getElementById("match")).toHaveAccessibleName("Not sure where to start?");
  });

  it("phone menu: opens under the bar, closes with Esc and returns focus to the menu button", async () => {
    const user = userEvent.setup();
    await landing();
    const button = screen.getByRole("button", { name: "Open menu" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    const panel = document.getElementById(button.getAttribute("aria-controls") ?? "");
    expect(panel).not.toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Menu" })).not.toBeInTheDocument();

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAccessibleName("Close menu");
    expect(panel).toBeVisible();
    const menu = screen.getByRole("navigation", { name: "Menu" });
    expect(
      within(menu)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Charities", "How it works", "Impact", "For charities", "Give an item"]);

    await user.keyboard("{Escape}");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAccessibleName("Open menu");
    expect(panel).not.toBeVisible();
    expect(button).toHaveFocus();
  });

  it("phone menu: a link closes it, navigates, and returns focus to the menu button", async () => {
    const user = userEvent.setup();
    const { router } = await landing();
    const button = screen.getByRole("button", { name: "Open menu" });
    await user.click(button);
    await user.click(
      within(screen.getByRole("navigation", { name: "Menu" })).getByRole("link", { name: "How it works" }),
    );

    expect(router.state.location.hash).toBe("#how-it-works");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("navigation", { name: "Menu" })).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });
});

describe("Public site footer", () => {
  it("has the brand line, three link columns and the small print", async () => {
    await landing();
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText("Fund the exact items charities need, and see them arrive.")).toBeInTheDocument();
    expect(
      within(footer)
        .getAllByRole("heading", { level: 2 })
        .map((h) => h.textContent),
    ).toEqual(["Give", "For charities", "Project"]);

    const give = within(footer).getByRole("list", { name: "Give" });
    expect(within(give).getByRole("link", { name: "Charities" })).toHaveAttribute("href", "/#orgs");
    expect(within(give).getByRole("link", { name: "Find a match" })).toHaveAttribute("href", "/#match");
    expect(within(give).getByRole("link", { name: "Impact dashboard" })).toHaveAttribute("href", "/dashboard");

    const charities = within(footer).getByRole("list", { name: "For charities" });
    expect(within(charities).getByRole("link", { name: "Staff sign in" })).toHaveAttribute("href", "/staff/login");
    expect(within(charities).getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/#how-it-works");

    const project = within(footer).getByRole("list", { name: "Project" });
    const source = within(project).getByRole("link", { name: "Source code (opens in a new tab)" });
    expect(source).toHaveAttribute("href", GITHUB);
    expect(source).toHaveAttribute("target", "_blank");
    expect(source).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(project).getByText("Built for the PayPal AI Hackathon 2026")).toBeInTheDocument();

    expect(within(footer).getByText("© 2026 NeedGrid")).toBeInTheDocument();
    expect(within(footer).getByText("Payments by PayPal · Every dollar is tracked to an item.")).toBeInTheDocument();
  });
});

describe("Landing hero totals", () => {
  it("adds up the charity list the page already loaded", async () => {
    await landing();
    const orgs = mockDb.listOrgSummaries();
    const raised = orgs.reduce((sum, org) => sum + org.stats.raisedCents, 0);
    const delivered = orgs.reduce((sum, org) => sum + org.stats.itemsDelivered, 0);
    const items = delivered === 1 ? "item" : "items";
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === "P" &&
          el.textContent === `${formatUsdWhole(raised)} raised · ${delivered} ${items} delivered · 3 charities`,
      ),
    ).toBeInTheDocument();
  });
});

describe("No prototype labels on public pages", () => {
  const pages = [
    { name: "landing", path: "/", h1: "Shelters get 400 cans of beans and zero diapers." },
    { name: "tile wall", path: HARBOR, h1: "Harbor Food Bank" },
    { name: "need", path: `${HARBOR}/n/${DEMO_NEEDS.fourteenLeft}`, h1: "Diapers, size 4" },
    { name: "thank-you", path: `/thanks/${DEMO_IMPACT_TOKEN}`, h1: "Thank you!" },
    { name: "impact", path: `/impact/${DEMO_IMPACT_TOKEN}`, h1: "Hi Sam, your diapers arrived." },
    { name: "flyer", path: `${HARBOR}/flyer`, h1: "Help us get these 6 items" },
  ];

  it.each(pages)("$name page has no sandbox demo text", async ({ path, h1 }) => {
    renderRoute(path);
    await screen.findByRole("heading", { level: 1, name: h1 }, { timeout: 10_000 });
    expect(document.body.textContent).not.toMatch(/sandbox demo|no real money/i);
  });
});

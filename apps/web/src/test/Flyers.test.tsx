import { OrgPageRes, STAFF_KEY_STORAGE } from "@needgrid/shared";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { qrPath } from "@/components/QrCode";
import { mockDb } from "@/mocks/mockDb";
import { server } from "@/mocks/node";
import { renderRoute } from "./render";

const ORG_ROUTE = "http://api.test/api/orgs/:slug";
const HARBOR = "/o/harbor-food-bank";
const DIAPERS_4 = "4c1f7a2e-9b3d-4e5f-8a6b-000000000101"; // open, $14 left
const LAUNDRY = "4c1f7a2e-9b3d-4e5f-8a6b-000000000110"; // funded

afterEach(() => {
  vi.restoreAllMocks();
});

/** The `d` of the QR code's path: equal paths encode the same text. */
function qrData(name: RegExp): string | null | undefined {
  return screen.getByRole("img", { name }).querySelector("path")?.getAttribute("d");
}

const pageRule = () =>
  [...document.querySelectorAll("style")].map((s) => s.textContent ?? "").find((t) => t.includes("@page"));

describe("Org flyer /o/:slug/flyer", () => {
  it("up to 6 donatable items, most urgent first, and a big QR code to the absolute tile-wall URL", async () => {
    renderRoute(`${HARBOR}/flyer`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Help us get these 6 items" }, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Flyer · Harbor Food Bank · NeedGrid");
    expect(screen.getByText("Harbor Food Bank · Portland, ME")).toBeInTheDocument();
    // A standalone print page: no site header or footer.
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();

    const items = within(screen.getByRole("list", { name: "Items" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "Diapers, size 4$14 left",
      "Infant formula, 12.4 oz$56 left",
      "Baby wipes, unscented$19 left",
      "Canned chicken, 12.5 oz$26 left",
      "Peanut butter, 40 oz$59 left",
      "Canned tuna, 5 oz$5 more needed",
    ]);
    expect(within(items[0] ?? document.body).getByRole("img", { name: /Pampers/ })).toBeInTheDocument();

    const wall = `${window.location.origin}${HARBOR}`;
    expect(qrData(/^QR code: scan to see what Harbor Food Bank needs/)).toBe(qrPath(wall).d);
    expect(screen.getByText("Scan to fund an item")).toBeInTheDocument();
    expect(screen.getByText(`${window.location.host}${HARBOR}`)).toBeInTheDocument();
    expect(screen.getByText("Sandbox demo, no real money")).toBeInTheDocument();
  });

  it("Print calls window.print; Back goes to the tile wall; the paper toggle sets @page", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderRoute(`${HARBOR}/flyer`);
    await screen.findByRole("heading", { level: 1, name: "Help us get these 6 items" }, { timeout: 10_000 });
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", HARBOR);

    const paper = screen.getByRole("group", { name: "Paper size" });
    expect(within(paper).getByRole("button", { name: "Letter" })).toHaveAttribute("aria-pressed", "true");
    expect(pageRule()).toContain("size: letter");
    await user.click(within(paper).getByRole("button", { name: "A4" }));
    expect(within(paper).getByRole("button", { name: "A4" })).toHaveAttribute("aria-pressed", "true");
    expect(pageRule()).toContain("size: A4");
    expect(document.querySelector("[data-flyer-sheet]")).toHaveAttribute("data-flyer-sheet", "a4");

    await user.click(screen.getByRole("button", { name: "Print" }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("nothing left to fund: a thank-you instead of a QR code to an empty wall", async () => {
    server.use(
      http.get(ORG_ROUTE, () => {
        const page = OrgPageRes.parse(mockDb.getOrgPage("harbor-food-bank"));
        return HttpResponse.json({ ...page, needs: page.needs.filter((n) => n.status === "funded") });
      }),
    );
    renderRoute(`${HARBOR}/flyer`);
    expect(
      await screen.findByRole("heading", { name: "Everything here is funded, thank you" }, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /QR code/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Print" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Harbor Food Bank" })).toHaveAttribute("href", HARBOR);
  });

  it("unknown charity: not found", async () => {
    renderRoute("/o/no-such-charity/flyer");
    expect(await screen.findByRole("heading", { name: "We couldn't find that charity" })).toBeInTheDocument();
  });
});

describe("Need flyer /o/:slug/n/:needId/flyer", () => {
  it("the one need, large, with a QR code to the absolute need URL", async () => {
    renderRoute(`${HARBOR}/n/${DIAPERS_4}/flyer`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Diapers, size 4" }, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Help us get this item")).toBeInTheDocument();
    expect(screen.getByText("$14 left")).toBeInTheDocument();
    expect(screen.getByText("2 × pack of 150")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Diapers, size 4 funding" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Pampers Cruisers Diapers, Size 4, 150 Count" })).toBeInTheDocument();
    const page = `${window.location.origin}${HARBOR}/n/${DIAPERS_4}`;
    expect(qrData(/^QR code: scan to fund Diapers, size 4/)).toBe(qrPath(page).d);
    expect(screen.getByText("Scan to fund this item")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", `${HARBOR}/n/${DIAPERS_4}`);
  });

  it("a funded need: a thank-you and the org flyer instead, no QR code", async () => {
    renderRoute(`${HARBOR}/n/${LAUNDRY}/flyer`);
    expect(
      await screen.findByRole("heading", { name: "This item is funded, thank you" }, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /QR code/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Print a flyer for Harbor Food Bank" })).toHaveAttribute(
      "href",
      `${HARBOR}/flyer`,
    );
  });

  it("a malformed id is not found without a request", async () => {
    renderRoute(`${HARBOR}/n/not-a-uuid/flyer`);
    expect(await screen.findByRole("heading", { name: "We couldn't find that item" })).toBeInTheDocument();
  });
});

describe("Print flyer links", () => {
  it("tile wall header → org flyer", async () => {
    renderRoute(HARBOR);
    await screen.findByRole("heading", { level: 1, name: "Harbor Food Bank" }, { timeout: 10_000 });
    expect(screen.getByRole("link", { name: "Print flyer" })).toHaveAttribute("href", `${HARBOR}/flyer`);
  });

  it("need page → need flyer, only while the item takes donations", async () => {
    const { router } = renderRoute(`${HARBOR}/n/${DIAPERS_4}`);
    await screen.findByRole("heading", { level: 1, name: "Diapers, size 4" }, { timeout: 10_000 });
    expect(screen.getByRole("link", { name: "Print a flyer for this item" })).toHaveAttribute(
      "href",
      `${HARBOR}/n/${DIAPERS_4}/flyer`,
    );
    await router.navigate(`${HARBOR}/n/${LAUNDRY}`);
    await screen.findByRole("heading", { level: 1, name: "Laundry detergent" });
    expect(screen.queryByRole("link", { name: "Print a flyer for this item" })).not.toBeInTheDocument();
  });

  it("staff console header → the staff org's flyer", async () => {
    sessionStorage.setItem(STAFF_KEY_STORAGE, "harbor-demo-2026");
    renderRoute("/staff");
    await screen.findByRole("heading", { level: 1, name: "Needs" }, { timeout: 10_000 });
    expect(screen.getByRole("link", { name: "Print flyer" })).toHaveAttribute("href", `${HARBOR}/flyer`);
  });
});

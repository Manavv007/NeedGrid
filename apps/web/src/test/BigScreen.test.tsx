import { act, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { qrPath } from "@/components/QrCode";
import { fixtureCard, installFakeEventSource, onlyStream, sendNeedUpdate } from "./fakeEventSource";
import { renderRoute } from "./render";

const SLUG = "harbor-food-bank";
const DIAPERS = "4c1f7a2e-9b3d-4e5f-8a6b-000000000101";

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

beforeEach(() => {
  installFakeEventSource();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderWall() {
  const utils = renderRoute(`/o/${SLUG}?display=1`);
  await screen.findByRole("heading", { level: 1, name: "Harbor Food Bank" });
  return utils;
}

const tileTitles = () =>
  screen.getAllByRole("article").map((tile) => within(tile).getByRole("heading", { level: 2 }).textContent);

describe("Big-screen mode /o/:slug?display=1", () => {
  it("has no site header, filters or tabs: the charity, raised so far, a QR code and the tiles", async () => {
    const { unmount } = await renderWall();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
    expect(screen.queryByText("Sandbox demo, no real money")).not.toBeInTheDocument();
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Filter by category" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Raised so far").nextElementSibling).toHaveTextContent("$532");
    expect(screen.getByText("Scan to fund an item")).toBeInTheDocument();

    // Still needed (most urgent first), then the recently funded ones.
    const titles = tileTitles();
    expect(titles.slice(0, STILL_NEEDED.length)).toEqual(STILL_NEEDED);
    expect(new Set(titles.slice(STILL_NEEDED.length))).toEqual(
      new Set(["Kids' toothbrushes", "Women's socks", "Laundry detergent"]),
    );
    expect(screen.getAllByRole("progressbar")).toHaveLength(titles.length);

    // Every rem scales with the screen while the wall is up.
    expect(document.documentElement.dataset.display).toBe("wall");
    unmount();
    expect(document.documentElement.dataset.display).toBeUndefined();
  });

  it("draws a real QR code for the plain tile wall URL", async () => {
    await renderWall();
    const qr = screen.getByRole("img", { name: "QR code: scan to see what Harbor Food Bank needs and fund an item" });
    const tileWallUrl = `${window.location.origin}/o/${SLUG}`;
    expect(qr.querySelector("path")?.getAttribute("d")).toBe(qrPath(tileWallUrl).d);
    expect(qrPath(tileWallUrl).d).not.toBe(qrPath(`${tileWallUrl}?display=1`).d);
  });

  it("shows the ticker when a tile gets funded, and keeps that tile in place for a moment", async () => {
    await renderWall();
    act(() => onlyStream().open());
    expect(screen.queryByText("Just now")).not.toBeInTheDocument();

    sendNeedUpdate({
      ...fixtureCard(SLUG, DIAPERS),
      status: "funded",
      fundedCents: 8400,
      remainingCents: 0,
      donorCount: 7,
    });

    expect(screen.getByText("Just now")).toBeInTheDocument();
    expect(screen.getByText("Diapers, size 4 is fully funded. Thank you, 7 donors!")).toBeInTheDocument();
    expect(screen.getByText("Diapers, size 4 is fully funded", { selector: "[aria-live]" })).toBeInTheDocument();
    // TanStack Query hands the patched data to the page on the next tick.
    const [first] = screen.getAllByRole("article");
    expect(first).toHaveAccessibleName("Diapers, size 4");
    expect(await within(first ?? document.body).findByText("Funded ✓")).toBeInTheDocument();
    expect(screen.getAllByRole("article")[0]).toBe(first); // stays in place, so its bar fills up
  });

  it("ignores updates that don't fund anything (no ticker)", async () => {
    await renderWall();
    sendNeedUpdate({ ...fixtureCard(SLUG, DIAPERS), fundedCents: 7500, remainingCents: 900 });
    const [first] = screen.getAllByRole("article");
    expect(await within(first ?? document.body).findByText("$9 left")).toBeInTheDocument();
    expect(screen.queryByText("Just now")).not.toBeInTheDocument();
  });
});

import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import { server } from "@/mocks/node";
import { routes } from "@/router";
import { fixtureCard, installFakeEventSource, onlyStream, sendNeedUpdate } from "./fakeEventSource";
import { createTestQueryClient, renderRoute } from "./render";

const API = "http://api.test";
const SLUG = "harbor-food-bank";
const HARBOR = `/o/${SLUG}`;
const DIAPERS = "4c1f7a2e-9b3d-4e5f-8a6b-000000000101"; // $70 of $84, 6 donors
/** MSW pattern for GET /api/orgs/:slug (paths.org would URL-encode the ":"). */
const ORG_ROUTE = `${API}/api/orgs/:slug`;

const fundedDiapers = () => ({
  ...fixtureCard(SLUG, DIAPERS),
  status: "funded" as const,
  fundedCents: 8400,
  remainingCents: 0,
  donorCount: 7,
});

async function renderHarbor() {
  const utils = renderRoute(HARBOR);
  await screen.findByRole("heading", { level: 1, name: "Harbor Food Bank" });
  return utils;
}

describe("live updates on the pages", () => {
  beforeEach(() => {
    installFakeEventSource();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tile wall: one stream for the page; the Reconnecting pill shows on error and hides on open", async () => {
    await renderHarbor();
    const source = onlyStream();
    act(() => source.open());
    expect(screen.queryByText("Reconnecting live updates…")).not.toBeInTheDocument();

    act(() => source.fail());
    expect(screen.getByText("Reconnecting live updates…")).toBeInTheDocument();
    act(() => source.open());
    expect(screen.queryByText("Reconnecting live updates…")).not.toBeInTheDocument();
  });

  it("tile wall: a tile funded elsewhere moves to Funded, the counts follow, and it's announced", async () => {
    await renderHarbor();
    expect(screen.getByRole("tab", { name: /Still needed/ })).toHaveTextContent("Still needed · 8");
    expect(screen.getByRole("article", { name: "Diapers, size 4" })).toBeInTheDocument();

    sendNeedUpdate(fundedDiapers());

    // TanStack Query hands the patched data to the page on the next tick.
    await vi.waitFor(() =>
      expect(screen.getByRole("tab", { name: /Still needed/ })).toHaveTextContent("Still needed · 7"),
    );
    expect(screen.getByRole("tab", { name: /Funded/ })).toHaveTextContent("Funded · 4");
    expect(screen.queryByRole("article", { name: "Diapers, size 4" })).not.toBeInTheDocument();
    expect(screen.getByText("Diapers, size 4 is fully funded")).toHaveAttribute("aria-live", "polite");

    await userEvent.click(screen.getByRole("tab", { name: /Funded/ }));
    const tile = screen.getByRole("article", { name: "Diapers, size 4" });
    expect(tile).toHaveAttribute("data-just-funded", "true");
    expect(within(tile).getByText("$84 raised · 7 donors")).toBeInTheDocument();
  });

  it("need page: funded by someone else while the donor only looks → the status view replaces the panel", async () => {
    renderRoute(`${HARBOR}/n/${DIAPERS}`);
    const panel = await screen.findByRole("complementary", { name: "Donate" });
    expect(within(panel).getByText("$14.00 left")).toBeInTheDocument();

    sendNeedUpdate(fundedDiapers());

    expect(await screen.findByRole("heading", { name: "Fully funded, thank you!" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Donate" })).not.toBeInTheDocument();
    expect(screen.getByText("Diapers, size 4 is fully funded")).toHaveAttribute("aria-live", "polite");
  });
});

describe("live updates in mock mode", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_USE_MOCKS", "true");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("a gift on the need page moves the open tile wall's bar in the same tab, with no refetch", async () => {
    // Only the first org request is answered: any refetch hangs, so the tile can only move live.
    let orgRequests = 0;
    server.use(
      http.get(ORG_ROUTE, async () => {
        orgRequests += 1;
        if (orgRequests > 1) await new Promise<never>(() => undefined);
      }),
    );
    const queryClient = createTestQueryClient();
    const wallRouter = createMemoryRouter(routes, { initialEntries: [HARBOR] });
    const phoneRouter = createMemoryRouter(routes, { initialEntries: [`${HARBOR}/n/${DIAPERS}`] });
    render(
      <QueryClientProvider client={queryClient}>
        <div data-testid="wall">
          <RouterProvider router={wallRouter} />
        </div>
        <div data-testid="phone">
          <RouterProvider router={phoneRouter} />
        </div>
        <Toaster />
      </QueryClientProvider>,
    );
    const wall = within(screen.getByTestId("wall"));
    const phone = within(screen.getByTestId("phone"));

    const tile = await wall.findByRole("article", { name: "Diapers, size 4" });
    const bar = within(tile).getByRole("progressbar");
    expect(within(tile).getByText("$14 left")).toBeInTheDocument();
    const fundedSegment = bar.firstElementChild;
    expect(fundedSegment).toHaveStyle({ width: `${(7000 / 8400) * 100}%` });

    await userEvent.click(await phone.findByRole("button", { name: "$10" }));
    await userEvent.click(phone.getByRole("button", { name: /^Mock PayPal/ }));
    await phone.findByRole("heading", { level: 1, name: "Thank you!" });

    expect(await within(tile).findByText("$4 left")).toBeInTheDocument();
    expect(bar).toHaveAttribute("aria-valuetext", "$80 of $84 raised, $4 left");
    expect(bar.firstElementChild).toBe(fundedSegment); // same element, so the width animates
    expect(fundedSegment).toHaveStyle({ width: `${(8000 / 8400) * 100}%` });
    expect(orgRequests).toBeGreaterThan(1); // the gift asked for a refetch; it never answered
  });
});

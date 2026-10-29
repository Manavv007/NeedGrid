import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockDb } from "@/mocks/mockDb";
import { renderRoute } from "./render";

const ID = {
  diapers4: "4c1f7a2e-9b3d-4e5f-8a6b-000000000101", // open, $14 left of $84, due tomorrow
  formula: "4c1f7a2e-9b3d-4e5f-8a6b-000000000102", // Harbor's next most urgent
  tuna: "4c1f7a2e-9b3d-4e5f-8a6b-000000000108", // topping_up
  laundry: "4c1f7a2e-9b3d-4e5f-8a6b-000000000110", // funded
  socks: "4c1f7a2e-9b3d-4e5f-8a6b-000000000111", // ordered
  diapers3: "4c1f7a2e-9b3d-4e5f-8a6b-000000000112", // delivered with a photo
  handSoap: "4c1f7a2e-9b3d-4e5f-8a6b-000000000113", // draft
} as const;

const harborNeed = (id: string, query = "") => `/o/harbor-food-bank/n/${id}${query}`;

/** Timeline stage names in order (the visible label text of each list item). */
function stages(name = "Progress"): string[] {
  return within(screen.getByRole("list", { name }))
    .getAllByRole("listitem")
    .map((li) => li.textContent ?? "");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Need page /o/:slug/n/:needId", () => {
  it("donatable: photo, urgency + deadline, retailer link, why it's needed, panel and timeline", async () => {
    renderRoute(harborNeed(ID.diapers4));
    expect(screen.getByText("Loading this item…")).toBeInTheDocument();

    expect(await screen.findByRole("heading", { level: 1, name: "Diapers, size 4" })).toBeInTheDocument();
    expect(document.title).toBe("Diapers, size 4 · Harbor Food Bank · NeedGrid");
    expect(screen.getByRole("link", { name: "Harbor Food Bank" })).toHaveAttribute("href", "/o/harbor-food-bank");
    expect(screen.getByRole("img", { name: "Pampers Cruisers Diapers, Size 4, 150 Count" })).toBeInTheDocument();
    expect(screen.getByText(/^Urgent · needed by /)).toBeInTheDocument();
    expect(screen.getByText("2 × pack of 150")).toBeInTheDocument();
    const retailer = screen.getByRole("link", { name: /View at Walmart/ });
    expect(retailer).toHaveAttribute("href", "https://www.walmart.com/search?q=pampers%20cruisers%20size%204%20150");
    expect(retailer).toHaveAttribute("target", "_blank");
    expect(retailer).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/Families with toddlers go through a pack a week/)).toBeInTheDocument();

    const panel = screen.getByRole("complementary", { name: "Donate" });
    expect(within(panel).getByText("$14.00 left")).toBeInTheDocument();
    expect(within(panel).getByText("$70.00 raised of $84.00 · 6 donors")).toBeInTheDocument();
    expect(within(panel).getByRole("progressbar", { name: "Diapers, size 4 funding" })).toHaveAttribute(
      "aria-valuenow",
      "7000",
    );
    expect(within(panel).getByText("PayPal sandbox: use the demo buyer login from the README.")).toBeInTheDocument();
    // Tests run with mocks off and no PayPal client id.
    expect(within(panel).getByText("Payments aren't set up yet.")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Where this item is" })).toBeInTheDocument();
    expect(stages()).toEqual([
      expect.stringMatching(/^Posted, done/),
      "Funding · 83%Now",
      "OrderedNext",
      "DeliveredLater",
    ]);
  });

  it("?donate=1 focuses the amount picker and drops the param", async () => {
    const { router } = renderRoute(harborNeed(ID.diapers4, "?donate=1"));
    const rest = await screen.findByRole("button", { name: "Fund the rest ($14.00)" });
    expect(rest).toHaveFocus();
    expect(router.state.location.search).toBe("");
  });

  it("on a phone, ?donate=1 opens the bottom sheet with the picker focused; Esc closes it", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    renderRoute(harborNeed(ID.diapers4, "?donate=1"));
    const sheet = await screen.findByRole("dialog", { name: "Fund this item" });
    expect(within(sheet).getByRole("button", { name: "Fund the rest ($14.00)" })).toHaveFocus();
    expect(screen.queryByRole("complementary", { name: "Donate" })).not.toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const bar = screen.getByRole("button", { name: "Fund this item" });
    expect(bar.parentElement).toHaveTextContent("$14 left of $84");
    await userEvent.click(bar);
    expect(await screen.findByRole("dialog", { name: "Fund this item" })).toBeInTheDocument();
  });

  it("topping up: Price went up, $ more needed, still donatable", async () => {
    renderRoute(harborNeed(ID.tuna));
    await screen.findByRole("heading", { level: 1, name: "Canned tuna, 5 oz" });
    const panel = screen.getByRole("complementary", { name: "Donate" });
    expect(within(panel).getByText("$5.00 more needed")).toBeInTheDocument();
    expect(screen.getAllByText(/Price went up/).length).toBeGreaterThanOrEqual(2); // badge + timeline note
  });

  it("funded: the status message instead of the panel and a card for the next most urgent need", async () => {
    renderRoute(harborNeed(ID.laundry));
    await screen.findByRole("heading", { level: 1, name: "Laundry detergent" });
    expect(screen.queryByRole("complementary", { name: "Donate" })).not.toBeInTheDocument();
    const box = screen.getByRole("region", { name: "Fully funded, thank you!" });
    expect(box).toHaveTextContent("8 donors raised $95. We're buying it now and will post a photo when it arrives.");
    expect(stages()).toEqual([
      expect.stringMatching(/^Posted, done/),
      expect.stringMatching(/^Funded, done/),
      "OrderedNext",
      "DeliveredLater",
    ]);

    expect(await screen.findByText("Still want to help? This one's most urgent:")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Fund Diapers, size 4/ })).toHaveAttribute(
      "href",
      `/o/harbor-food-bank/n/${ID.diapers4}?donate=1`,
    );
  });

  it("ordered: On its way…", async () => {
    renderRoute(harborNeed(ID.socks));
    expect(await screen.findByRole("region", { name: "On its way…" })).toBeInTheDocument();
  });

  it("delivered: the arrival photo large with the staff message and How it got here", async () => {
    renderRoute(harborNeed(ID.diapers3));
    await screen.findByRole("heading", { level: 1, name: "Diapers, size 3" });
    expect(screen.getByRole("img", { name: "Diapers, size 3 after it arrived at Harbor Food Bank" })).toHaveAttribute(
      "src",
      expect.stringMatching(/\/mock\/arrival\.svg$/),
    );
    const caption = screen.getByText(/were on the shelf by lunch/);
    expect(caption.closest("figcaption")).toHaveTextContent("Harbor Food Bank staff");
    expect(screen.getByText(/^Delivered [A-Z][a-z]{2} \d{1,2}$/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "How it got here" })).toBeInTheDocument();
    expect(stages()).toHaveLength(4);
    for (const stage of stages()) expect(stage).toMatch(/, done/);
    expect(screen.queryByRole("img", { name: /Pampers/ })).not.toBeInTheDocument();
  });

  it("an item covered by other donors' holds shows that, not the picker", async () => {
    mockDb.createOrder({ needId: ID.diapers4, amountCents: 1400, rollOverConsent: true });
    renderRoute(harborNeed(ID.diapers4));
    expect(await screen.findByRole("region", { name: "Donors are paying for the rest right now" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Choose your gift" })).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Fund Infant formula/ })).toBeInTheDocument();
  });

  it("redirects a need opened under the wrong charity to its own address", async () => {
    const { router } = renderRoute(`/o/second-chance-paws/n/${ID.diapers4}?donate=1`);
    await screen.findByRole("heading", { level: 1, name: "Diapers, size 4" });
    await vi.waitFor(() => expect(router.state.location.pathname).toBe(`/o/harbor-food-bank/n/${ID.diapers4}`));
    expect(screen.getByRole("link", { name: "Harbor Food Bank" })).toBeInTheDocument();
  });

  it.each([
    ["an unknown id", "4c1f7a2e-9b3d-4e5f-8a6b-000000000999"],
    ["a malformed id", "not-a-uuid"],
    ["a draft", ID.handSoap],
  ])("shows not found for %s", async (_, id) => {
    renderRoute(harborNeed(id));
    expect(await screen.findByRole("heading", { name: "We couldn't find that item" })).toBeInTheDocument();
    expect(document.title).toBe("Item not found · NeedGrid");
  });

  it("starts a fresh panel when moving to another need", async () => {
    const { router } = renderRoute(harborNeed(ID.diapers4));
    await screen.findByRole("heading", { level: 1, name: "Diapers, size 4" });
    await userEvent.click(screen.getByRole("button", { name: "$10" }));
    await act(async () => {
      await router.navigate(harborNeed(ID.formula));
    });
    await screen.findByRole("heading", { level: 1, name: "Infant formula, 12.4 oz" });
    expect(screen.getByRole("button", { name: "$25", pressed: true })).toBeInTheDocument();
  });
});

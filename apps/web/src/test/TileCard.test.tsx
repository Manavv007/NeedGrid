import type { NeedCard } from "@needgrid/shared";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TileCard } from "@/features/tiles/TileCard";
import { needs } from "@/mocks/fixtures";

// Date text depends on the clock, so it is pinned. Only Date is faked: React and Testing Library
// keep their real timers. Fixture dates were built at module load (before this pin), so tests that
// check date text set the deadline explicitly against NOW.
const NOW = new Date("2026-10-29T12:00:00.000Z"); // a Thursday

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const IDS = {
  diapers4: "4c1f7a2e-9b3d-4e5f-8a6b-000000000101", // open, $14 left of $84
  formula: "4c1f7a2e-9b3d-4e5f-8a6b-000000000102", // open with $15 held
  toothpaste: "4c1f7a2e-9b3d-4e5f-8a6b-000000000106", // open, 1 donor
  peanutButter: "4c1f7a2e-9b3d-4e5f-8a6b-000000000105", // open, no product photo
  tuna: "4c1f7a2e-9b3d-4e5f-8a6b-000000000108", // topping_up, $5 more needed of $76
  laundry: "4c1f7a2e-9b3d-4e5f-8a6b-000000000110", // funded
  socks: "4c1f7a2e-9b3d-4e5f-8a6b-000000000111", // ordered
  diapers3: "4c1f7a2e-9b3d-4e5f-8a6b-000000000112", // delivered
  handSoap: "4c1f7a2e-9b3d-4e5f-8a6b-000000000113", // draft
} as const;

function card(id: string): NeedCard {
  const found = needs.find((n) => n.card.id === id)?.card;
  if (!found) throw new Error(`fixture ${id} missing`);
  return found;
}

function renderTile(need: NeedCard) {
  const utils = render(
    <MemoryRouter>
      <ul>
        <li>
          <TileCard need={need} />
        </li>
      </ul>
    </MemoryRouter>,
  );
  return { ...utils, article: screen.getByRole("article", { name: need.title }) };
}

const needHref = (need: NeedCard) => `/o/harbor-food-bank/n/${need.id}`;

/** No link or button may sit inside another one. */
function expectNoNestedInteractives(root: HTMLElement) {
  for (const el of root.querySelectorAll("a, button")) {
    expect(el.querySelector("a, button")).toBeNull();
  }
}

describe("TileCard", () => {
  it("open: photo, urgency, quantity, $ left, donors, deadline and Fund this item", () => {
    const need = { ...card(IDS.diapers4), deadlineAt: "2026-10-30T21:00:00.000Z" }; // tomorrow, a Friday
    const { article } = renderTile(need);
    const tile = within(article);

    expect(tile.getByRole("heading", { level: 2, name: "Diapers, size 4" })).toBeInTheDocument();
    const img = tile.getByRole("img", { name: "Pampers Cruisers Diapers, Size 4, 150 Count" });
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
    expect(tile.getByText("Urgent")).toBeInTheDocument();
    expect(tile.getByText("2 × pack of 150 · Walmart")).toBeInTheDocument();
    expect(tile.getByText("$14 left")).toBeInTheDocument();
    expect(tile.getByText("of $84")).toBeInTheDocument();
    expect(tile.getByText("6 donors")).toBeInTheDocument();
    expect(tile.getByText("Needed by Fri")).toBeInTheDocument();
    expect(tile.getByRole("progressbar", { name: "Diapers, size 4 funding" })).toHaveAttribute(
      "aria-valuetext",
      "$70 of $84 raised, $14 left",
    );
    expect(tile.queryByText("Price went up")).not.toBeInTheDocument();
  });

  it("links the whole card to the need page and the button to the donate panel", () => {
    const need = card(IDS.diapers4);
    const { article } = renderTile(need);
    const tile = within(article);

    expect(tile.getByRole("link", { name: "Diapers, size 4" })).toHaveAttribute("href", needHref(need));
    expect(tile.getByRole("link", { name: /^Fund this item/ })).toHaveAttribute("href", `${needHref(need)}?donate=1`);
    expect(tile.getAllByRole("link")).toHaveLength(2);
    expect(tile.queryByRole("button")).not.toBeInTheDocument();
    expectNoNestedInteractives(article);
  });

  it("mentions money being paid right now in the progress bar", () => {
    renderTile(card(IDS.formula));
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      "$41 of $112 raised, $15 being paid now, $56 left",
    );
    expect(screen.getByText("$56 left")).toBeInTheDocument();
  });

  it("uses the singular for one donor and a placeholder when there's no photo", () => {
    const first = renderTile(card(IDS.toothpaste));
    expect(screen.getByText("1 donor")).toBeInTheDocument();
    first.unmount();

    renderTile(card(IDS.peanutButter));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("No photo yet")).toBeInTheDocument();
  });

  it("hides the deadline when there is none or it has passed", () => {
    const need = card(IDS.diapers4);
    const past = renderTile({ ...need, deadlineAt: "2026-10-28T12:00:00.000Z" });
    expect(screen.queryByText(/Needed by/)).not.toBeInTheDocument();
    past.unmount();

    const none = renderTile({ ...need, deadlineAt: null });
    expect(screen.queryByText(/Needed by/)).not.toBeInTheDocument();
    none.unmount();

    renderTile({ ...need, deadlineAt: "2026-11-14T21:00:00.000Z" });
    expect(screen.getByText("Needed by Nov 14")).toBeInTheDocument();
  });

  it("topping_up: Price went up, $ more needed, Help finish it", () => {
    const need = card(IDS.tuna);
    const { article } = renderTile(need);
    const tile = within(article);

    expect(tile.getByText("Price went up")).toBeInTheDocument();
    expect(tile.getByText("Soon")).toBeInTheDocument();
    expect(tile.getByText("$5 more needed")).toBeInTheDocument();
    expect(tile.getByText("of $76")).toBeInTheDocument();
    expect(tile.getByRole("link", { name: /^Help finish it/ })).toHaveAttribute("href", `${needHref(need)}?donate=1`);
    expect(tile.queryByRole("link", { name: /Fund this item/ })).not.toBeInTheDocument();
    expectNoNestedInteractives(article);
  });

  it("funded: green full bar, raised + donors, buying it now, no fund button", () => {
    const { article } = renderTile(card(IDS.laundry));
    const tile = within(article);

    expect(tile.getByText("Funded")).toBeInTheDocument();
    expect(tile.getByText("$95 raised · 8 donors")).toBeInTheDocument();
    expect(tile.getByText("Fully funded. We're buying it now.")).toBeInTheDocument();
    expect(tile.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "$95 of $95 raised, fully funded");
    expect(tile.getAllByRole("link")).toHaveLength(1);
    expect(tile.queryByText("When possible")).not.toBeInTheDocument();
  });

  it("ordered: Ordered badge, on its way, no fund button", () => {
    const { article } = renderTile(card(IDS.socks));
    const tile = within(article);

    expect(tile.getByText("Ordered")).toBeInTheDocument();
    expect(tile.getByText("$56 raised · 3 donors")).toBeInTheDocument();
    expect(tile.getByText("On its way. Photo coming when it lands.")).toBeInTheDocument();
    expect(tile.getAllByRole("link")).toHaveLength(1);
  });

  it("delivered: Delivered badge and a See the photo link to the need page", () => {
    const need = card(IDS.diapers3);
    const { article } = renderTile(need);
    const tile = within(article);

    expect(tile.getByText("Delivered")).toBeInTheDocument();
    expect(tile.getByText("Delivered · photo on the item page")).toBeInTheDocument();
    expect(tile.getByRole("link", { name: /^See the photo/ })).toHaveAttribute("href", needHref(need));
    expect(tile.getByRole("img", { name: need.product?.title ?? "" })).toBeInTheDocument();
    expect(tile.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(tile.queryByRole("link", { name: /Fund|Help finish/ })).not.toBeInTheDocument();
    expectNoNestedInteractives(article);
  });

  it("renders nothing for drafts and closed needs", () => {
    const { container } = render(
      <MemoryRouter>
        <TileCard need={card(IDS.handSoap)} />
        <TileCard need={{ ...card(IDS.diapers4), status: "closed" }} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

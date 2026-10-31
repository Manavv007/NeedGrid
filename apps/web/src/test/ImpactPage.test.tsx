import {
  ImpactRes,
  NeedDetailRes,
  type AllocationReason,
  type DeliveryPublic,
  type ImpactItem,
} from "@needgrid/shared";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { itemName, reasonLabel, sortImpactItems } from "@/features/impact/impactItems";
import { MOCK_UPLOAD_URL } from "@/lib/cloudinary";
import { DEMO_IMPACT_TOKEN, ORG_IDS } from "@/mocks/fixtures";
import { mockDb } from "@/mocks/mockDb";
import { server } from "@/mocks/node";
import { IMPACT_REFRESH_MS } from "@/pages/ImpactPage";
import { renderRoute } from "./render";

const API = "http://api.test";
const IMPACT_ROUTE = `${API}/api/impact/:token`;
const IMPACT = `/impact/${DEMO_IMPACT_TOKEN}`;
const ID = {
  diapers4: "4c1f7a2e-9b3d-4e5f-8a6b-000000000101", // open
  tuna: "4c1f7a2e-9b3d-4e5f-8a6b-000000000108", // topping_up
  toothbrushes: "4c1f7a2e-9b3d-4e5f-8a6b-000000000109", // funded
  laundry: "4c1f7a2e-9b3d-4e5f-8a6b-000000000110", // funded
  socks: "4c1f7a2e-9b3d-4e5f-8a6b-000000000111", // ordered
  diapers3: "4c1f7a2e-9b3d-4e5f-8a6b-000000000112", // delivered 2 days ago
  catCarriers: "4c1f7a2e-9b3d-4e5f-8a6b-000000000210", // Paws, delivered 6 days ago
} as const;

afterEach(() => {
  vi.useRealTimers();
});

/** One impact item for a fixture need, as the server would build it, with this gift's amount and reason. */
function itemOf(id: string, reason: AllocationReason, amountCents: number): ImpactItem {
  const detail = NeedDetailRes.parse(mockDb.getNeedDetail(id));
  return {
    need: detail.need,
    orgName: detail.org.name,
    amountCents,
    reason,
    timeline: detail.timeline,
    delivery: detail.delivery,
  };
}

/** Answer every impact request with `impact` (parsed, like a real response). */
function serveImpact(impact: ImpactRes) {
  server.use(http.get(IMPACT_ROUTE, () => HttpResponse.json(ImpactRes.parse(impact))));
}

const headings = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
const card = (title: string) => screen.getByRole("article", { name: title });
/** A StatusBadge (the timeline's stage labels use the same words, but aren't pills). */
const badge = (container: HTMLElement, label: string) =>
  within(container).getByText(label, { selector: "span.rounded-full" });

describe("Impact page /impact/:token", () => {
  it("greets the donor by name: their delivered photo first, then what's still on its way", async () => {
    renderRoute(IMPACT);
    expect(screen.getByText("Loading your impact…")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 1, name: "Hi Sam, your diapers arrived." })).toBeInTheDocument();
    expect(document.title).toBe("Your impact · NeedGrid");
    expect(screen.getByText("Your impact")).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "You've given $39.00 across 2 items."),
    ).toBeInTheDocument();

    const articles = within(screen.getByRole("list", { name: "What your gift paid for" })).getAllByRole("article");
    expect(articles.map((a) => within(a).getByRole("heading", { level: 2 }).textContent)).toEqual([
      "Diapers, size 3",
      "Women's socks",
    ]);

    const delivered = card("Diapers, size 3");
    const photo = within(delivered).getByRole("img", { name: "Diapers, size 3 after it arrived at Harbor Food Bank" });
    expect(photo).toHaveAttribute("src", expect.stringMatching(/\/mock\/arrival\.svg$/));
    expect(badge(delivered, "Delivered")).toBeInTheDocument();
    expect(within(delivered).getByRole("heading", { level: 3, name: "Your diapers arrived!" })).toBeInTheDocument();
    const deliveredAt = mockDb.getImpact(DEMO_IMPACT_TOKEN)?.items[0]?.delivery?.deliveredAt;
    expect(within(delivered).getByText("Arrived", { selector: "p" }).querySelector("time")).toHaveAttribute(
      "datetime",
      deliveredAt,
    );
    expect(within(delivered).getByText(/were on the shelf by lunch/)).toBeInTheDocument();
    expect(within(delivered).getByText("Harbor Food Bank")).toBeInTheDocument();
    expect(within(delivered).getByText("$14.00")).toBeInTheDocument();
    expect(within(delivered).getByRole("list", { name: "Progress of Diapers, size 3" })).toBeInTheDocument();
    expect(within(delivered).queryByText("We'll post a photo here when it arrives.")).not.toBeInTheDocument();

    const pending = card("Women's socks");
    expect(within(pending).getByText("We'll post a photo here when it arrives.")).toBeInTheDocument();
    expect(within(pending).getByText("Harbor Food Bank · sent to the next most urgent need")).toBeInTheDocument();
    expect(badge(pending, "Ordered")).toBeInTheDocument();
    expect(within(pending).getByText("$25.00")).toBeInTheDocument();
    expect(
      within(pending).getByRole("img", { name: "Hanes Women's Cushioned Crew Socks, 12 Pack" }),
    ).toBeInTheDocument();
    expect(within(pending).getByRole("list", { name: "Progress of Women's socks" })).toBeInTheDocument();
  });

  it("keeps the impact link, links to the charity's wall, and says it isn't a tax receipt", async () => {
    renderRoute(IMPACT);
    await screen.findByRole("heading", { level: 1 });
    const box = screen.getByRole("region", { name: "Save your impact link" });
    expect(within(box).getByRole("textbox", { name: "Your impact link" })).toHaveValue(
      `${window.location.origin}/impact/${DEMO_IMPACT_TOKEN}`,
    );
    expect(box).toHaveTextContent("No account needed. This link is the only way back here, so keep it.");
    expect(screen.getByRole("link", { name: "Fund another item" })).toHaveAttribute("href", "/o/harbor-food-bank");
    expect(screen.getByText(/^This page is not a tax receipt\./)).toBeInTheDocument();
  });

  it("is kept out of search engines while it's open", async () => {
    const { unmount } = renderRoute(IMPACT);
    await screen.findByRole("heading", { level: 1 });
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    unmount();
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it("without a first name: 'Thanks for giving.' until something arrives", async () => {
    const order = mockDb.createOrder({ needId: ID.diapers4, amountCents: 1000, rollOverConsent: true });
    const captured = order.kind === "ok" ? mockDb.capture(order.order.orderId) : null;
    if (captured?.kind !== "ok") throw new Error("expected a capture");
    renderRoute(`/impact/${captured.capture.impactToken}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Thanks for giving." })).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "You've given $10.00 across 1 item."),
    ).toBeInTheDocument();
    expect(badge(card("Diapers, size 4"), "Open")).toBeInTheDocument();
    expect(within(card("Diapers, size 4")).getByText("Harbor Food Bank")).toBeInTheDocument();
  });

  it("orders arrivals first (newest photo first), then by progress, and labels where the money went", async () => {
    const items = [
      itemOf(ID.diapers4, "direct", 500),
      itemOf(ID.tuna, "rollover", 300),
      itemOf(ID.catCarriers, "sponsor", 700),
      itemOf(ID.socks, "overflow", 400),
      itemOf(ID.laundry, "price_drop", 200),
      itemOf(ID.toothbrushes, "refund", 100),
      itemOf(ID.diapers3, "direct", 600),
    ];
    serveImpact({ donorFirstName: null, totalCents: 2800, donatedAt: new Date().toISOString(), items });
    renderRoute("/impact/a-crafted-token-123");
    expect(await screen.findByRole("heading", { level: 1, name: "Your diapers arrived." })).toBeInTheDocument();
    expect(headings().filter((text) => text !== "Save your impact link")).toEqual([
      "Diapers, size 3",
      "Cat carriers",
      "Women's socks",
      "Laundry detergent",
      "Kids' toothbrushes",
      "Canned tuna, 5 oz",
      "Diapers, size 4",
    ]);
    expect(within(card("Cat carriers")).getByText("Second Chance Paws · sponsor gift")).toBeInTheDocument();
    expect(
      within(card("Canned tuna, 5 oz")).getByText("Harbor Food Bank · sent to the next most urgent need"),
    ).toBeInTheDocument();
    expect(
      within(card("Laundry detergent")).getByText("Harbor Food Bank · sent to the next most urgent need"),
    ).toBeInTheDocument();
    expect(within(card("Diapers, size 4")).getByText("Harbor Food Bank")).toBeInTheDocument();
    const refunded = card("Kids' toothbrushes");
    expect(within(refunded).getByText("Harbor Food Bank · refunded")).toBeInTheDocument();
    expect(within(refunded).getByText("−$1.00")).toBeInTheDocument();
  });

  it("refetches every 60 s while open, and a new arrival shows its photo and is announced", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    server.use(
      http.get(IMPACT_ROUTE, () => {
        calls += 1;
      }),
    );
    renderRoute(IMPACT);
    await screen.findByRole("heading", { level: 1, name: "Hi Sam, your diapers arrived." });
    expect(calls).toBe(1);

    // Meanwhile the charity records the socks' delivery.
    expect(mockDb.recordDelivery(ORG_IDS.harbor, ID.socks, { photoUrl: MOCK_UPLOAD_URL, staffNote: "" }).kind).toBe(
      "ok",
    );
    await act(() => vi.advanceTimersByTimeAsync(IMPACT_REFRESH_MS - 1_000));
    expect(calls).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    await waitFor(() => expect(calls).toBe(2));

    const socks = await screen.findByRole("img", { name: "Women's socks after it arrived at Harbor Food Bank" });
    expect(socks).toHaveAttribute("src", MOCK_UPLOAD_URL);
    // Newest arrival first, and the headline follows it.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hi Sam, your women's socks arrived.");
    expect(screen.getByText("Women's socks arrived. The photo is on this page.")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("not found for a bad token, and it stops asking", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    server.use(
      http.get(IMPACT_ROUTE, () => {
        calls += 1;
      }),
    );
    renderRoute("/impact/not-a-real-token-123");
    expect(await screen.findByRole("heading", { name: "We couldn't find that gift" })).toBeInTheDocument();
    expect(document.title).toBe("Gift not found · NeedGrid");
    await act(() => vi.advanceTimersByTimeAsync(IMPACT_REFRESH_MS * 2));
    expect(calls).toBe(1);
  });

  it("shows an error with Try again when the page can't load", async () => {
    let fail = true;
    server.use(
      http.get(IMPACT_ROUTE, () =>
        fail ? HttpResponse.json({ error: { code: "INTERNAL", message: "boom" } }, { status: 500 }) : undefined,
      ),
    );
    renderRoute(IMPACT);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We couldn't load this");
    fail = false;
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Hi Sam, your diapers arrived." })).toBeInTheDocument();
  });

  it("explains a gift with no items: refunded, or not needed and waiting for a refund", async () => {
    serveImpact({ donorFirstName: "Ana", totalCents: 0, donatedAt: new Date().toISOString(), items: [] });
    const first = renderRoute("/impact/a-refunded-token-123");
    expect(await screen.findByRole("heading", { name: "This gift was refunded" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hi Ana, thanks for giving.");
    first.unmount();

    serveImpact({ donorFirstName: null, totalCents: 1400, donatedAt: new Date().toISOString(), items: [] });
    renderRoute("/impact/an-unassigned-token-12");
    expect(await screen.findByText(/^The item was already covered when your payment went through/)).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "You've given $14.00."),
    ).toBeInTheDocument();
  });
});

describe("impact page words and order", () => {
  it("names an item inside a sentence", () => {
    expect(itemName("Diapers, size 3")).toBe("diapers");
    expect(itemName("Women's socks")).toBe("women's socks");
    expect(itemName("AA batteries, 24 pack")).toBe("AA batteries");
    expect(itemName("24 cans of tuna")).toBe("24 cans of tuna");
  });

  it("labels every allocation reason", () => {
    expect(reasonLabel("direct")).toBeNull();
    for (const reason of ["overflow", "rollover", "price_drop"] as const) {
      expect(reasonLabel(reason)).toBe("sent to the next most urgent need");
    }
    expect(reasonLabel("sponsor")).toBe("sponsor gift");
    expect(reasonLabel("refund")).toBe("refunded");
  });

  it("puts a delivered item without a photo after the ones with photos", () => {
    const withPhoto = itemOf(ID.diapers3, "direct", 100);
    const noPhoto: ImpactItem = { ...itemOf(ID.catCarriers, "direct", 100), delivery: null };
    const ordered = itemOf(ID.socks, "direct", 100);
    const newer: DeliveryPublic = { photoUrl: MOCK_UPLOAD_URL, message: null, deliveredAt: new Date().toISOString() };
    const newest = { ...itemOf(ID.diapers3, "overflow", 100), delivery: newer };
    expect(sortImpactItems([ordered, noPhoto, withPhoto, newest])).toEqual([newest, withPhoto, noPhoto, ordered]);
  });
});

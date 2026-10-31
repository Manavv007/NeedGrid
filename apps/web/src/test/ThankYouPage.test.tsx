import { HOLD_MINUTES } from "@needgrid/shared";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_IMPACT_TOKEN } from "@/mocks/fixtures";
import { mockDb } from "@/mocks/mockDb";
import { renderRoute } from "./render";

const THANKS = `/thanks/${DEMO_IMPACT_TOKEN}`;
const DIAPERS = "4c1f7a2e-9b3d-4e5f-8a6b-000000000101";

afterEach(() => {
  vi.useRealTimers();
});

describe("Thank-you page /thanks/:token", () => {
  it("shows the total and one row per item, with overflow labelled and explained", async () => {
    renderRoute(THANKS);
    expect(screen.getByText("Loading your gift…")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 1, name: "Thank you!" })).toBeInTheDocument();
    expect(document.title).toBe("Thank you · NeedGrid");
    expect(screen.getByText("Your $39.00 gift went through. Here's exactly what it paid for.")).toBeInTheDocument();

    const rows = within(screen.getByRole("region", { name: "Where your money went" })).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Diapers, size 3Harbor Food Bank · fully funded now$14.00",
      "Women's socksHarbor Food Bank · sent to the next most urgent need$25.00",
    ]);
    expect(
      screen.getByText(
        "“Diapers, size 3” only needed $14.00, so the rest went to the next most urgent item, as you agreed at checkout.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("This page is not a tax receipt. PayPal sandbox demo.")).toBeInTheDocument();
  });

  it("links to the impact page and back to the charity's tile wall", async () => {
    renderRoute(THANKS);
    await screen.findByRole("heading", { level: 1, name: "Thank you!" });
    expect(screen.getByRole("link", { name: "Open my impact page" })).toHaveAttribute(
      "href",
      `/impact/${DEMO_IMPACT_TOKEN}`,
    );
    expect(screen.getByRole("link", { name: "Fund another item" })).toHaveAttribute("href", "/o/harbor-food-bank");
  });

  it("copies the impact link", async () => {
    const user = userEvent.setup();
    renderRoute(THANKS);
    await screen.findByRole("heading", { level: 1, name: "Thank you!" });
    const url = `${window.location.origin}/impact/${DEMO_IMPACT_TOKEN}`;
    const box = screen.getByRole("region", { name: "Save your impact link" });
    expect(within(box).getByRole("textbox", { name: "Your impact link" })).toHaveValue(url);
    expect(box).toHaveTextContent("It's the only way back to see your items arrive. No account, no emails.");

    await user.click(within(box).getByRole("button", { name: "Copy" }));
    await expect(navigator.clipboard.readText()).resolves.toBe(url);
    expect(await screen.findByText("Impact link copied")).toBeInTheDocument();
  });

  it("shows no clamped notice without router state", async () => {
    renderRoute(THANKS);
    await screen.findByRole("heading", { level: 1, name: "Thank you!" });
    expect(screen.queryByText(/was left, so your gift was/)).not.toBeInTheDocument();
  });

  it("is kept out of search engines while it's open (same private token as the impact page)", async () => {
    const { unmount } = renderRoute(THANKS);
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    await screen.findByRole("heading", { level: 1, name: "Thank you!" });
    expect(document.head.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    unmount();
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it("keeps the noindex on the not-found state too", async () => {
    renderRoute("/thanks/not-a-real-token-123");
    await screen.findByRole("heading", { name: "We couldn't find that gift" });
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  });

  it("explains a part that stays unassigned when the donor didn't agree to send it on", async () => {
    // Donor A (no consent) pays after their hold expired and donor B held $5 of the $14.
    vi.useFakeTimers({ toFake: ["Date"] });
    const a = mockDb.createOrder({ needId: DIAPERS, amountCents: 1400, rollOverConsent: false });
    vi.setSystemTime(Date.now() + (HOLD_MINUTES + 1) * 60_000);
    mockDb.createOrder({ needId: DIAPERS, amountCents: 500, rollOverConsent: true });
    const captured = a.kind === "ok" ? mockDb.capture(a.order.orderId) : null;
    vi.useRealTimers();
    if (captured?.kind !== "ok") throw new Error("capture failed");

    renderRoute(`/thanks/${captured.capture.impactToken}`);
    await screen.findByText("Your $14.00 gift went through. Here's exactly what it paid for.");
    expect(
      within(screen.getByRole("region", { name: "Where your money went" })).getByText("$9.00"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Part of your gift wasn't needed, and you asked us not to send it to another need, so the charity will refund it.",
      ),
    ).toBeInTheDocument();
  });

  it("shows not found for a bad token", async () => {
    renderRoute("/thanks/not-a-real-token-123");
    expect(await screen.findByRole("heading", { name: "We couldn't find that gift" })).toBeInTheDocument();
    expect(document.title).toBe("Gift not found · NeedGrid");
  });
});

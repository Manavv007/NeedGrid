import { STAFF_KEY_STORAGE } from "@needgrid/shared";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOCK_UPLOAD_URL } from "@/lib/cloudinary";
import { mockDb } from "@/mocks/mockDb";
import { renderRoute } from "./render";

const DIAPERS = "4c1f7a2e-9b3d-4e5f-8a6b-000000000101"; // Harbor, open, $14 left of $84

afterEach(() => {
  vi.unstubAllEnvs();
  expect(mockDb.moneyProblems()).toEqual([]);
});

describe("The whole loop in mock mode", () => {
  // Four screens in one test, so it gets more than the default per-test time (last argument).
  it("donate → thank-you → plan, approve, order → delivery photo → the donor's impact page shows it", async () => {
    vi.stubEnv("VITE_USE_MOCKS", "true");
    const user = userEvent.setup();
    const { router } = renderRoute(`/o/harbor-food-bank/n/${DIAPERS}`);

    // C-3: a donor funds the rest with the mock PayPal button. The first full render in a file is the
    // slowest (cold imports), so it gets more time on a busy machine.
    await user.click(await screen.findByRole("button", { name: /^Mock PayPal/ }, { timeout: 10_000 }));
    await screen.findByRole("heading", { level: 1, name: "Thank you!" });
    const token = router.state.location.pathname.replace("/thanks/", "");

    // C-7: staff check the price, approve (a cheaper price: $4 moves on), buy it and mark it ordered.
    sessionStorage.setItem(STAFF_KEY_STORAGE, "harbor-demo-2026");
    await act(() => router.navigate(`/staff/needs/${DIAPERS}`));
    await user.click(await screen.findByRole("button", { name: "Check price & plan purchase" }));
    await user.click(await screen.findByRole("button", { name: "Approve purchase" }));
    expect(await screen.findByText("Approved. $4.00 moved to Infant formula, 12.4 oz.")).toBeInTheDocument();
    await screen.findByRole("link", { name: /Buy it at/ });
    await user.type(screen.getByLabelText("Retailer order number"), "WM-2000-1");
    await user.click(screen.getByRole("button", { name: "Mark as ordered" }));

    // C-8: the arrival photo passes the check, so the need is delivered at once.
    const panel = await screen.findByRole("region", { name: /Record the delivery/ });
    await user.upload(
      within(panel).getByLabelText(/Arrival photo/),
      new File(["jpeg"], "a.jpg", { type: "image/jpeg" }),
    );
    await screen.findByText("Photo uploaded", {}, { timeout: 5_000 });
    await user.type(screen.getByLabelText("Note for donors (optional)"), "On the shelf by lunch");
    await user.click(screen.getByRole("button", { name: "Check delivery" }));
    await screen.findByRole("region", { name: /Delivered, donors have been updated/ });

    // The donor's impact link: the photo, the message, and what their money did after the price drop.
    await act(() => router.navigate(`/impact/${token}`));
    expect(await screen.findByRole("heading", { level: 1, name: "Your diapers arrived." })).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "You've given $14.00 across 2 items."),
    ).toBeInTheDocument();
    const diapers = screen.getByRole("article", { name: "Diapers, size 4" });
    expect(
      within(diapers).getByRole("img", { name: "Diapers, size 4 after it arrived at Harbor Food Bank" }),
    ).toHaveAttribute("src", MOCK_UPLOAD_URL);
    expect(within(diapers).getByRole("heading", { name: "Your diapers arrived!" })).toBeInTheDocument();
    expect(within(diapers).getByText(/On the shelf by lunch\. Thank you for helping us get it\./)).toBeInTheDocument();
    expect(within(diapers).getByText("$10.00")).toBeInTheDocument();
    const formula = screen.getByRole("article", { name: "Infant formula, 12.4 oz" });
    expect(within(formula).getByText("Harbor Food Bank · sent to the next most urgent need")).toBeInTheDocument();
    expect(within(formula).getByText("$4.00")).toBeInTheDocument();
    expect(within(formula).getByText("We'll post a photo here when it arrives.")).toBeInTheDocument();
  }, 60_000);
});

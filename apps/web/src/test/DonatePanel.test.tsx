import { paths } from "@needgrid/shared";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDb } from "@/mocks/mockDb";
import { server } from "@/mocks/node";
import { renderRoute } from "./render";

const API = "http://api.test";
const DIAPERS = "4c1f7a2e-9b3d-4e5f-8a6b-000000000101"; // $14 left of $84
const FORMULA = "4c1f7a2e-9b3d-4e5f-8a6b-000000000102"; // next most urgent: $56 left of $112
const NEED_URL = `/o/harbor-food-bank/n/${DIAPERS}`;
const CREATE_ROUTE = `${API}${paths.createOrder}`;
/** MSW pattern (paths.captureOrder would URL-encode the ":"). */
const CAPTURE_ROUTE = `${API}/api/donations/orders/:orderId/capture`;

// The mock button only exists in mock mode (checkoutKind reads import.meta.env at render time).
beforeEach(() => {
  vi.stubEnv("VITE_USE_MOCKS", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/** Counts POSTs to `route` and lets the normal mock handler answer them. */
function countPosts(route: string) {
  const counter = { calls: 0 };
  server.use(
    http.post(route, () => {
      counter.calls += 1;
    }),
  );
  return counter;
}

/** Text spread over several elements (e.g. with <strong>), matched on one element's full text. */
const fullText = (text: string) => (_: string, el: Element | null) =>
  el !== null && el.textContent === text && Array.from(el.children).every((child) => child.textContent !== text);

async function openPanel(url = NEED_URL) {
  const utils = renderRoute(url);
  const pay = await screen.findByRole("button", { name: /^Mock PayPal/ });
  return { ...utils, pay };
}

const thankYouHeading = () => screen.findByRole("heading", { level: 1, name: "Thank you!" });

describe("DonatePanel with the mock PayPal button", () => {
  it("pays the rest, lands on /thanks/<token> with the server's split, and the tile wall moves", async () => {
    const { router, pay } = await openPanel();
    expect(pay).toHaveTextContent("Mock PayPal · give $14.00");
    expect(screen.getByRole("checkbox", { name: /send my gift to the charity's next most urgent need/ })).toBeChecked();

    await userEvent.click(pay);
    await thankYouHeading();
    expect(router.state.location.pathname).toMatch(/^\/thanks\/[A-Za-z0-9_-]{16,64}$/);
    expect(screen.getByText("Your $14.00 gift went through. Here's exactly what it paid for.")).toBeInTheDocument();
    const split = screen.getByRole("region", { name: "Where your money went" });
    expect(within(split).getByText("Diapers, size 4")).toBeInTheDocument();
    expect(within(split).getByText("Harbor Food Bank · fully funded now")).toBeInTheDocument();
    expect(within(split).getByText("$14.00")).toBeInTheDocument();
    expect(await screen.findByText("Thank you! Your gift went through.")).toBeInTheDocument(); // toast

    await act(async () => {
      await router.navigate("/o/harbor-food-bank?tab=funded");
    });
    const tile = await screen.findByRole("article", { name: "Diapers, size 4" });
    expect(within(tile).getByText("$84 raised · 7 donors")).toBeInTheDocument();
  });

  it("sends the requested amount and rollOverConsent, and only that", async () => {
    let body: unknown = null;
    server.use(
      http.post(CREATE_ROUTE, async ({ request }) => {
        body = await request.clone().json();
      }),
    );
    const { pay } = await openPanel();
    await userEvent.click(screen.getByRole("button", { name: "$10" }));
    await userEvent.click(screen.getByRole("checkbox", { name: /next most urgent need/ }));
    await userEvent.click(pay);
    await thankYouHeading();
    expect(body).toEqual({ needId: DIAPERS, amountCents: 1000, rollOverConsent: false });
  });

  it("shows the server's clamped amount while confirming and again on the thank-you page", async () => {
    const { pay } = await openPanel();
    // Another donor starts paying $10 a moment before this donor's order reaches the server (too late
    // for the live update to reach the panel): only $4 is left on the server.
    server.use(
      http.post(
        CREATE_ROUTE,
        () => {
          mockDb.createOrder({ needId: DIAPERS, amountCents: 1000, rollOverConsent: true });
        },
        { once: true },
      ),
    );
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(CAPTURE_ROUTE, async () => {
        await gate;
      }),
    );

    await userEvent.click(pay);
    const confirming = await screen.findByRole("heading", { name: "Confirming your gift…" });
    expect(confirming.parentElement).toHaveTextContent("Only $4.00 was left, so your gift is $4.00.");
    release();

    await thankYouHeading();
    expect(screen.getByText(fullText("Only $4.00 was left, so your gift was $4.00."))).toBeInTheDocument();
    expect(screen.getByText("Your $4.00 gift went through. Here's exactly what it paid for.")).toBeInTheDocument();
  });

  it("FULLY_FUNDED: nothing charged, and the next most urgent need with its own Fund link", async () => {
    const creates = countPosts(CREATE_ROUTE);
    const captures = countPosts(CAPTURE_ROUTE);
    const { pay } = await openPanel();
    mockDb.armScenario("fullyFunded");

    await userEvent.click(pay);
    const heading = await screen.findByRole("heading", { name: "This item was just fully funded!" });
    expect(heading).toHaveFocus();
    expect(screen.getByText("Someone beat you to it. Nothing was charged.")).toBeInTheDocument();
    const next = screen.getByRole("article", { name: "Infant formula, 12.4 oz" });
    expect(within(next).getByText("$56 left")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fund Infant formula, 12.4 oz" })).toHaveAttribute(
      "href",
      `/o/harbor-food-bank/n/${FORMULA}?donate=1`,
    );
    expect(screen.getByRole("link", { name: "See everything still needed" })).toHaveAttribute(
      "href",
      "/o/harbor-food-bank",
    );
    expect(creates.calls).toBe(1);
    expect(captures.calls).toBe(0);
  });

  it("captures exactly once even on a double click", async () => {
    const creates = countPosts(CREATE_ROUTE);
    const captures = countPosts(CAPTURE_ROUTE);
    const { pay } = await openPanel();
    await userEvent.dblClick(pay);
    await thankYouHeading();
    expect(creates.calls).toBe(1);
    expect(captures.calls).toBe(1);
  });

  it("retries a capture once after a network error", async () => {
    let calls = 0;
    server.use(
      http.post(CAPTURE_ROUTE, () => {
        calls += 1;
        if (calls === 1) return HttpResponse.error();
      }),
    );
    const { pay } = await openPanel();
    await userEvent.click(pay);
    expect(await screen.findByRole("heading", { level: 1, name: "Thank you!" }, { timeout: 4000 })).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it("after two network errors, Try again confirms the same order (no new order)", async () => {
    const creates = countPosts(CREATE_ROUTE);
    let captures = 0;
    server.use(
      http.post(CAPTURE_ROUTE, () => {
        captures += 1;
        if (captures <= 2) return HttpResponse.error();
      }),
    );
    const { pay } = await openPanel();
    await userEvent.click(pay);
    const alert = await screen.findByRole("alert", {}, { timeout: 4000 });
    expect(alert).toHaveTextContent("We couldn't confirm your gift yet.");
    expect(screen.getByRole("button", { name: /^Mock PayPal/ })).toBeDisabled();

    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await thankYouHeading();
    expect(captures).toBe(3);
    expect(creates.calls).toBe(1);
  });

  it("declined card: PayPal-style restart, then the same order goes through", async () => {
    const creates = countPosts(CREATE_ROUTE);
    const captures = countPosts(CAPTURE_ROUTE);
    const { pay } = await openPanel();
    mockDb.armScenario("declined");

    await userEvent.click(pay);
    expect(
      await screen.findByText("Your card was declined. Choose another payment method in PayPal."),
    ).toBeInTheDocument();
    await thankYouHeading();
    expect(creates.calls).toBe(1);
    expect(captures.calls).toBe(2);
  });

  it("declined card without a restart (confirming again after an error): says so and starts over", async () => {
    let captures = 0;
    server.use(
      http.post(CAPTURE_ROUTE, () => {
        captures += 1;
        if (captures <= 2) return HttpResponse.error();
      }),
    );
    const { pay } = await openPanel();
    await userEvent.click(pay);
    const confirmFailed = await screen.findByRole("alert", {}, { timeout: 4000 });

    mockDb.armScenario("declined");
    await userEvent.click(within(confirmFailed).getByRole("button", { name: "Try again" }));
    const declined = await screen.findByRole("alert");
    await vi.waitFor(() => expect(declined).toHaveTextContent("Your card was declined, try another payment method."));

    await userEvent.click(within(declined).getByRole("button", { name: "Try again" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("cancel: toast that the hold is released in 15 minutes", async () => {
    const captures = countPosts(CAPTURE_ROUTE);
    const { pay } = await openPanel();
    mockDb.armScenario("cancel");
    await userEvent.click(pay);
    expect(await screen.findByText("Payment cancelled. Your hold is released in 15 minutes.")).toBeInTheDocument();
    expect(captures.calls).toBe(0);
  });

  it("keeps the pay button disabled while the Other amount is invalid", async () => {
    await openPanel();
    await userEvent.click(screen.getByRole("button", { name: "Other amount" }));
    const pay = screen.getByRole("button", { name: /^Mock PayPal/ });
    expect(pay).toBeDisabled();
    expect(pay).toHaveTextContent(/^Mock PayPal$/);
    await userEvent.type(screen.getByLabelText("Amount in dollars"), "7.5");
    expect(pay).toBeEnabled();
    expect(pay).toHaveTextContent("Mock PayPal · give $7.50");
  });
});

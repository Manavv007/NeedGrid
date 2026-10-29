/**
 * The real-PayPal path of the donate panel, with the SDK wrapper replaced by a fake that calls the
 * same props PayPal's buttons would: createOrder, onApprove(data, actions), onCancel, onError.
 */
import { paths } from "@needgrid/shared";
import type { PayPalButtonsComponentProps } from "@paypal/react-paypal-js";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as CheckoutModule from "@/features/donate/checkout";
import { mockDb } from "@/mocks/mockDb";
import { server } from "@/mocks/node";
import { renderRoute } from "./render";

const API = "http://api.test";
const DIAPERS = "4c1f7a2e-9b3d-4e5f-8a6b-000000000101";
const NEED_URL = `/o/harbor-food-bank/n/${DIAPERS}`;
const CAPTURE_ROUTE = `${API}/api/donations/orders/:orderId/capture`;

const sdk = vi.hoisted(() => ({
  options: null as Record<string, unknown> | null,
  props: null as PayPalButtonsComponentProps | null,
  restart: vi.fn(),
}));

vi.mock("@paypal/react-paypal-js", () => ({
  PayPalScriptProvider: ({ options, children }: { options: Record<string, unknown>; children: ReactNode }) => {
    sdk.options = options;
    return children;
  },
  usePayPalScriptReducer: () => [{ isInitial: false, isPending: false, isRejected: false, isResolved: true }],
  PayPalButtons: (props: PayPalButtonsComponentProps) => {
    sdk.props = props;
    return <div data-testid="paypal-buttons" data-disabled={String(props.disabled)} />;
  },
}));

vi.mock("@/features/donate/checkout", async (importOriginal) => ({
  ...(await importOriginal<typeof CheckoutModule>()),
  checkoutKind: () => ({ kind: "paypal", clientId: "sandbox-client-id" }),
}));

function buttons(): PayPalButtonsComponentProps {
  if (!sdk.props) throw new Error("PayPalButtons not rendered");
  return sdk.props;
}

beforeEach(() => {
  sdk.props = null;
  sdk.options = null;
  sdk.restart.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** What PayPal does on click: call createOrder, then (after the donor approves) onApprove. */
async function createOrder(): Promise<string> {
  const create = buttons().createOrder;
  if (!create) throw new Error("no createOrder");
  let orderId = "";
  await act(async () => {
    orderId = await create({ paymentSource: "paypal" }, { order: { create: () => Promise.resolve("") } });
  });
  return orderId;
}

async function approve(orderId: string): Promise<void> {
  const onApprove = buttons().onApprove;
  if (!onApprove) throw new Error("no onApprove");
  await act(async () => {
    await onApprove({ orderID: orderId }, { restart: sdk.restart, redirect: () => undefined });
  });
}

async function renderPanel() {
  const utils = renderRoute(NEED_URL);
  await screen.findByTestId("paypal-buttons");
  return utils;
}

describe("PayPalCheckout (@paypal/react-paypal-js root API)", () => {
  it("loads the SDK with the client id, USD and intent capture", async () => {
    await renderPanel();
    expect(sdk.options).toEqual({
      clientId: "sandbox-client-id",
      currency: "USD",
      intent: "capture",
      components: "buttons",
    });
    expect(buttons().forceReRender).toEqual(["1400:true"]);
  });

  it("redraws the buttons when the amount or consent changes", async () => {
    await renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "$10" }));
    expect(buttons().forceReRender).toEqual(["1000:true"]);
    await userEvent.click(screen.getByRole("checkbox", { name: /next most urgent need/ }));
    expect(buttons().forceReRender).toEqual(["1000:false"]);
  });

  it("createOrder returns our server's order id; onApprove captures and opens the thank-you page", async () => {
    const { router } = await renderPanel();
    const orderId = await createOrder();
    expect(orderId).toMatch(/^[A-Z0-9]{5,40}$/);
    await approve(orderId);
    expect(await screen.findByRole("heading", { level: 1, name: "Thank you!" })).toBeInTheDocument();
    expect(router.state.location.pathname).toMatch(/^\/thanks\//);
  });

  it("captures once even if PayPal calls onApprove twice", async () => {
    let captures = 0;
    server.use(
      http.post(CAPTURE_ROUTE, () => {
        captures += 1;
      }),
    );
    await renderPanel();
    const orderId = await createOrder();
    await Promise.all([approve(orderId), approve(orderId)]);
    await screen.findByRole("heading", { level: 1, name: "Thank you!" });
    expect(captures).toBe(1);
  });

  it("INSTRUMENT_DECLINED: calls actions.restart() and captures the same order after the new approval", async () => {
    await renderPanel();
    const orderId = await createOrder();
    mockDb.armScenario("declined");
    await approve(orderId);
    expect(sdk.restart).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText("Your card was declined. Choose another payment method in PayPal."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await approve(orderId);
    expect(await screen.findByRole("heading", { level: 1, name: "Thank you!" })).toBeInTheDocument();
  });

  it("onCancel: toast that the hold is released in 15 minutes", async () => {
    await renderPanel();
    await createOrder();
    act(() => buttons().onCancel?.({}, { redirect: () => undefined }));
    expect(await screen.findByText("Payment cancelled. Your hold is released in 15 minutes.")).toBeInTheDocument();
  });

  it("onError: friendly message and Try again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await renderPanel();
    act(() => buttons().onError?.({ message: "zoid destroyed" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("PayPal ran into a problem, so nothing was charged. Please try again.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a rejected createOrder isn't reported twice when PayPal then calls onError", async () => {
    server.use(
      http.post(`${API}${paths.createOrder}`, () =>
        HttpResponse.json({ error: { code: "INTERNAL", message: "boom" } }, { status: 500 }),
      ),
    );
    await renderPanel();
    await expect(createOrder()).rejects.toMatchObject({ code: "INTERNAL" });
    act(() => buttons().onError?.({ message: "createOrder rejected" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We couldn't start the payment, so nothing was charged.");
  });
});

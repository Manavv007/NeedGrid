/**
 * PayPal Orders v2: create a donation order and capture it.
 *
 * Money code talks to PayPal only through `ordersGateway()`, so tests swap in a fake
 * (paypal/__fakes__.ts) with `setOrdersGateway`. No test ever calls the real PayPal.
 */
import { centsToPayPalValue, payPalValueToCents } from "@needgrid/shared";
import { z } from "zod";
import { env } from "../env";
import { HttpError } from "../lib/http";
import { PayPalApiError, paypalFetch } from "./client";

export interface CreateOrderInput {
  /** Our reservation id: becomes custom_id and the idempotency key. */
  reservationId: string;
  needId: string;
  title: string;
  amountCents: number;
}

export interface CapturedOrder {
  orderId: string;
  /** Order status, e.g. COMPLETED. */
  status: string;
  capture: { id: string; status: string; amountCents: number; currency: string } | null;
  payer: { givenName: string | null; email: string | null };
  /** purchase_units[0].custom_id = our reservation id. */
  customId: string | null;
}

export interface OrdersGateway {
  createOrder(input: CreateOrderInput): Promise<{ orderId: string; status: string }>;
  /**
   * Captures an approved order. Safe to call again: an already-captured order returns its existing capture.
   * Throws HttpError 409 INVALID_STATE (details.paypalIssue) when the buyer hasn't approved or the payment was declined.
   */
  captureOrder(orderId: string): Promise<CapturedOrder>;
}

// ---------------------------------------------------------------------------------------------

/** PayPal limits: item name and description ≤ 127 characters. */
const clip = (s: string, max = 127) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

/**
 * Order body (AGENT_A_BACKEND.md §8.2). Money rule 9 asks for item category DONATION, but PayPal
 * only allows it on accounts approved for donations; with `donationCategory: false` the category is omitted.
 */
export function buildCreateOrderBody(input: CreateOrderInput, opts: { donationCategory: boolean }) {
  const money = { currency_code: "USD", value: centsToPayPalValue(input.amountCents) };
  const item = {
    name: clip(input.title),
    quantity: "1",
    unit_amount: money,
    ...(opts.donationCategory ? { category: "DONATION" } : {}),
  };
  return {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: input.needId,
        custom_id: input.reservationId,
        description: clip(`Donation: ${input.title}`),
        amount: { ...money, breakdown: { item_total: money } },
        items: [item],
      },
    ],
    payment_source: {
      paypal: {
        experience_context: { shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW", brand_name: "NeedGrid" },
      },
    },
  };
}

const MoneySchema = z.object({ currency_code: z.string(), value: z.string() });
const OrderSchema = z.object({
  id: z.string(),
  status: z.string(),
  payer: z
    .object({
      name: z.object({ given_name: z.string().optional() }).optional(),
      email_address: z.string().optional(),
    })
    .optional(),
  purchase_units: z
    .array(
      z.object({
        custom_id: z.string().optional(),
        payments: z
          .object({
            captures: z.array(z.object({ id: z.string(), status: z.string(), amount: MoneySchema })).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

export function normalizeOrder(raw: unknown): CapturedOrder {
  const o = OrderSchema.parse(raw);
  const unit = o.purchase_units?.[0];
  const c = unit?.payments?.captures?.[0];
  return {
    orderId: o.id,
    status: o.status,
    capture: c
      ? {
          id: c.id,
          status: c.status,
          amountCents: payPalValueToCents(c.amount.value),
          currency: c.amount.currency_code,
        }
      : null,
    payer: { givenName: o.payer?.name?.given_name ?? null, email: o.payer?.email_address ?? null },
    customId: unit?.custom_id ?? null,
  };
}

/** PayPal 422 issues on capture that mean "the buyer needs to do something", not "PayPal is down". */
const BUYER_ISSUES: Record<string, string> = {
  ORDER_NOT_APPROVED: "The payment hasn't been approved in PayPal yet",
  INSTRUMENT_DECLINED: "The payment method was declined. Please choose another one in PayPal.",
  PAYER_ACTION_REQUIRED: "PayPal needs the donor to finish the payment",
  ORDER_EXPIRED: "This PayPal order expired. Please start again.",
};

export const realOrdersGateway: OrdersGateway = {
  async createOrder(input) {
    const { data } = await paypalFetch<{ id: string; status: string }>("POST", "/v2/checkout/orders", {
      requestId: `order-${input.reservationId}`,
      body: buildCreateOrderBody(input, { donationCategory: env.PAYPAL_DONATION_ITEMS }),
    });
    return { orderId: data.id, status: data.status };
  },

  async captureOrder(orderId) {
    const path = `/v2/checkout/orders/${encodeURIComponent(orderId)}`;
    try {
      const { data } = await paypalFetch("POST", `${path}/capture`, { requestId: `capture-${orderId}` });
      return normalizeOrder(data);
    } catch (err) {
      if (err instanceof PayPalApiError && err.hasIssue("ORDER_ALREADY_CAPTURED")) {
        const { data } = await paypalFetch("GET", path);
        return normalizeOrder(data);
      }
      if (err instanceof PayPalApiError && err.paypalStatus === 422) {
        const issue = Object.keys(BUYER_ISSUES).find((i) => err.hasIssue(i));
        if (issue) throw new HttpError(409, "INVALID_STATE", BUYER_ISSUES[issue]!, { paypalIssue: issue });
      }
      if (err instanceof PayPalApiError && err.paypalStatus === 404) {
        throw new HttpError(404, "NOT_FOUND", "PayPal order not found");
      }
      throw err;
    }
  },
};

let current: OrdersGateway = realOrdersGateway;

export function ordersGateway(): OrdersGateway {
  return current;
}

/** Tests only. */
export function setOrdersGateway(g: OrdersGateway): void {
  current = g;
}

/** PayPal client + orders gateway with a stubbed fetch. No network. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../lib/http";
import { PayPalApiError, paypalClientConfig, paypalFetch, resetPayPalTokenCache } from "./client";
import { buildCreateOrderBody, normalizeOrder, realOrdersGateway } from "./orders";

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
let calls: Call[] = [];
let responses: Array<(c: Call) => Response | Promise<Response>> = [];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const token = () => json(200, { access_token: "tok-1", token_type: "Bearer", expires_in: 32400 });

beforeEach(() => {
  calls = [];
  responses = [];
  paypalClientConfig.baseDelayMs = 0;
  resetPayPalTokenCache();
  vi.stubGlobal("fetch", async (input: URL | string, init: RequestInit = {}) => {
    const call: Call = {
      url: String(input),
      method: init.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)),
      body: typeof init.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${call.method} ${call.url}`);
    return next(call);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  paypalClientConfig.baseDelayMs = 250;
});

const capturedOrder = {
  id: "5O190127TN364715T",
  status: "COMPLETED",
  payer: { name: { given_name: "Jamie" }, email_address: "jamie@example.com" },
  purchase_units: [
    {
      custom_id: "res-1",
      payments: {
        captures: [{ id: "3C679366HH908993F", status: "COMPLETED", amount: { currency_code: "USD", value: "14.00" } }],
      },
    },
  ],
};

describe("paypalFetch", () => {
  it("uses the sandbox host, caches the token and sends the request id", async () => {
    responses.push(
      token,
      () => json(201, { id: "A" }),
      () => json(201, { id: "B" }),
    );
    await paypalFetch("POST", "/v2/checkout/orders", { requestId: "order-1", body: { x: 1 } });
    await paypalFetch("POST", "/v2/checkout/orders", { requestId: "order-2", body: { x: 2 } });
    expect(calls.map((c) => c.url)).toEqual([
      "https://api-m.sandbox.paypal.com/v1/oauth2/token",
      "https://api-m.sandbox.paypal.com/v2/checkout/orders",
      "https://api-m.sandbox.paypal.com/v2/checkout/orders",
    ]);
    expect(calls[1]!.headers["paypal-request-id"]).toBe("order-1");
    expect(calls[1]!.headers.authorization).toBe("Bearer tok-1");
    expect(calls[1]!.headers.prefer).toBe("return=representation");
  });

  it("refuses a POST without a request id", async () => {
    await expect(paypalFetch("POST", "/v2/checkout/orders", { body: {} })).rejects.toThrow(/requestId/);
  });

  it("retries 503 with the SAME request id, then succeeds", async () => {
    responses.push(
      token,
      () => json(503, {}),
      () => json(503, {}),
      () => json(201, { id: "OK" }),
    );
    const res = await paypalFetch<{ id: string }>("POST", "/v2/x", { requestId: "same", body: {} });
    expect(res.data.id).toBe("OK");
    const ids = calls.slice(1).map((c) => c.headers["paypal-request-id"]);
    expect(ids).toEqual(["same", "same", "same"]);
  });

  it("refreshes the token once on 401", async () => {
    responses.push(
      token,
      () => json(401, {}),
      () => json(200, { access_token: "tok-2", expires_in: 100 }),
      () => json(200, { ok: true }),
    );
    await paypalFetch("GET", "/v2/x");
    expect(calls[3]!.headers.authorization).toBe("Bearer tok-2");
  });

  it("maps PayPal errors with issues and debug_id (502 UPSTREAM to our clients)", async () => {
    responses.push(token, () =>
      json(422, {
        name: "UNPROCESSABLE_ENTITY",
        message: "The requested action could not be performed",
        debug_id: "dbg-42",
        details: [{ issue: "ORDER_NOT_APPROVED" }],
      }),
    );
    const err = await paypalFetch("POST", "/v2/x", { requestId: "r", body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    const e = err as PayPalApiError;
    expect([e.status, e.code, e.paypalStatus, e.debugId]).toEqual([502, "UPSTREAM", 422, "dbg-42"]);
    expect(e.hasIssue("ORDER_NOT_APPROVED")).toBe(true);
  });

  it("gives up after 3 retries on network errors", async () => {
    const boom = () => {
      throw new TypeError("fetch failed");
    };
    responses.push(token, boom, boom, boom, boom);
    await expect(paypalFetch("GET", "/v2/x")).rejects.toMatchObject({ paypalStatus: 0, code: "UPSTREAM" });
    expect(calls).toHaveLength(5);
  });
});

describe("orders", () => {
  it("builds an order with exact money strings; DONATION category only when the account allows it", () => {
    const input = { reservationId: "res-1", needId: "need-1", title: "Diapers, size 4", amountCents: 1405 };
    const body = buildCreateOrderBody(input, { donationCategory: false });
    const unit = body.purchase_units[0]!;
    expect(body.intent).toBe("CAPTURE");
    expect(unit).toMatchObject({
      reference_id: "need-1",
      custom_id: "res-1",
      description: "Donation: Diapers, size 4",
    });
    expect(unit.amount).toEqual({
      currency_code: "USD",
      value: "14.05",
      breakdown: { item_total: { currency_code: "USD", value: "14.05" } },
    });
    expect(unit.items[0]).toEqual({
      name: "Diapers, size 4",
      quantity: "1",
      unit_amount: { currency_code: "USD", value: "14.05" },
    });
    const approved = buildCreateOrderBody(input, { donationCategory: true });
    expect(approved.purchase_units[0]!.items[0]).toMatchObject({ category: "DONATION" });
    const long = buildCreateOrderBody({ ...input, title: "x".repeat(300) }, { donationCategory: false });
    expect(long.purchase_units[0]!.items[0]!.name.length).toBe(127);
  });

  it("normalizes a captured order", () => {
    expect(normalizeOrder(capturedOrder)).toEqual({
      orderId: "5O190127TN364715T",
      status: "COMPLETED",
      capture: { id: "3C679366HH908993F", status: "COMPLETED", amountCents: 1400, currency: "USD" },
      payer: { givenName: "Jamie", email: "jamie@example.com" },
      customId: "res-1",
    });
  });

  it("capture: ORDER_ALREADY_CAPTURED falls back to GET the order", async () => {
    responses.push(
      token,
      () => json(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_ALREADY_CAPTURED" }] }),
      () => json(200, capturedOrder),
    );
    const order = await realOrdersGateway.captureOrder("5O190127TN364715T");
    expect(order.capture?.id).toBe("3C679366HH908993F");
    expect(calls[1]!.headers["paypal-request-id"]).toBe("capture-5O190127TN364715T");
    expect(calls[1]!.headers["content-type"]).toBe("application/json"); // PayPal returns 415 without it
    expect(calls[2]!.method).toBe("GET");
  });

  it("capture: buyer problems become 409 INVALID_STATE with the PayPal issue", async () => {
    responses.push(token, () =>
      json(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INSTRUMENT_DECLINED" }] }),
    );
    const err = await realOrdersGateway.captureOrder("ABCDE12345").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 409, code: "INVALID_STATE", details: { paypalIssue: "INSTRUMENT_DECLINED" } });
  });
});

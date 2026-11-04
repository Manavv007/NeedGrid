/** Transaction Search parsing and paging with a stubbed fetch. No network. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { paypalClientConfig, resetPayPalTokenCache } from "./client";
import { normalizeTransactions, paypalDate, realTransactionsGateway } from "./transactions";

const tx = (id: string, value: string, extra: Record<string, unknown> = {}) => ({
  transaction_info: {
    transaction_id: id,
    transaction_event_code: "T0006",
    transaction_initiation_date: "2026-11-02T10:00:00+0000",
    transaction_amount: { currency_code: "USD", value },
    transaction_status: "S",
    ...extra,
  },
});

describe("normalizeTransactions", () => {
  it("signed cents, optional fields, skips rows without an amount", () => {
    const { items, totalPages } = normalizeTransactions({
      transaction_details: [
        tx("A1", "14.00", { invoice_id: "INV2-XXX", custom_field: "res-1" }),
        tx("A2", "-5.50", { transaction_event_code: "T1107" }),
        { transaction_info: { transaction_id: "A3" } },
      ],
      total_pages: 2,
    });
    expect(totalPages).toBe(2);
    expect(items).toEqual([
      expect.objectContaining({
        transactionId: "A1",
        amountCents: 1400,
        invoiceId: "INV2-XXX",
        customField: "res-1",
        status: "S",
      }),
      expect.objectContaining({ transactionId: "A2", amountCents: -550, eventCode: "T1107", invoiceId: null }),
    ]);
  });

  it("empty result", () => {
    expect(normalizeTransactions({}).items).toEqual([]);
  });

  it("dates have no fractional seconds", () => {
    expect(paypalDate(new Date("2026-11-03T10:11:12.345Z"))).toBe("2026-11-03T10:11:12Z");
  });
});

describe("realTransactionsGateway", () => {
  let urls: string[] = [];
  beforeEach(() => {
    urls = [];
    paypalClientConfig.baseDelayMs = 0;
    resetPayPalTokenCache();
    vi.stubGlobal("fetch", async (input: URL | string) => {
      const url = String(input);
      if (url.endsWith("/v1/oauth2/token"))
        return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
      urls.push(url);
      const page = Number(new URL(url).searchParams.get("page"));
      return new Response(JSON.stringify({ transaction_details: [tx(`P${page}`, "1.00")], total_pages: 2, page }));
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    paypalClientConfig.baseDelayMs = 250;
  });

  it("follows pages and sends PayPal-style dates", async () => {
    const items = await realTransactionsGateway.list({
      start: new Date("2026-10-27T00:00:00.500Z"),
      end: new Date("2026-11-03T00:00:00Z"),
    });
    expect(items.map((i) => i.transactionId)).toEqual(["P1", "P2"]);
    const q = new URL(urls[0]!).searchParams;
    expect(q.get("start_date")).toBe("2026-10-27T00:00:00Z");
    expect(q.get("fields")).toBe("transaction_info");
  });

  it("refuses windows over 31 days or reversed", async () => {
    await expect(
      realTransactionsGateway.list({ start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-11-03T00:00:00Z") }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      realTransactionsGateway.list({ start: new Date("2026-11-03T00:00:00Z"), end: new Date("2026-11-01T00:00:00Z") }),
    ).rejects.toMatchObject({ status: 400 });
    expect(urls).toHaveLength(0);
  });
});

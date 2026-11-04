/**
 * PayPal Transaction Search (GET /v1/reporting/transactions), read-only, for B's reconcile check.
 *
 * PayPal rules: the window is at most 31 days, dates must have no fractional seconds, and new activity
 * can take up to ~3 hours to appear. The sandbox app needs the Transaction Search feature enabled
 * (OAuth scope .../reporting/search/read). Swappable in tests via setTransactionsGateway.
 */
import { payPalValueToCents } from "@needgrid/shared";
import { z } from "zod";
import { HttpError } from "../lib/http";
import { paypalFetch } from "./client";

export interface PayPalTransaction {
  transactionId: string;
  /** S success, P pending, D denied, V reversed, F partially refunded. */
  status: string;
  /** Signed: refunds and reversals are negative. */
  amountCents: number;
  currency: string;
  at: string;
  invoiceId: string | null;
  customField: string | null;
  /** PayPal T-code, e.g. T0006 (checkout payment), T1107 (refund). */
  eventCode: string;
}

export interface TransactionsGateway {
  list(input: { start: Date; end: Date }): Promise<PayPalTransaction[]>;
}

export const MAX_WINDOW_DAYS = 31;
const MAX_PAGES = 10;

/** PayPal rejects fractional seconds: 2026-11-03T10:00:00Z. */
export const paypalDate = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;

const Money = z.object({ value: z.string(), currency_code: z.string() });
const Page = z.object({
  transaction_details: z
    .array(
      z.object({
        transaction_info: z.object({
          transaction_id: z.string(),
          transaction_event_code: z.string().optional(),
          transaction_initiation_date: z.string().optional(),
          transaction_updated_date: z.string().optional(),
          transaction_amount: Money.optional(),
          transaction_status: z.string().optional(),
          invoice_id: z.string().optional(),
          custom_field: z.string().optional(),
        }),
      }),
    )
    .default([]),
  total_pages: z.number().int().optional(),
  page: z.number().int().optional(),
});

/** "-14.00" → -1400; "14.00" → 1400. */
function signedCents(value: string): number {
  const v = value.trim();
  return v.startsWith("-") ? -payPalValueToCents(v.slice(1)) : payPalValueToCents(v.replace(/^\+/, ""));
}

export function normalizeTransactions(raw: unknown): { items: PayPalTransaction[]; totalPages: number } {
  const page = Page.parse(raw);
  const items = page.transaction_details
    .map((d) => d.transaction_info)
    .filter((t) => t.transaction_amount)
    .map((t) => ({
      transactionId: t.transaction_id,
      status: t.transaction_status ?? "",
      amountCents: signedCents(t.transaction_amount!.value),
      currency: t.transaction_amount!.currency_code,
      at: t.transaction_initiation_date ?? t.transaction_updated_date ?? "",
      invoiceId: t.invoice_id ?? null,
      customField: t.custom_field ?? null,
      eventCode: t.transaction_event_code ?? "",
    }));
  return { items, totalPages: page.total_pages ?? 1 };
}

export const realTransactionsGateway: TransactionsGateway = {
  async list({ start, end }) {
    if (!(start < end)) throw new HttpError(400, "VALIDATION", "start must be before end");
    if (end.getTime() - start.getTime() > MAX_WINDOW_DAYS * 86_400_000) {
      throw new HttpError(400, "VALIDATION", `PayPal searches at most ${MAX_WINDOW_DAYS} days at a time`);
    }
    const out: PayPalTransaction[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data } = await paypalFetch("GET", "/v1/reporting/transactions", {
        query: {
          start_date: paypalDate(start),
          end_date: paypalDate(end),
          fields: "transaction_info",
          page_size: "500",
          page: String(page),
        },
      });
      const { items, totalPages } = normalizeTransactions(data);
      out.push(...items);
      if (page >= totalPages) break;
    }
    return out;
  },
};

let current: TransactionsGateway = realTransactionsGateway;
export const transactionsGateway = () => current;
/** Tests only. */
export function setTransactionsGateway(g: TransactionsGateway): void {
  current = g;
}

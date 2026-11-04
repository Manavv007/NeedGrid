/**
 * PayPal Invoicing v2 for sponsor invoices (AGENT_A_BACKEND.md §8.6). REST through paypalFetch; the
 * @paypal/agent-toolkit package is not used (its peer deps clash with ours, see NOTES.md §0).
 *
 * Money code talks to PayPal only through `invoicesGateway()`, so tests swap in a fake with `setInvoicesGateway`.
 */
import { centsToPayPalValue, payPalValueToCents } from "@needgrid/shared";
import { z } from "zod";
import { PayPalApiError, paypalFetch } from "./client";

export interface CreateInvoiceInput {
  /** Our sponsor_invoices id: becomes detail.reference and the idempotency key. */
  sponsorInvoiceId: string;
  orgName: string;
  recipientEmail: string;
  recipientName: string | null;
  note: string | null;
  items: Array<{ title: string; amountCents: number }>;
}

export interface InvoiceState {
  /** DRAFT, SENT, SCHEDULED, UNPAID, PARTIALLY_PAID, PAID, MARKED_AS_PAID, CANCELLED, REFUNDED, … */
  status: string;
  payerViewUrl: string | null;
  /** payments.paid_amount (null when nothing has been paid). */
  paidCents: number | null;
  /** The latest PayPal payment on the invoice (payments.transactions[].payment_id). */
  transactionId: string | null;
}

export interface InvoicesGateway {
  /** Creates a DRAFT invoice. Returns PayPal's invoice id (INV2-…). */
  createInvoice(input: CreateInvoiceInput): Promise<{ invoiceId: string }>;
  /** Sends (emails) the invoice. Returns the link the sponsor pays at, when PayPal gives one. */
  sendInvoice(invoiceId: string): Promise<{ payerViewUrl: string | null }>;
  /** PayPal status, e.g. DRAFT, SENT, UNPAID, PAID. Used to resolve an ambiguous send failure. */
  getInvoiceStatus(invoiceId: string): Promise<InvoiceState>;
  /** QR code of a sent invoice as "data:image/png;base64,…". */
  generateQrCode(invoiceId: string): Promise<string>;
  /** Deletes a draft (best effort clean-up after a failed approval). */
  deleteDraft(invoiceId: string): Promise<void>;
}

/** PayPal limits: item name ≤ 200, reference ≤ 120, note ≤ 4000 characters. */
const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

export function buildCreateInvoiceBody(input: CreateInvoiceInput) {
  return {
    detail: {
      currency_code: "USD",
      reference: input.sponsorInvoiceId,
      memo: "NeedGrid sponsor invoice",
      ...(input.note ? { note: clip(input.note, 4000) } : {}),
    },
    invoicer: { business_name: clip(input.orgName, 300) },
    primary_recipients: [
      {
        billing_info: {
          email_address: input.recipientEmail,
          ...(input.recipientName ? { business_name: clip(input.recipientName, 300) } : {}),
        },
      },
    ],
    items: input.items.map((i) => ({
      name: clip(i.title, 200),
      quantity: "1",
      unit_amount: { currency_code: "USD", value: centsToPayPalValue(i.amountCents) },
      unit_of_measure: "AMOUNT",
    })),
    configuration: { allow_tip: false, partial_payment: { allow_partial_payment: false } },
  };
}

const Link = z.object({ href: z.string(), rel: z.string().optional() });
const Money = z.object({ value: z.string(), currency_code: z.string().optional() });
const InvoiceSchema = z.object({
  id: z.string().optional(),
  status: z.string().optional(),
  detail: z.object({ metadata: z.object({ recipient_view_url: z.string().optional() }).optional() }).optional(),
  payments: z
    .object({
      paid_amount: Money.optional(),
      transactions: z
        .array(z.object({ payment_id: z.string().optional(), payment_date: z.string().optional() }))
        .optional(),
    })
    .optional(),
  links: z.array(Link).optional(),
  href: z.string().optional(),
  rel: z.string().optional(),
});

/** GET /v2/invoicing/invoices/{id} → what our money code needs. */
export function invoiceStateOf(raw: unknown): InvoiceState {
  const b = InvoiceSchema.parse(raw ?? {});
  const paid = b.payments?.paid_amount;
  if (paid?.currency_code && paid.currency_code !== "USD") {
    throw new PayPalApiError(`Unexpected invoice currency ${paid.currency_code}`, 200, null, [], null);
  }
  const withId = (b.payments?.transactions ?? []).filter((t) => t.payment_id);
  return {
    status: b.status ?? "UNKNOWN",
    payerViewUrl: payerViewUrlOf(raw),
    paidCents: paid ? payPalValueToCents(paid.value) : null,
    transactionId: withId.at(-1)?.payment_id ?? null,
  };
}

/** Create returns the invoice (Prefer: return=representation) or just a link ending in the id. */
export function invoiceIdFromCreate(raw: unknown): string {
  const b = InvoiceSchema.parse(raw ?? {});
  const fromHref = (href?: string) => href?.match(/\/invoices\/([^/?#]+)$/)?.[1];
  const id = b.id ?? fromHref(b.href) ?? fromHref(b.links?.find((l) => l.rel === "self")?.href);
  if (!id) throw new PayPalApiError("PayPal didn't return an invoice id", 200, null, [], null);
  return id;
}

/** The sponsor's pay link: a `payer-view` link (send response) or detail.metadata.recipient_view_url (GET). */
export function payerViewUrlOf(raw: unknown): string | null {
  const parsed = InvoiceSchema.safeParse(raw ?? {});
  if (!parsed.success) return null;
  const b = parsed.data;
  if (b.rel === "payer-view" && b.href) return b.href;
  return b.links?.find((l) => l.rel === "payer-view")?.href ?? b.detail?.metadata?.recipient_view_url ?? null;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * The QR endpoint answers with a base64 PNG, either as the raw body or wrapped in a multipart body
 * (headers, blank line, base64, closing boundary). Take the longest base64 run and check it's a PNG.
 */
export function qrDataUrlFrom(body: string): string {
  const trimmed = body.trim();
  try {
    const json = JSON.parse(trimmed) as { image?: unknown; qr_code?: unknown };
    const v = typeof json.image === "string" ? json.image : typeof json.qr_code === "string" ? json.qr_code : null;
    if (v) return qrDataUrlFrom(v);
  } catch {
    // not JSON
  }
  const candidates = trimmed
    .split(/\r?\n\r?\n|\r?\n--/)
    .map((part) => part.replace(/\s+/g, ""))
    .filter((part) => part.length > 100 && BASE64.test(part))
    .sort((a, b) => b.length - a.length);
  const b64 = candidates[0];
  // PNG files start with 0x89 'P' 'N' 'G' → base64 "iVBORw0KGgo".
  if (!b64 || !b64.startsWith("iVBORw0KGgo")) {
    throw new PayPalApiError("PayPal returned a QR code in an unexpected format", 200, null, [], null);
  }
  return `data:image/png;base64,${b64}`;
}

const path = (invoiceId: string) => `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`;

export const realInvoicesGateway: InvoicesGateway = {
  async createInvoice(input) {
    const { data } = await paypalFetch("POST", "/v2/invoicing/invoices", {
      requestId: `inv-${input.sponsorInvoiceId}`,
      body: buildCreateInvoiceBody(input),
    });
    return { invoiceId: invoiceIdFromCreate(data) };
  },

  async sendInvoice(invoiceId) {
    const { data } = await paypalFetch("POST", `${path(invoiceId)}/send`, {
      requestId: `inv-send-${invoiceId}`,
      body: { send_to_recipient: true, send_to_invoicer: false },
    });
    return { payerViewUrl: payerViewUrlOf(data) };
  },

  async getInvoiceStatus(invoiceId) {
    const { data } = await paypalFetch("GET", path(invoiceId));
    return invoiceStateOf(data);
  },

  async generateQrCode(invoiceId) {
    const { data } = await paypalFetch<string>("POST", `${path(invoiceId)}/generate-qr-code`, {
      requestId: `inv-qr-${invoiceId}`,
      body: { width: 300, height: 300 },
      responseType: "text",
    });
    return qrDataUrlFrom(data);
  },

  async deleteDraft(invoiceId) {
    await paypalFetch("DELETE", path(invoiceId));
  },
};

let current: InvoicesGateway = realInvoicesGateway;
export const invoicesGateway = () => current;
/** Tests only. */
export function setInvoicesGateway(g: InvoicesGateway): void {
  current = g;
}

import { formatUsd, type NeedCard, type SponsorInvoiceView } from "@needgrid/shared";

/** The only QR images we show: a PNG the server stored as a base64 data URL. */
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * `qrImageDataUrl` if it's exactly a base64 PNG data URL, else null (then only the payer link is
 * shown). Nothing else may become an image source.
 */
export function safeQrDataUrl(raw: string | null): string | null {
  return raw !== null && PNG_DATA_URL.test(raw) ? raw : null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Acme Hardware" (or the email when there's no name). */
export const recipientOf = (invoice: SponsorInvoiceView) => invoice.recipientName ?? invoice.recipientEmail;

/** "4 items" (how many needs the invoice pays for). */
export const itemCount = (invoice: SponsorInvoiceView) => plural(invoice.needIds.length, "item", "items");

/** "Acme Hardware · 4 items · $203.00" (QR dialog, invoices list). */
export function invoiceSummary(invoice: SponsorInvoiceView): string {
  return `${recipientOf(invoice)} · ${itemCount(invoice)} · ${formatUsd(invoice.amountCents)}`;
}

/** Newest first, by when the invoice was created (the server's own order isn't promised). */
export function newestFirst(invoices: readonly SponsorInvoiceView[]): SponsorInvoiceView[] {
  return [...invoices].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * The titles of the needs an invoice pays for, when every one of them is in `known` (the staff
 * needs this tab already loaded), else null and only the count is shown.
 */
export function itemTitles(invoice: SponsorInvoiceView, known: readonly NeedCard[] | null): string[] | null {
  if (known === null) return null;
  const titles = new Map(known.map((need) => [need.id, need.title]));
  const found = invoice.needIds.map((id) => titles.get(id));
  return found.every((title): title is string => title !== undefined) ? found : null;
}

/**
 * "Sent $X · Paid $Y" above the list. Display only: added up from the amounts the server sent, never
 * used for any decision.
 */
export function invoiceTotals(invoices: readonly SponsorInvoiceView[]): { sentCents: number; paidCents: number } {
  let sentCents = 0;
  let paidCents = 0;
  for (const invoice of invoices) {
    if (invoice.status === "sent") sentCents += invoice.amountCents;
    if (invoice.status === "paid") paidCents += invoice.amountCents;
  }
  return { sentCents, paidCents };
}

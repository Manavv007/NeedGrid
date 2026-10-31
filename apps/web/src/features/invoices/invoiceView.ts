import { formatUsd, type SponsorInvoiceView } from "@needgrid/shared";

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

/** "Acme Hardware · 4 items · $203.00" (QR dialog, invoices list). */
export function invoiceSummary(invoice: SponsorInvoiceView): string {
  return `${recipientOf(invoice)} · ${plural(invoice.needIds.length, "item", "items")} · ${formatUsd(invoice.amountCents)}`;
}

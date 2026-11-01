import type { NeedCard, SponsorInvoiceView } from "@needgrid/shared";
import { useId } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatFullDateTime, formatRelativeTime, formatUsd } from "@/lib/format";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { InvoiceQrDialog } from "./InvoiceQrDialog";
import { InvoiceStatusBadge } from "./InvoiceStatusBadge";
import { itemCount, itemTitles, recipientOf, safeQrDataUrl } from "./invoiceView";
import { PayerLink } from "./PayerLink";

type InvoiceListProps = {
  /** Newest first. */
  invoices: readonly SponsorInvoiceView[];
  /** The charity being paid, for the QR dialog ("Pay Room 12 Readers"). */
  orgName: string;
  /** The charity's needs if this tab already has them, to name each invoice's items. */
  knownNeeds: readonly NeedCard[] | null;
};

/**
 * Sponsor invoices (Invoices.dc.html): a table from 768 px, one card per invoice on phones, so the
 * page never scrolls sideways. Every amount and status is the server's.
 */
export function InvoiceList(props: InvoiceListProps) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY, true);
  return isDesktop ? <InvoiceTable {...props} /> : <InvoiceCards {...props} />;
}

function InvoiceTable({ invoices, orgName, knownNeeds }: InvoiceListProps) {
  return (
    <div className="overflow-hidden rounded-xl border bg-surface">
      <Table className="min-w-180">
        <TableHeader>
          <TableRow className="text-xs tracking-[0.05em] text-muted-foreground uppercase hover:bg-transparent">
            <TableHead scope="col" className="h-11 px-4 font-semibold text-muted-foreground">
              Sponsor
            </TableHead>
            <TableHead scope="col" className="h-11 font-semibold text-muted-foreground">
              Items
            </TableHead>
            <TableHead scope="col" className="h-11 text-right font-semibold text-muted-foreground">
              Amount
            </TableHead>
            <TableHead scope="col" className="h-11 font-semibold text-muted-foreground">
              Status
            </TableHead>
            <TableHead scope="col" className="h-11 font-semibold text-muted-foreground">
              Created
            </TableHead>
            <TableHead scope="col" className="h-11 px-4 font-semibold text-muted-foreground">
              Pay link
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((invoice) => (
            <TableRow key={invoice.id} className="hover:bg-transparent">
              <TableCell className="px-4 py-3.5">
                <Recipient invoice={invoice} />
              </TableCell>
              <TableCell className="py-3.5 whitespace-normal">
                <Items invoice={invoice} knownNeeds={knownNeeds} />
              </TableCell>
              <TableCell className="py-3.5 text-right font-extrabold">{formatUsd(invoice.amountCents)}</TableCell>
              <TableCell className="py-3.5">
                <InvoiceStatusBadge status={invoice.status} />
              </TableCell>
              <TableCell className="py-3.5 text-[13px] text-soft">
                <Created iso={invoice.createdAt} />
              </TableCell>
              <TableCell className="px-4 py-3.5">
                <PayLink invoice={invoice} orgName={orgName} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function InvoiceCards({ invoices, orgName, knownNeeds }: InvoiceListProps) {
  return (
    <ul aria-label="Sponsor invoices" className="m-0 flex list-none flex-col gap-3 p-0">
      {invoices.map((invoice) => (
        <li key={invoice.id}>
          <InvoiceCard invoice={invoice} orgName={orgName} knownNeeds={knownNeeds} />
        </li>
      ))}
    </ul>
  );
}

type InvoiceCardProps = { invoice: SponsorInvoiceView; orgName: string; knownNeeds: readonly NeedCard[] | null };

function InvoiceCard({ invoice, orgName, knownNeeds }: InvoiceCardProps) {
  const titleId = useId();
  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-3 rounded-xl border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <Recipient invoice={invoice} titleId={titleId} />
        <InvoiceStatusBadge status={invoice.status} className="shrink-0" />
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Amount</dt>
        <dd className="font-extrabold">{formatUsd(invoice.amountCents)}</dd>
        <dt className="text-muted-foreground">Items</dt>
        <dd>
          <Items invoice={invoice} knownNeeds={knownNeeds} />
        </dd>
        <dt className="text-muted-foreground">Created</dt>
        <dd className="text-soft">
          <Created iso={invoice.createdAt} />
        </dd>
      </dl>
      <PayLink invoice={invoice} orgName={orgName} />
    </article>
  );
}

/** Name in bold with the email under it; just the email when there's no name. */
function Recipient({ invoice, titleId }: { invoice: SponsorInvoiceView; titleId?: string }) {
  const Name = titleId ? "h2" : "strong";
  return (
    <div className="flex min-w-0 flex-col">
      <Name id={titleId} className="text-sm font-bold break-words">
        {recipientOf(invoice)}
      </Name>
      {invoice.recipientName ? (
        <span className="text-xs break-all text-muted-foreground">{invoice.recipientEmail}</span>
      ) : null}
    </div>
  );
}

/** "2 items", with the need titles under it when this tab knows them all. */
function Items({ invoice, knownNeeds }: { invoice: SponsorInvoiceView; knownNeeds: readonly NeedCard[] | null }) {
  const titles = itemTitles(invoice, knownNeeds);
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span>{itemCount(invoice)}</span>
      {titles ? (
        <ul
          aria-label={`Items for ${recipientOf(invoice)}`}
          className="m-0 list-none p-0 text-xs text-muted-foreground"
        >
          {titles.map((title, i) => (
            <li key={invoice.needIds[i] ?? title}>{title}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** "2 days ago", with the exact date and time on hover. */
function Created({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={formatFullDateTime(iso)}>
      {formatRelativeTime(iso)}
    </time>
  );
}

/** The QR code (pressing it opens a large printable copy) and the payment link, when there is one. */
function PayLink({ invoice, orgName }: { invoice: SponsorInvoiceView; orgName: string }) {
  const recipient = recipientOf(invoice);
  const hasQr = safeQrDataUrl(invoice.qrImageDataUrl) !== null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {hasQr ? <InvoiceQrDialog invoice={invoice} orgName={orgName} thumbnailClassName="size-11" /> : null}
      <PayerLink url={invoice.payerViewUrl} compact recipient={recipient} />
    </div>
  );
}

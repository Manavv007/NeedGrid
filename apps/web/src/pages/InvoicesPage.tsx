import type { NeedCard, SponsorInvoiceView } from "@needgrid/shared";
import { ReceiptText } from "lucide-react";
import { Link } from "react-router";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WakingUp } from "@/components/WakingUp";
import { InvoiceList } from "@/features/invoices/InvoiceList";
import { invoiceTotals, newestFirst } from "@/features/invoices/invoiceView";
import { useStaffOrg } from "@/features/staff/useStaffOrg";
import { ApiClientError } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { STAFF_ASSISTANT_PATH } from "@/lib/links";
import { useInvoices, useKnownStaffNeeds } from "@/lib/queries";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

const PAGE = "mx-auto w-full max-w-300 px-4 pt-6 pb-12 sm:px-6";

/**
 * `/staff/invoices` (brief §9.11, Invoices.dc.html): every sponsor invoice of the charity, newest
 * first, with its status, payment link and QR code. Invoices are made by approving the assistant's
 * proposal; this page only shows them.
 */
export function InvoicesPage() {
  const org = useStaffOrg();
  useDocumentTitle(`Invoices · ${org.name} · NeedGrid staff`);
  const invoices = useInvoices();
  const knownNeeds = useKnownStaffNeeds();
  // A 401 is already on its way to the login page (lib/api.ts): no error flash meanwhile.
  const signedOut = invoices.error instanceof ApiClientError && invoices.error.status === 401;

  return (
    <div className={PAGE}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-tight font-extrabold tracking-[-0.02em]">Sponsor invoices</h1>
          <p className="mt-1.5 text-[15px] text-soft">
            Businesses that fund a whole list at once. Ask the assistant to create one.
          </p>
        </div>
        <Link to={STAFF_ASSISTANT_PATH} className={buttonVariants()}>
          New invoice with assistant
        </Link>
      </div>

      <div className="mt-5">
        {invoices.data ? (
          <Loaded invoices={newestFirst(invoices.data.invoices)} orgName={org.name} knownNeeds={knownNeeds} />
        ) : invoices.isError && !signedOut ? (
          <ErrorState className="mt-3" onRetry={() => void invoices.refetch()} />
        ) : (
          <InvoicesSkeleton />
        )}
      </div>
    </div>
  );
}

type LoadedProps = {
  invoices: readonly SponsorInvoiceView[];
  orgName: string;
  knownNeeds: readonly NeedCard[] | null;
};

function Loaded({ invoices, orgName, knownNeeds }: LoadedProps) {
  if (invoices.length === 0) {
    return (
      <EmptyState
        className="mt-3"
        icon={<ReceiptText className="size-6.5" />}
        title="No sponsor invoices yet"
        message="When a business wants to fund a whole list, the assistant prepares the invoice and you approve it."
        action={
          <Button asChild>
            <Link to={STAFF_ASSISTANT_PATH}>Ask the assistant to invoice a sponsor</Link>
          </Button>
        }
      />
    );
  }
  const { sentCents, paidCents } = invoiceTotals(invoices);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-soft">
        Sent <strong className="text-foreground">{formatUsd(sentCents)}</strong> <span aria-hidden="true">·</span> Paid{" "}
        <strong className="text-foreground">{formatUsd(paidCents)}</strong>
      </p>
      <InvoiceList invoices={invoices} orgName={orgName} knownNeeds={knownNeeds} />
    </div>
  );
}

function InvoicesSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading your invoices…</span>
      <div aria-hidden="true" className="flex flex-col gap-3 motion-safe:animate-pulse">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
      <div className="pt-6">
        <WakingUp />
      </div>
    </div>
  );
}

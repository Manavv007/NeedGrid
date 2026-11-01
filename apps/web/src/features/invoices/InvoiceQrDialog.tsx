import type { SponsorInvoiceView } from "@needgrid/shared";
import { Printer } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { invoiceSummary, recipientOf, safeQrDataUrl } from "./invoiceView";

type InvoiceQrDialogProps = {
  invoice: SponsorInvoiceView;
  /** The charity being paid ("Pay Harbor Food Bank"). */
  orgName: string;
  /** Size of the thumbnail button, e.g. "size-30". */
  thumbnailClassName?: string;
};

/**
 * The invoice's QR code as a thumbnail; pressing it opens a large, printable copy (AssistantStates.dc.html
 * "Invoice QR, ready to print"). Printing puts only the QR code, the recipient and the amount on
 * paper. Renders nothing when the stored image isn't a base64 PNG (`safeQrDataUrl`).
 */
export function InvoiceQrDialog({ invoice, orgName, thumbnailClassName }: InvoiceQrDialogProps) {
  const [open, setOpen] = useState(false);
  const src = safeQrDataUrl(invoice.qrImageDataUrl);
  if (!src) return null;
  const summary = invoiceSummary(invoice);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "shrink-0 cursor-zoom-in rounded-md border bg-surface p-1.5 hover:border-border-strong",
            thumbnailClassName ?? "size-30",
          )}
        >
          <img src={src} alt="" className="size-full [image-rendering:pixelated]" />
          <span className="sr-only">Show the payment QR code for {recipientOf(invoice)} larger, to print</span>
        </button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        data-print="sheet"
        className="flex flex-col items-center gap-3 p-5.5 text-center"
      >
        <DialogTitle className="text-lg font-extrabold print:hidden">Pay {orgName}</DialogTitle>
        <DialogDescription className="text-sm text-soft print:text-base print:text-foreground">
          {summary}
        </DialogDescription>
        <img
          src={src}
          alt={`QR code to pay the invoice: ${summary}`}
          className="size-55 border-10 border-surface outline-1 outline-border [image-rendering:pixelated] print:size-80 print:outline-0"
        />
        <div className="flex gap-2 print:hidden">
          <Button onClick={() => window.print()}>
            <Printer aria-hidden="true" />
            Print
          </Button>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}

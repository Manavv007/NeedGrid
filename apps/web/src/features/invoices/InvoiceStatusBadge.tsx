import type { SponsorInvoiceView } from "@needgrid/shared";
import { Ban, CircleCheck, FilePen, Send, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type InvoiceStatus = SponsorInvoiceView["status"];

// docs/design-tokens.md "Used in C-10": draft neutral, sent info, paid success, cancelled muted.
// Text + icon, never colour alone.
const STATUS: Readonly<Record<InvoiceStatus, { label: string; Icon: LucideIcon; tone: string }>> = {
  draft: { label: "Draft", Icon: FilePen, tone: "bg-badge-low-bg text-badge-low-text" },
  sent: { label: "Sent", Icon: Send, tone: "bg-badge-info-bg text-badge-info-text" },
  paid: { label: "Paid", Icon: CircleCheck, tone: "bg-badge-success-bg text-badge-success-text" },
  cancelled: { label: "Cancelled", Icon: Ban, tone: "border border-border-strong bg-surface text-soft" },
};

export function InvoiceStatusBadge({ status, className }: { status: InvoiceStatus; className?: string }) {
  const { label, Icon, tone } = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.25 rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap",
        tone,
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" strokeWidth={3} />
      {label}
    </span>
  );
}

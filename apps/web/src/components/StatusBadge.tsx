import type { NeedStatus } from "@needgrid/shared";
import { ArrowUp, Check, Circle, FilePen, Truck, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type StatusStyle = { label: string; Icon: LucideIcon; tone: string };

// Colours from docs/design-tokens.md "Status badges". Text + icon, never colour alone.
const STATUS: Record<NeedStatus, StatusStyle> = {
  draft: { label: "Draft", Icon: FilePen, tone: "bg-badge-low-bg text-badge-low-text" },
  open: { label: "Open", Icon: Circle, tone: "bg-primary-soft text-primary" },
  topping_up: { label: "Price went up", Icon: ArrowUp, tone: "bg-badge-warning-bg text-badge-warning-text" },
  funded: { label: "Funded", Icon: Check, tone: "bg-badge-success-bg text-badge-success-text" },
  ordered: { label: "Ordered", Icon: Truck, tone: "bg-badge-info-bg text-badge-info-text" },
  delivered: { label: "Delivered", Icon: Check, tone: "bg-badge-success-bg text-badge-success-text" },
  closed: { label: "Closed", Icon: X, tone: "bg-badge-low-bg text-badge-low-text" },
};

type StatusBadgeProps = {
  status: NeedStatus;
  /** Extra words after the label, e.g. a date: "Delivered Oct 24". */
  suffix?: string | null;
  className?: string;
};

export function StatusBadge({ status, suffix, className }: StatusBadgeProps) {
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
      {suffix ? `${label} ${suffix}` : label}
    </span>
  );
}

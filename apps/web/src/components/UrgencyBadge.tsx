import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

// Design decision (design-ref README): donors see Urgent / Soon / When possible, staff see
// Urgent / Medium / Low. Always text + icon, never colour alone.
const LEVELS = {
  3: { donor: "Urgent", staff: "Urgent", tone: "bg-badge-urgent-bg text-badge-urgent-text" },
  2: { donor: "Soon", staff: "Medium", tone: "bg-badge-medium-bg text-badge-medium-text" },
  1: { donor: "When possible", staff: "Low", tone: "bg-badge-low-bg text-badge-low-text" },
} as const;

type Level = keyof typeof LEVELS;

function toLevel(urgency: number): Level {
  return urgency >= 3 ? 3 : urgency <= 1 ? 1 : 2;
}

type UrgencyBadgeProps = {
  urgency: number;
  audience?: "donor" | "staff";
  className?: string;
};

export function UrgencyBadge({ urgency, audience = "donor", className }: UrgencyBadgeProps) {
  const level = LEVELS[toLevel(urgency)];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.25 rounded-full px-2.25 py-1 text-xs font-bold whitespace-nowrap",
        level.tone,
        className,
      )}
    >
      <TriangleAlert aria-hidden="true" className="size-3" strokeWidth={2.5} />
      {level[audience]}
    </span>
  );
}

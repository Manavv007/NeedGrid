import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

// Heights from docs/design-tokens.md: 8 px phone list, 10 px tile, 12 px donate panel, 16 px big screen.
const HEIGHTS = { sm: "h-2", md: "h-2.5", lg: "h-3", xl: "h-4" } as const;

type ProgressBarProps = {
  /** Amounts exactly as the server sent them. */
  fundedCents: number;
  heldCents: number;
  targetCents: number;
  /** Accessible name, e.g. "Diapers, size 4 funding". */
  label: string;
  size?: keyof typeof HEIGHTS;
  /** Fully funded and beyond: a solid green bar. */
  complete?: boolean;
  /** Replaces the default spoken value, e.g. "$70 of $84 raised, $14 left". */
  valueText?: string;
  className?: string;
};

/** Display-only percentage of the target, clamped to 0–100. */
function widthPct(cents: number, targetCents: number): number {
  if (targetCents <= 0) return 0;
  return Math.min(100, Math.max(0, (cents / targetCents) * 100));
}

/**
 * Funding progress: a teal funded segment plus a striped segment for money held by donors who are
 * paying right now. Both widths animate (about 600 ms) from the old to the new server value, and a
 * bar that becomes `complete` fills up and turns green, unless the user prefers reduced motion.
 */
export function ProgressBar({
  fundedCents,
  heldCents,
  targetCents,
  label,
  size = "md",
  complete = false,
  valueText,
  className,
}: ProgressBarProps) {
  const funded = complete ? 100 : widthPct(fundedCents, targetCents);
  const held = complete ? 0 : Math.min(100 - funded, widthPct(heldCents, targetCents));
  const defaultValueText =
    heldCents > 0
      ? `${formatUsd(fundedCents)} of ${formatUsd(targetCents)} raised, ${formatUsd(heldCents)} being paid now`
      : `${formatUsd(fundedCents)} of ${formatUsd(targetCents)} raised`;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={targetCents}
      aria-valuenow={Math.min(fundedCents, targetCents)}
      aria-valuetext={valueText ?? defaultValueText}
      className={cn("flex overflow-hidden rounded-full bg-track", HEIGHTS[size], className)}
    >
      {/* The same two segments in every state, so a live update animates instead of redrawing. */}
      <div
        className={cn(
          "h-full transition-[width,background-color] duration-600 ease-out motion-reduce:transition-none",
          complete ? "bg-success" : "bg-primary",
        )}
        style={{ width: `${funded}%` }}
      />
      <div
        className="h-full bg-held-stripes transition-[width] duration-600 ease-out motion-reduce:transition-none"
        style={{ width: `${held}%` }}
      />
    </div>
  );
}

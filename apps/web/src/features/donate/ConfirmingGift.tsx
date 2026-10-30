import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

type ConfirmingGiftProps = {
  /** The server's lowered amount when the gift was clamped, so it stays visible while confirming. */
  clampedCents?: number | null;
  className?: string;
};

/** States.dc.html "Confirming payment": covers the whole donate panel while the capture runs. */
export function ConfirmingGift({ clampedCents = null, className }: ConfirmingGiftProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3.5 p-6 text-center", className)}>
      <span
        aria-hidden="true"
        className="size-12 rounded-full border-[5px] border-confirming-track border-t-warning motion-safe:animate-spin"
      />
      <h2 className="text-xl font-extrabold">Confirming your gift…</h2>
      <p className="max-w-70 text-sm leading-normal text-soft">Please don't close this page. It takes a few seconds.</p>
      {clampedCents === null ? null : (
        <p className="max-w-70 rounded-[10px] bg-badge-warning-bg px-3.5 py-2.5 text-sm leading-normal text-badge-warning-text">
          Only <strong>{formatUsd(clampedCents)}</strong> was left, so your gift is{" "}
          <strong>{formatUsd(clampedCents)}</strong>.
        </p>
      )}
    </div>
  );
}

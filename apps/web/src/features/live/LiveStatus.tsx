import { cn } from "@/lib/utils";
import type { LiveUpdates } from "./useLiveUpdates";

type LiveStatusProps = LiveUpdates & {
  /** Lift the pill above a sticky bottom bar (the phone donate bar is about 5 rem tall). */
  aboveBottomBar?: boolean;
};

/**
 * The page's live region for live changes (screen readers only), and the small "Reconnecting live
 * updates…" pill from States.dc.html while the stream is down. Both regions are always mounted, so
 * what appears in them is announced, politely.
 */
export function LiveStatus({ status, announcement, aboveBottomBar = false }: LiveStatusProps) {
  return (
    <>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div
        aria-live="polite"
        className={cn(
          "pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4",
          aboveBottomBar
            ? "bottom-[calc(5.5rem+env(safe-area-inset-bottom))]"
            : "bottom-[max(1rem,env(safe-area-inset-bottom))]",
        )}
      >
        {status === "reconnecting" ? (
          <span className="flex items-center gap-2 rounded-full bg-foreground px-3.5 py-2 text-[13px] font-semibold text-primary-foreground shadow-lg">
            <span aria-hidden="true" className="size-2 rounded-full bg-reconnecting-dot" />
            Reconnecting live updates…
          </span>
        ) : null}
      </div>
    </>
  );
}

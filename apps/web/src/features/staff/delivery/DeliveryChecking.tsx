import { Check, ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { StepCard } from "../manage/StepCard";

/**
 * What the delivery check is doing, paced for the real server (5 to 20 s: the photo check, then the
 * thank-you note when there is one). The server doesn't report progress, so these are estimates;
 * the last one stays until the answer arrives.
 */
export const CHECK_STAGES = [
  { label: "Checking the photo against the product…", done: "Checked the photo", startsAtMs: 0 },
  { label: "Writing a short thank-you for donors…", done: "Wrote the thank-you", startsAtMs: 8_000 },
] as const;

type DeliveryCheckingProps = {
  /** The photo as chosen on this device, or null when there's no local preview. */
  previewUrl: string | null;
  /** Only a note becomes a thank-you, so the second stage shows only with one. */
  withNote: boolean;
};

/** Replaces Step 1 while `POST delivery` runs. */
export function DeliveryChecking({ previewUrl, withNote }: DeliveryCheckingProps) {
  const stages = withNote ? CHECK_STAGES : CHECK_STAGES.slice(0, 1);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!withNote) return;
    const timer = window.setTimeout(() => setCurrent(1), CHECK_STAGES[1].startsAtMs);
    return () => window.clearTimeout(timer);
  }, [withNote]);

  const active = stages[current] ?? CHECK_STAGES[0];

  return (
    <StepCard title="Checking the delivery">
      <div className="flex flex-wrap items-start gap-5 p-4 sm:p-5.5">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="The item as it arrived, being checked"
            className="size-30 shrink-0 rounded-lg border bg-placeholder object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex size-30 shrink-0 items-center justify-center rounded-lg bg-placeholder-strong text-placeholder-icon"
          >
            <ImageIcon className="size-7" strokeWidth={1.5} />
          </div>
        )}
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-4">
          <p aria-live="polite" className="sr-only">
            {active.label}
          </p>
          <ol className="flex flex-col gap-3 text-[15px]">
            {stages.map((stage, index) => {
              const done = index < current;
              const now = index === current;
              return (
                <li
                  key={stage.label}
                  className={cn("flex items-center gap-3", done || now ? "text-foreground" : "text-muted-foreground")}
                >
                  {done ? (
                    <Check aria-hidden="true" className="size-4.5 text-success" strokeWidth={3} />
                  ) : now ? (
                    <span
                      aria-hidden="true"
                      className="size-4.5 rounded-full border-[3px] border-held border-t-primary motion-safe:animate-spin"
                    />
                  ) : (
                    <span aria-hidden="true" className="size-4.5 rounded-full border-2 border-border-strong" />
                  )}
                  <span className={now ? "font-bold" : undefined}>
                    {done ? stage.done : stage.label}
                    {done ? <span className="sr-only"> (done)</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="text-sm text-soft">
            This takes 5 to 20 seconds. Donors see the photo once it passes the check or you confirm it.
          </p>
        </div>
      </div>
    </StepCard>
  );
}

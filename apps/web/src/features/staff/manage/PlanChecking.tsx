import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * What the price check is doing, paced for the real server (5 to 15 s). The server doesn't report
 * progress, so these are estimates; the last one stays until the answer arrives.
 */
export const PLAN_STAGES = [
  { label: "Checking the latest price…", done: "Checked the latest price", startsAtMs: 0 },
  { label: "Comparing offers…", done: "Compared offers", startsAtMs: 4_000 },
  { label: "Working out what happens to the money…", done: "Worked out the money", startsAtMs: 9_000 },
] as const;

/** Replaces Step 1 while `POST purchase-plan` runs. */
export function PlanChecking() {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const timers = PLAN_STAGES.slice(1).map((stage, index) =>
      window.setTimeout(() => setCurrent(index + 1), stage.startsAtMs),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const active = PLAN_STAGES[current] ?? PLAN_STAGES[0];

  return (
    <div className="flex flex-col gap-4 p-5 sm:p-5.5">
      <p aria-live="polite" className="sr-only">
        {active.label}
      </p>
      <ol className="flex flex-col gap-3 text-[15px]">
        {PLAN_STAGES.map((stage, index) => {
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
      <p className="text-sm text-soft">This can take up to 15 seconds. Nothing is bought until you approve.</p>
    </div>
  );
}

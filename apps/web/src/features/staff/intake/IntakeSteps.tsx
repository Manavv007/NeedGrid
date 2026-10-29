import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type IntakeStepNumber = 1 | 2 | 3;

const STEPS = ["Photo or list", "Review", "Publish"] as const;

/** "1 Photo or list ✓ · 2 Review · 3 Publish" (Intake.dc.html). */
export function IntakeSteps({ current }: { current: IntakeStepNumber }) {
  return (
    <ol aria-label="Steps" className="flex flex-wrap items-center gap-2 text-[13px]">
      {STEPS.map((label, index) => {
        const number = index + 1;
        const done = number < current;
        const active = number === current;
        return (
          <li
            key={label}
            aria-current={active ? "step" : undefined}
            className={cn(
              "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3",
              active
                ? "border-primary bg-primary-soft font-bold text-primary"
                : done
                  ? "border-success-border bg-success-soft text-success-strong"
                  : "bg-surface text-muted-foreground",
            )}
          >
            <span aria-hidden="true">{number}</span>
            {label}
            {done ? (
              <>
                <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
                <span className="sr-only">(done)</span>
              </>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

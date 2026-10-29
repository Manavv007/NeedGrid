import { STAFF_URGENCY_LABELS } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { UrgencyLevel } from "./draftRows";

const LEVELS: readonly UrgencyLevel[] = [1, 2, 3];

type UrgencyControlProps = {
  /** Unique per row: the radio group's name. */
  name: string;
  value: UrgencyLevel;
  onChange: (value: UrgencyLevel) => void;
};

/**
 * Low / Medium / Urgent as one segmented control (Intake.dc.html). Native radios underneath, so it
 * is a real radio group: Tab reaches it once, arrow keys change the choice.
 */
export function UrgencyControl({ name, value, onChange }: UrgencyControlProps) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
      <legend className="mb-1.5 text-[13px] font-semibold text-soft">Urgency</legend>
      <div className="grid grid-cols-3 overflow-hidden rounded-md border border-border-strong">
        {LEVELS.map((level) => (
          <label
            key={level}
            className={cn(
              "flex min-h-11 cursor-pointer items-center justify-center border-r border-border-strong px-2 text-sm last:border-r-0",
              "has-checked:bg-primary has-checked:font-bold has-checked:text-primary-foreground",
              "has-focus-visible:outline-3 has-focus-visible:-outline-offset-3 has-focus-visible:outline-ring",
              "bg-surface text-soft hover:bg-placeholder has-checked:hover:bg-primary",
            )}
          >
            <input
              type="radio"
              name={name}
              value={level}
              checked={value === level}
              onChange={() => onChange(level)}
              className="sr-only"
            />
            {STAFF_URGENCY_LABELS[level]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type StepCardProps = {
  title: string;
  /** Right side of the header, e.g. "Price checked 2 min ago" or "Unlocks after approval". */
  note?: ReactNode;
  /** Not available yet: dashed border (PurchasePlan.dc.html Step 2). Text keeps full contrast. */
  locked?: boolean;
  children: ReactNode;
  className?: string;
};

/** One step of the purchase (Step 1 approve, Step 2 buy and mark as ordered), as a labelled section. */
export function StepCard({ title, note, locked = false, children, className }: StepCardProps) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "overflow-hidden rounded-xl bg-surface",
        locked ? "border border-dashed border-border-strong" : "border",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-4 sm:px-5.5">
        <h2 id={id} className="text-lg font-extrabold">
          {title}
        </h2>
        {note ? <span className="text-[13px] text-muted-foreground">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

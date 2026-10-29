import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  title: string;
  message: string;
  /** Defaults to a check mark ("nothing left to do" is good news). */
  icon?: ReactNode;
  /** One button or link, e.g. "See other charities". */
  action?: ReactNode;
  className?: string;
};

/** Every list has one of these (States.dc.html "Empty"): icon + one line + an action. */
export function EmptyState({ title, message, icon, action, className }: EmptyStateProps) {
  return (
    <section
      className={cn(
        "mx-auto flex max-w-md flex-col items-center gap-3.5 rounded-2xl border bg-surface p-6 text-center",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-full bg-badge-success-bg text-success"
      >
        {icon ?? <Check className="size-6.5" strokeWidth={3} />}
      </span>
      <h2 className="text-xl font-extrabold">{title}</h2>
      <p className="max-w-70 text-sm leading-normal text-soft">{message}</p>
      {action}
    </section>
  );
}

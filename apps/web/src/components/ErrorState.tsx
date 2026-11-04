import { CircleAlert, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ErrorTone } from "@/lib/errorCopy";
import { cn } from "@/lib/utils";

type ErrorStateProps = {
  title?: string;
  /** Usually from `errorCopy(error, audience)` (lib/errorCopy.ts), spread together with `tone` (and `title` for a notice). */
  message?: string;
  /** `notice`: a calm "not here yet" (neutral icon, role="status") instead of a red alert. */
  tone?: ErrorTone;
  /** Shows a "Try again" button. */
  onRetry?: () => void;
  className?: string;
};

/** Every query has one of these (States.dc.html "Error"): message + Retry. */
export function ErrorState({
  title = "We couldn't load this",
  message = "Check your connection and try again. Your gifts are safe.",
  tone = "error",
  onRetry,
  className,
}: ErrorStateProps) {
  const notice = tone === "notice";
  return (
    <section
      role={notice ? "status" : "alert"}
      className={cn(
        "mx-auto flex max-w-md flex-col items-center gap-3.5 rounded-2xl border bg-surface p-6 text-center",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-14 items-center justify-center rounded-full",
          notice ? "bg-badge-low-bg text-badge-low-text" : "bg-badge-danger-bg text-danger",
        )}
      >
        {notice ? (
          <Clock className="size-6.5" strokeWidth={2.25} />
        ) : (
          <CircleAlert className="size-6.5" strokeWidth={2.5} />
        )}
      </span>
      <h2 className="text-xl font-extrabold">{title}</h2>
      <p className="max-w-70 text-sm leading-normal text-soft">{message}</p>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </section>
  );
}

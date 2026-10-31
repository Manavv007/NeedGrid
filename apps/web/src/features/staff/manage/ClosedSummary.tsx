import type { TimelineEvent } from "@needgrid/shared";
import { X } from "lucide-react";
import { formatShortDate } from "@/lib/format";

/** `closed`: read-only. The date comes from the server's timeline. */
export function ClosedSummary({ timeline }: { timeline: readonly TimelineEvent[] }) {
  const closed = timeline.find((e) => e.type === "closed") ?? null;
  return (
    <section aria-labelledby="closed-heading" className="flex gap-3 rounded-xl border bg-surface p-4 sm:p-5.5">
      <X aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <h2 id="closed-heading" className="text-lg font-extrabold">
          This need is closed{closed ? ` (${formatShortDate(closed.at)})` : ""}
        </h2>
        <p className="text-[15px] text-soft">
          It&apos;s no longer on your public page and doesn&apos;t take donations. Closed needs can&apos;t be edited.
        </p>
      </div>
    </section>
  );
}

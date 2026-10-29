import type { NeedCard, NeedStatus, TimelineEvent } from "@needgrid/shared";
import { ArrowUp, Check } from "lucide-react";
import { formatShortDate, percentOf } from "@/lib/format";
import { cn } from "@/lib/utils";

export type TimelineStageKey = "posted" | "funded" | "ordered" | "delivered";
/** done → happened · current → happening now · next → what comes next · later → after that. */
export type TimelineStageState = "done" | "current" | "next" | "later";
export type TimelineStage = { key: TimelineStageKey; label: string; state: TimelineStageState; at: string | null };

const STAGES = [
  { key: "posted", event: "created", label: "Posted" },
  { key: "funded", event: "funded", label: "Funded" },
  { key: "ordered", event: "ordered", label: "Ordered" },
  { key: "delivered", event: "delivered", label: "Delivered" },
] as const satisfies ReadonlyArray<{ key: TimelineStageKey; event: TimelineEvent["type"]; label: string }>;

/** The furthest stage each status implies (index into STAGES), in case an event is missing. */
const REACHED: Readonly<Record<NeedStatus, number>> = {
  draft: -1,
  open: 0,
  closed: 0,
  topping_up: 1, // it was funded once; the price went up afterwards
  funded: 1,
  ordered: 2,
  delivered: 3,
};

export type TimelineModel = {
  stages: TimelineStage[];
  /** The tile went back to collecting money after a pricier purchase (shown under "Funded"). */
  priceWentUp: TimelineEvent | null;
  closed: TimelineEvent | null;
};

/**
 * The four stages a need moves through, from the server's timeline (oldest first) and status.
 * Display only: no dates or states are invented, a stage without an event just has no date.
 */
export function timelineModel(status: NeedStatus, events: readonly TimelineEvent[]): TimelineModel {
  const firstOf = (type: TimelineEvent["type"]) => events.find((e) => e.type === type) ?? null;
  const reached = REACHED[status];
  let nextGiven = false;
  const stages = STAGES.map(({ key, event, label }, index): TimelineStage => {
    const at = firstOf(event)?.at ?? null;
    if (at !== null || index <= reached) return { key, label, state: "done", at };
    // Collecting money right now: "Funding · 83%", and Ordered is what comes next.
    if (key === "funded" && status === "open") return { key, label, state: "current", at: null };
    if (nextGiven || status === "closed") return { key, label, state: "later", at: null };
    nextGiven = true;
    return { key, label, state: "next", at: null };
  });
  return {
    stages,
    priceWentUp: status === "topping_up" ? firstOf("topping_up") : null,
    closed: status === "closed" ? firstOf("closed") : null,
  };
}

type TimelineProps = {
  /** Status and funding of the need, exactly as the server sent them. */
  need: Pick<NeedCard, "status" | "fundedCents" | "targetCents">;
  events: readonly TimelineEvent[];
  /** `steps`: four bars in a row (NeedDetail, NeedFunded, ImpactPhone). `list`: a vertical checklist (NeedDelivered). */
  variant?: "steps" | "list";
  /** Accessible name of the list. */
  label?: string;
  className?: string;
};

/** Posted → Funded → Ordered → Delivered, with dates. Reused by the impact page (C-8). */
export function Timeline({ need, events, variant = "steps", label = "Progress", className }: TimelineProps) {
  const { stages, priceWentUp, closed } = timelineModel(need.status, events);
  const stageLabel = (stage: TimelineStage) =>
    stage.state === "current" ? `Funding · ${percentOf(need.fundedCents, need.targetCents)}%` : stage.label;
  const subLabel = (stage: TimelineStage) => {
    if (stage.state === "done") return stage.at ? formatShortDate(stage.at) : "Done";
    if (closed) return null;
    return { current: "Now", next: "Next", later: "Later" }[stage.state];
  };
  const priceNote = priceWentUp ? (
    <span className="flex items-center gap-1 text-xs font-semibold text-badge-warning-text">
      <ArrowUp aria-hidden="true" className="size-3 shrink-0" strokeWidth={3} />
      Price went up · {formatShortDate(priceWentUp.at)}
    </span>
  ) : null;

  return (
    <div className={className}>
      <ol
        aria-label={label}
        className={cn(
          "m-0 list-none p-0",
          variant === "steps" ? "grid grid-cols-4 gap-1.5 sm:gap-2" : "flex flex-col gap-3 text-sm",
        )}
      >
        {stages.map((stage) => {
          const done = stage.state === "done";
          const strong = done || stage.state === "current";
          const sub = subLabel(stage);
          const note = stage.key === "funded" ? priceNote : null;
          return variant === "steps" ? (
            <li
              key={stage.key}
              aria-current={stage.state === "current" ? "step" : undefined}
              className="flex min-w-0 flex-col gap-1.5 sm:gap-2"
            >
              <span aria-hidden="true" className={cn("h-1.5 rounded-full", done ? "bg-primary" : "bg-track")} />
              <span
                className={cn(
                  "flex items-center gap-1.5 text-xs sm:text-sm",
                  strong ? "font-bold text-foreground" : "text-muted-foreground",
                )}
              >
                {done ? (
                  <Check
                    aria-hidden="true"
                    className="hidden size-3.5 shrink-0 text-primary sm:block"
                    strokeWidth={3}
                  />
                ) : null}
                {stageLabel(stage)}
                {done ? <span className="sr-only">, done</span> : null}
              </span>
              {sub ? <span className="text-[11px] text-muted-foreground sm:text-xs">{sub}</span> : null}
              {note}
            </li>
          ) : (
            <li
              key={stage.key}
              aria-current={stage.state === "current" ? "step" : undefined}
              className="flex items-start gap-2.5"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-px flex size-5 shrink-0 items-center justify-center rounded-full",
                  done ? "bg-primary text-primary-foreground" : "border-2 border-border-strong",
                )}
              >
                {done ? <Check className="size-2.75" strokeWidth={3.5} /> : null}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className={strong ? "font-bold" : "text-muted-foreground"}>
                  {stageLabel(stage)}
                  {done ? <span className="sr-only">, done</span> : null}
                </span>
                {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
                {note}
              </span>
            </li>
          );
        })}
      </ol>
      {closed ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Closed {formatShortDate(closed.at)}. This item no longer takes donations.
        </p>
      ) : null}
    </div>
  );
}

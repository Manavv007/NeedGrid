import type { AgentAction } from "@needgrid/shared";
import { Check, ChevronDown, CircleAlert, Clock, X } from "lucide-react";
import { useId, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { WakingUp } from "@/components/WakingUp";
import { formatRelativeTime } from "@/lib/format";
import { useAgentActions } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { outcomeLine, type OutcomeTone } from "./actionText";
import { ApprovalCard } from "./ApprovalCard";

/** Pending approvals are refetched this often while the tab is visible (and whenever staff come back to it). */
export const PENDING_POLL_MS = 30_000;
const RECENT_MAX = 5;

const DECIDED: ReadonlyArray<AgentAction["status"]> = ["executed", "failed", "rejected"];

type PendingActionsProps = {
  orgName: string;
  /** "Ask again" on a failed card: the page puts the original request back in the chat box. */
  onAskAgain: (action: AgentAction) => void;
};

/**
 * "Pending approvals" (Assistant.dc.html, right column): every proposed money action as a compact
 * ApprovalCard (sharing its state with the card in the chat), then the latest decisions. On phones
 * it sits above the chat, collapsed behind a button with the count.
 */
export function PendingActions({ orgName, onAskAgain }: PendingActionsProps) {
  const headingId = useId();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const pending = useAgentActions("proposed", { refetchInterval: PENDING_POLL_MS });
  const count = pending.data?.actions.length ?? null;

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-xl border bg-surface px-4 py-2.5 text-left font-extrabold lg:hidden"
      >
        Pending approvals
        {count !== null ? (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[13px]",
              count > 0 ? "bg-badge-warning-bg text-badge-warning-text" : "bg-track text-soft",
            )}
          >
            {count}
          </span>
        ) : null}
        <ChevronDown aria-hidden="true" className={cn("ml-auto size-4.5 transition-transform", open && "rotate-180")} />
      </button>
      <h2 id={headingId} className="hidden text-base font-extrabold lg:block">
        Pending approvals{count !== null ? ` · ${count}` : ""}
      </h2>

      <div id={panelId} className={cn("flex-col gap-3 lg:flex", open ? "flex" : "hidden")}>
        {pending.data ? (
          pending.data.actions.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {pending.data.actions.map((action) => (
                <li key={action.id}>
                  <ApprovalCard
                    action={action}
                    variant="compact"
                    orgName={orgName}
                    onAskAgain={() => onAskAgain(action)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="Nothing to approve"
              message="When the assistant prepares an invoice or a refund, it waits here for you."
              className="p-5"
            />
          )
        ) : pending.isError ? (
          <ErrorState title="We couldn't load your approvals" onRetry={() => void pending.refetch()} className="p-5" />
        ) : (
          <div role="status" className="flex flex-col gap-3">
            <span className="sr-only">Loading pending approvals…</span>
            <Skeleton aria-hidden="true" className="h-28 w-full rounded-xl" />
            <WakingUp />
          </div>
        )}
        <RecentActions />
      </div>
    </section>
  );
}

const TONE_CLASSES: Readonly<Record<OutcomeTone, string>> = {
  success: "text-success",
  danger: "text-danger",
  muted: "text-muted-foreground",
  info: "text-badge-info-text",
};

const TONE_ICONS = { success: Check, danger: CircleAlert, muted: X, info: Clock } as const;

/** The latest decided actions (executed, failed, rejected), newest first, one line each. */
function RecentActions() {
  const headingId = useId();
  const all = useAgentActions();
  const decided = (all.data?.actions ?? [])
    .filter((action) => DECIDED.includes(action.status))
    .sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt))
    .slice(0, RECENT_MAX);

  if (!all.data) return null;
  return (
    <section aria-labelledby={headingId} className="mt-3 flex flex-col gap-3">
      <h2 id={headingId} className="text-base font-extrabold">
        Recent
      </h2>
      {decided.length === 0 ? (
        <p className="text-sm text-muted-foreground">No decisions yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {decided.map((action) => {
            const { text, tone } = outcomeLine(action);
            const Icon = TONE_ICONS[tone];
            return (
              <li key={action.id} className="flex flex-col gap-1.5 rounded-xl border bg-surface p-3.5">
                <p className="text-sm font-bold">{action.preview.title}</p>
                <p className={cn("flex items-center gap-1.5 text-[13px] font-semibold", TONE_CLASSES[tone])}>
                  <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.5} />
                  {text}
                  {action.decidedAt ? (
                    <span className="font-normal text-muted-foreground">
                      <span aria-hidden="true"> · </span>
                      <time dateTime={action.decidedAt}>{formatRelativeTime(action.decidedAt)}</time>
                    </span>
                  ) : null}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

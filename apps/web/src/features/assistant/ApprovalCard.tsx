import type { ActionPreview, AgentAction } from "@needgrid/shared";
import { Check, CircleAlert, LoaderCircle, X } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { InvoiceQrDialog } from "@/features/invoices/InvoiceQrDialog";
import { PayerLink } from "@/features/invoices/PayerLink";
import { formatRelativeTime, formatUsd } from "@/lib/format";
import { STAFF_INVOICES_PATH } from "@/lib/links";
import { useAgentActions, useInvoices, useLatestAction } from "@/lib/queries";
import { cn } from "@/lib/utils";
import {
  approveLabel,
  executedHeadline,
  invoiceFromResult,
  isInvoiceTool,
  matchInvoice,
  titleWithTotal,
  TOOL_META,
} from "./actionText";
import { useActionDecision } from "./useActionDecision";

/** While an approved action is still running on the server, check on it this often. */
export const APPROVED_POLL_MS = 2_000;

type ApprovalCardProps = {
  action: AgentAction;
  /** `inline` in the chat; `compact` in the pending approvals list. Both share one state per action. */
  variant?: "inline" | "compact";
  /** The charity being paid, for the QR dialog ("Pay Harbor Food Bank"). */
  orgName: string;
  /** "Ask again" on a failed action: put the original request back in the chat box. */
  onAskAgain?: () => void;
};

/**
 * The trust UI (brief §9.10, Assistant.dc.html, Reconcile.dc.html, AssistantStates.dc.html): every
 * line the server prepared, its total, and a human decision. Only `preview` and the outcome are
 * shown, never the raw args or computed JSON, and everything is plain text. The card always shows
 * the newest state this tab knows for the action, wherever it is shown.
 */
export function ApprovalCard({ action: snapshot, variant = "inline", orgName, onAskAgain }: ApprovalCardProps) {
  const action = useLatestAction(snapshot);
  const compact = variant === "compact";
  switch (action.status) {
    case "proposed":
      return <ProposedCard action={action} compact={compact} />;
    case "approved":
      return <WorkingCard action={action} compact={compact} />;
    case "executed":
      return <ExecutedCard action={action} compact={compact} orgName={orgName} />;
    case "failed":
      return <FailedCard action={action} compact={compact} onAskAgain={onAskAgain} />;
    case "rejected":
      return <RejectedCard action={action} compact={compact} />;
  }
}

type CardProps = { action: AgentAction; compact: boolean };

const TONES = {
  warning: { card: "border-2 border-warning", header: "bg-badge-warning-bg text-badge-warning-text" },
  success: { card: "border-2 border-success", header: "bg-badge-success-bg text-badge-success-text" },
  danger: { card: "border-2 border-danger", header: "bg-badge-danger-bg text-badge-danger-text" },
  info: { card: "border-2 border-badge-info-text", header: "bg-badge-info-bg text-badge-info-text" },
} as const;

type Tone = keyof typeof TONES;

type FrameProps = {
  action: AgentAction;
  tone: Tone;
  icon: ReactNode;
  status: string;
  titleId: string;
  compact: boolean;
  children: ReactNode;
};

/** Coloured header (status text + icon, never colour alone), then the body. */
function Frame({ action, tone, icon, status, titleId, compact, children }: FrameProps) {
  return (
    <article aria-labelledby={titleId} className={cn("overflow-hidden rounded-xl bg-surface", TONES[tone].card)}>
      <div
        className={cn(
          "flex flex-wrap items-center gap-2.5",
          compact ? "px-3.5 py-2.5" : "px-4 py-3",
          TONES[tone].header,
        )}
      >
        {icon}
        <span className="text-[13px] font-extrabold tracking-[0.05em] uppercase">{status}</span>
        {action.origin === "system" ? (
          <span className="ml-auto rounded-full bg-surface/80 px-2 py-0.5 text-xs font-semibold text-soft">
            Created by NeedGrid
          </span>
        ) : null}
      </div>
      <div className={cn("flex flex-col", compact ? "gap-3 p-3.5" : "gap-3.5 p-4 sm:px-4.5")}>{children}</div>
    </article>
  );
}

function CardTitle({
  id,
  compact,
  muted,
  children,
}: {
  id: string;
  compact: boolean;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <h3 id={id} className={cn("font-extrabold", compact ? "text-[15px]" : "text-lg", muted && "text-soft")}>
      {children}
    </h3>
  );
}

function ToolIcon({ action }: { action: AgentAction }) {
  const { icon: Icon, label } = TOOL_META[action.tool];
  return (
    <>
      <Icon aria-hidden="true" className="size-4.5" strokeWidth={2.2} />
      <span className="sr-only">{label}:</span>
    </>
  );
}

/** Every line exactly as the server sent it, then the total (when there is one). */
function PreviewLines({ preview, compact }: { preview: ActionPreview; compact: boolean }) {
  return (
    <>
      <table className={cn("w-full border-collapse", compact ? "text-[13px]" : "text-sm")}>
        <tbody>
          {preview.lines.map((line, i) => (
            <tr key={i} className="border-t border-track">
              <th scope="row" className="w-[42%] py-2 pr-3 text-left align-top font-medium text-muted-foreground">
                {line.label}
              </th>
              <td className="py-2 align-top font-semibold break-words">{line.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {preview.totalCents !== null ? (
        <p className="flex items-baseline justify-between gap-3 border-t-2 border-foreground pt-2.5">
          <span className="text-sm font-bold">Total</span>
          <span className={cn("font-extrabold tracking-[-0.02em]", compact ? "text-xl" : "text-[28px]")}>
            {formatUsd(preview.totalCents)}
          </span>
        </p>
      ) : null}
    </>
  );
}

function Spinner() {
  return <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />;
}

/** Needs your approval: the lines, the total, the promise, and Approve / Reject (each sent at most once). */
function ProposedCard({ action, compact }: CardProps) {
  const titleId = useId();
  const { decide, pending, pendingDecision, problem } = useActionDecision(action);
  return (
    <Frame
      action={action}
      tone="warning"
      icon={<ToolIcon action={action} />}
      status="Needs your approval"
      titleId={titleId}
      compact={compact}
    >
      <div className="flex flex-col gap-1">
        <CardTitle id={titleId} compact={compact}>
          {action.preview.title}
        </CardTitle>
        {compact ? (
          <p className="text-[13px] text-muted-foreground">
            Proposed <time dateTime={action.createdAt}>{formatRelativeTime(action.createdAt)}</time>
          </p>
        ) : null}
      </div>
      <PreviewLines preview={action.preview} compact={compact} />
      <p className="text-[13px] leading-normal text-soft">
        Nothing happens until you approve. Amounts were calculated by NeedGrid, not the AI.
      </p>
      <div className="flex flex-wrap gap-2.5">
        <Button
          size="lg"
          onClick={() => void decide("approve")}
          disabled={pending}
          aria-describedby={titleId}
          className="h-12 flex-[1_1_160px] font-extrabold"
        >
          {pendingDecision === "approve" ? (
            <>
              <Spinner />
              Approving…
            </>
          ) : (
            approveLabel(action)
          )}
        </Button>
        <Button
          size="lg"
          variant="outline"
          onClick={() => void decide("reject")}
          disabled={pending}
          aria-describedby={titleId}
          className="h-12 flex-[1_1_120px]"
        >
          {pendingDecision === "reject" ? (
            <>
              <Spinner />
              Rejecting…
            </>
          ) : (
            "Reject"
          )}
        </Button>
      </div>
      {problem ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {problem}
        </p>
      ) : null}
    </Frame>
  );
}

/** Approved, still running on the server (rare): poll the actions until it settles. */
function WorkingCard({ action, compact }: CardProps) {
  const titleId = useId();
  useAgentActions(undefined, { refetchInterval: APPROVED_POLL_MS });
  return (
    <Frame
      action={action}
      tone="info"
      icon={<LoaderCircle aria-hidden="true" className="size-4.5 motion-safe:animate-spin" />}
      status="Approved, working…"
      titleId={titleId}
      compact={compact}
    >
      <CardTitle id={titleId} compact={compact}>
        {titleWithTotal(action)}
      </CardTitle>
      <p role="status" className="text-sm text-soft">
        NeedGrid is carrying it out. This usually takes a few seconds.
      </p>
    </Frame>
  );
}

/** Executed: green, and for invoices the payer link and the QR code. */
function ExecutedCard({ action, compact, orgName }: CardProps & { orgName: string }) {
  const titleId = useId();
  const fromResult = invoiceFromResult(action);
  const lookUp = isInvoiceTool(action.tool) && fromResult === null;
  const invoices = useInvoices({ enabled: lookUp });
  const invoice = fromResult ?? (lookUp && invoices.data ? matchInvoice(action, invoices.data.invoices) : null);

  return (
    <Frame
      action={action}
      tone="success"
      icon={<Check aria-hidden="true" className="size-4.5" strokeWidth={3} />}
      status={executedHeadline(action, invoice)}
      titleId={titleId}
      compact={compact}
    >
      <div className="flex flex-wrap items-center gap-5">
        <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-2.5">
          <CardTitle id={titleId} compact={compact}>
            {titleWithTotal(action)}
          </CardTitle>
          {invoice ? (
            <>
              <p className="text-sm text-soft">
                {invoice.status === "draft"
                  ? `Saved as a draft for ${invoice.recipientEmail}. It hasn't been sent.`
                  : `Sent to ${invoice.recipientEmail}. When they pay, ${
                      invoice.needIds.length === 1
                        ? "the tile fills up on its own."
                        : `all ${invoice.needIds.length} tiles fill up on their own.`
                    }`}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <PayerLink url={invoice.payerViewUrl} />
                <Link to={STAFF_INVOICES_PATH} className="inline-flex min-h-11 items-center px-1 text-sm font-bold">
                  See all invoices
                </Link>
              </div>
            </>
          ) : lookUp && invoices.isPending ? (
            <p role="status" className="text-sm text-soft">
              Getting the payment link…
            </p>
          ) : (
            <p className="text-sm text-soft">
              {isInvoiceTool(action.tool) ? (
                <>
                  The payment link is on the <Link to={STAFF_INVOICES_PATH}>Invoices page</Link>.
                </>
              ) : (
                "Done. NeedGrid carried out exactly what you approved."
              )}
            </p>
          )}
        </div>
        {invoice ? (
          <InvoiceQrDialog invoice={invoice} orgName={orgName} thumbnailClassName={compact ? "size-22" : "size-30"} />
        ) : null}
      </div>
    </Frame>
  );
}

/** Failed: the server's reason (plain text) and "Ask again". */
function FailedCard({ action, compact, onAskAgain }: CardProps & { onAskAgain?: () => void }) {
  const titleId = useId();
  return (
    <Frame
      action={action}
      tone="danger"
      icon={<CircleAlert aria-hidden="true" className="size-4.5" strokeWidth={2.5} />}
      status="Didn't go through"
      titleId={titleId}
      compact={compact}
    >
      <CardTitle id={titleId} compact={compact}>
        {action.preview.title}
      </CardTitle>
      <p className="text-sm leading-normal text-soft">
        {action.error ?? "It couldn't be carried out."}
        {isInvoiceTool(action.tool) ? " Nothing was sent." : ""}
      </p>
      {onAskAgain ? (
        <Button variant="outline" onClick={onAskAgain} className="self-start">
          Ask again
        </Button>
      ) : null}
    </Frame>
  );
}

/** Rejected: quiet, nothing ran. */
function RejectedCard({ action, compact }: CardProps) {
  const titleId = useId();
  return (
    <article
      aria-labelledby={titleId}
      className={cn("flex flex-col gap-1.5 rounded-xl border bg-surface", compact ? "p-3.5" : "px-4.5 py-4")}
    >
      <CardTitle id={titleId} compact={compact} muted>
        {titleWithTotal(action)}
      </CardTitle>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <X aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
        Rejected, nothing was sent.
      </p>
    </article>
  );
}

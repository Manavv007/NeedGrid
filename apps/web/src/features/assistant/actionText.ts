import {
  CreateInvoiceArgs,
  formatUsd,
  SendInvoiceArgs,
  SponsorInvoiceView,
  type AgentAction,
  type MoneyTool,
} from "@needgrid/shared";
import { ReceiptText, Send, Undo2, type LucideIcon } from "lucide-react";

/** The icon and plain name of each money tool (the card header). */
export const TOOL_META: Readonly<Record<MoneyTool, { icon: LucideIcon; label: string }>> = {
  create_invoice: { icon: ReceiptText, label: "Invoice" },
  send_invoice: { icon: Send, label: "Send an invoice" },
  create_refund: { icon: Undo2, label: "Refund" },
};

export const isInvoiceTool = (tool: MoneyTool) => tool === "create_invoice" || tool === "send_invoice";

/** Whether approving sends something out: a send_invoice, or a create_invoice whose args say `send: true`. */
export const sendsOnApproval = (action: AgentAction) =>
  action.tool === "send_invoice" || (action.tool === "create_invoice" && action.args.send === true);

/** "Approve and send" for an invoice that is sent on approval (args.send === true), else "Approve". */
export const approveLabel = (action: AgentAction) =>
  action.tool === "create_invoice" && action.args.send === true ? "Approve and send" : "Approve";

/** The executed invoice in `result`, when it is one (`SponsorInvoiceView`, nothing hand-checked). */
export function invoiceFromResult(action: AgentAction): SponsorInvoiceView | null {
  const parsed = SponsorInvoiceView.safeParse(action.result);
  return parsed.success ? parsed.data : null;
}

/**
 * When `result` isn't an invoice: the one this action made, from the invoices list. send_invoice
 * names it; create_invoice → the newest invoice to the same recipient, made after the approval, for
 * needs the action named.
 */
export function matchInvoice(action: AgentAction, invoices: readonly SponsorInvoiceView[]): SponsorInvoiceView | null {
  if (action.tool === "send_invoice") {
    const args = SendInvoiceArgs.safeParse(action.args);
    return args.success ? (invoices.find((i) => i.id === args.data.sponsorInvoiceId) ?? null) : null;
  }
  const args = CreateInvoiceArgs.safeParse(action.args);
  if (action.tool !== "create_invoice" || !args.success) return null;
  const needIds = new Set(args.data.needIds);
  const since = action.decidedAt ?? action.createdAt;
  return (
    invoices
      .filter(
        (i) =>
          i.recipientEmail === args.data.recipientEmail &&
          i.createdAt >= since &&
          i.needIds.every((id) => needIds.has(id)),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  );
}

/** Green header of an executed action. */
export function executedHeadline(action: AgentAction, invoice: SponsorInvoiceView | null): string {
  if (!isInvoiceTool(action.tool)) return "Approved";
  if (invoice) return invoice.status === "draft" ? "Approved, saved as a draft" : "Approved and sent";
  return sendsOnApproval(action) ? "Approved and sent" : "Approved";
}

/** "Invoice Acme Hardware for 4 items · $203.00" (decided cards show the amount next to the title). */
export const titleWithTotal = (action: AgentAction) =>
  action.preview.totalCents === null
    ? action.preview.title
    : `${action.preview.title} · ${formatUsd(action.preview.totalCents)}`;

export type OutcomeTone = "success" | "danger" | "muted" | "info";

/** One line for the "Recent" list: "Sent · $148.00", "Rejected · nothing was sent", … */
export function outcomeLine(action: AgentAction): { text: string; tone: OutcomeTone } {
  const total = action.preview.totalCents === null ? "" : ` · ${formatUsd(action.preview.totalCents)}`;
  switch (action.status) {
    case "executed":
      return { text: `${sendsOnApproval(action) ? "Sent" : "Approved"}${total}`, tone: "success" };
    case "failed":
      return { text: "Didn't go through", tone: "danger" };
    case "rejected":
      return { text: "Rejected · nothing was sent", tone: "muted" };
    case "approved":
      return { text: "Approved, working…", tone: "info" };
    case "proposed":
      return { text: `Waiting for approval${total}`, tone: "info" };
  }
}

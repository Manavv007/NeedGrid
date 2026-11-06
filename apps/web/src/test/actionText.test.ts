import type { AgentAction, SponsorInvoiceView } from "@needgrid/shared";
import { describe, expect, it } from "vitest";
import {
  approveLabel,
  executedHeadline,
  invoiceFromResult,
  outcomeLine,
  sendsOnApproval,
} from "@/features/assistant/actionText";

const NEED_ID = "4c1f7a2e-9b3d-4e5f-8a6b-000000000301";

/** A proposed create_invoice whose args are exactly `args` (as the server stored them). */
function invoiceAction(args: Record<string, unknown>): AgentAction {
  return {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-0000000000a1",
    tool: "create_invoice",
    args: { needIds: [NEED_ID], recipientEmail: "sponsor@example.com", ...args },
    computed: {},
    preview: { title: "Invoice sponsor@example.com for 1 item", lines: [], totalCents: 4800 },
    status: "proposed",
    origin: "assistant",
    result: null,
    error: null,
    createdAt: "2026-11-05T10:00:00.000Z",
    decidedAt: null,
    executedAt: null,
  };
}

describe("invoiceFromResult: the executed invoice in `result`", () => {
  const invoice: SponsorInvoiceView = {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-0000000000f1",
    paypalInvoiceId: "INV2-AAAA-BBBB-CCCC-DDDD",
    recipientEmail: "sponsor@example.com",
    recipientName: null,
    needIds: [NEED_ID],
    amountCents: 4800,
    status: "draft",
    payerViewUrl: null,
    qrImageDataUrl: null, // QR codes only exist for sent invoices
    createdAt: "2026-11-05T10:01:00.000Z",
  };
  const executed = (result: unknown): AgentAction => ({
    ...invoiceAction({ send: false }),
    status: "executed",
    result,
  });

  it("A's CreateInvoiceResult `{ sponsorInvoice }`", () => {
    expect(invoiceFromResult(executed({ sponsorInvoice: invoice }))).toEqual(invoice);
  });

  it("a bare SponsorInvoiceView still works", () => {
    expect(invoiceFromResult(executed(invoice))).toEqual(invoice);
  });

  it("anything else is no invoice (the card then looks it up in the invoices list)", () => {
    for (const result of [null, { invoiceId: "elsewhere" }, { sponsorInvoice: { id: "x" } }, "INV2-AAAA"]) {
      expect(invoiceFromResult(executed(result))).toBeNull();
    }
  });
});

describe("actionText: CreateInvoiceArgs.send defaults to true", () => {
  it('send missing: the invoice is sent on approval, so the button says "Approve and send"', () => {
    const action = invoiceAction({});
    expect("send" in action.args).toBe(false);
    expect(sendsOnApproval(action)).toBe(true);
    expect(approveLabel(action)).toBe("Approve and send");
  });

  it('send: true: "Approve and send"', () => {
    const action = invoiceAction({ send: true });
    expect(sendsOnApproval(action)).toBe(true);
    expect(approveLabel(action)).toBe("Approve and send");
  });

  it('send: false: only created, so the button says "Approve"', () => {
    const action = invoiceAction({ send: false });
    expect(sendsOnApproval(action)).toBe(false);
    expect(approveLabel(action)).toBe("Approve");
  });

  it("an executed invoice without `send` reads as sent everywhere", () => {
    const action: AgentAction = { ...invoiceAction({}), status: "executed" };
    expect(executedHeadline(action, null)).toBe("Approved and sent");
    expect(outcomeLine(action).text).toBe("Sent · $48.00");
  });

  it('a refund is never "sent": "Approve"', () => {
    const refund: AgentAction = {
      ...invoiceAction({}),
      tool: "create_refund",
      args: { donationId: NEED_ID, reason: "Duplicate gift" },
    };
    expect(sendsOnApproval(refund)).toBe(false);
    expect(approveLabel(refund)).toBe("Approve");
  });
});

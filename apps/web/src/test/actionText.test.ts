import type { AgentAction } from "@needgrid/shared";
import { describe, expect, it } from "vitest";
import { approveLabel, executedHeadline, outcomeLine, sendsOnApproval } from "@/features/assistant/actionText";

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

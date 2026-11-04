/**
 * PayPal capture refunds (AGENT_A_BACKEND.md §8.8): POST /v2/payments/captures/{captureId}/refund.
 * The request id is `refund-<actionId>`, so retrying the same approved action can never refund twice.
 * Swappable in tests via setRefundsGateway.
 */
import { centsToPayPalValue, payPalValueToCents } from "@needgrid/shared";
import { z } from "zod";
import { paypalFetch } from "./client";

export interface RefundCaptureInput {
  actionId: string;
  captureId: string;
  amountCents: number;
  /** Shown to the donor in PayPal (≤ 255 characters). */
  noteToPayer: string;
}

export interface RefundResult {
  refundId: string;
  /** COMPLETED, PENDING, FAILED or CANCELLED. */
  status: string;
  amountCents: number;
}

export interface RefundsGateway {
  refundCapture(input: RefundCaptureInput): Promise<RefundResult>;
}

const RefundSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: z.object({ value: z.string(), currency_code: z.string() }).optional(),
});

export const realRefundsGateway: RefundsGateway = {
  async refundCapture(input) {
    const { data } = await paypalFetch("POST", `/v2/payments/captures/${encodeURIComponent(input.captureId)}/refund`, {
      requestId: `refund-${input.actionId}`,
      body: {
        amount: { currency_code: "USD", value: centsToPayPalValue(input.amountCents) },
        note_to_payer: input.noteToPayer.slice(0, 255),
      },
    });
    const r = RefundSchema.parse(data);
    return {
      refundId: r.id,
      status: r.status,
      amountCents: r.amount ? payPalValueToCents(r.amount.value) : input.amountCents,
    };
  },
};

let current: RefundsGateway = realRefundsGateway;
export const refundsGateway = () => current;
/** Tests only. */
export function setRefundsGateway(g: RefundsGateway): void {
  current = g;
}

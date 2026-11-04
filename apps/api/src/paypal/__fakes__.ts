/**
 * In-memory stand-in for PayPal Orders v2, for tests. Mirrors the real gateway's behaviour:
 * - capture before approval → 409 INVALID_STATE (ORDER_NOT_APPROVED)
 * - capturing twice returns the same capture (idempotent)
 */
import { HttpError } from "../lib/http";
import { PayPalApiError } from "./client";
import type { CreateInvoiceInput, InvoicesGateway } from "./invoices";
import type { CapturedOrder, CreateOrderInput, OrdersGateway } from "./orders";
import type { RefundCaptureInput, RefundResult, RefundsGateway } from "./refunds";

interface FakeOrder {
  input: CreateOrderInput;
  approved: boolean;
  payer: { givenName: string | null; email: string | null };
  captured: CapturedOrder | null;
}

export class FakePayPalOrders implements OrdersGateway {
  orders = new Map<string, FakeOrder>();
  createCalls = 0;
  captureCalls = 0;
  /** Set to make the next createOrder fail like a PayPal outage. */
  failNextCreate = false;
  /** Capture status to return (e.g. "DECLINED"). */
  captureStatus = "COMPLETED";
  private seq = 0;

  async createOrder(input: CreateOrderInput) {
    this.createCalls++;
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new PayPalApiError("PayPal request failed: fake outage", 503, "SERVICE_UNAVAILABLE", [], "fake-debug-id");
    }
    const orderId = `FAKEORDER${String(++this.seq).padStart(8, "0")}`;
    this.orders.set(orderId, { input, approved: false, payer: { givenName: null, email: null }, captured: null });
    return { orderId, status: "PAYER_ACTION_REQUIRED" };
  }

  /** Simulates the donor approving the payment in the PayPal popup. */
  approve(orderId: string, payer: { givenName?: string; email?: string } = {}) {
    const o = this.orders.get(orderId);
    if (!o) throw new Error(`fake: unknown order ${orderId}`);
    o.approved = true;
    o.payer = { givenName: payer.givenName ?? "Jamie", email: payer.email ?? "jamie@example.com" };
  }

  async captureOrder(orderId: string): Promise<CapturedOrder> {
    this.captureCalls++;
    const o = this.orders.get(orderId);
    if (!o) throw new HttpError(404, "NOT_FOUND", "PayPal order not found");
    if (o.captured) return o.captured;
    if (!o.approved) {
      throw new HttpError(409, "INVALID_STATE", "The payment hasn't been approved in PayPal yet", {
        paypalIssue: "ORDER_NOT_APPROVED",
      });
    }
    o.captured = {
      orderId,
      status: "COMPLETED",
      capture: {
        id: `FAKECAPTURE${orderId.slice(-8)}`,
        status: this.captureStatus,
        amountCents: o.input.amountCents,
        currency: "USD",
      },
      payer: o.payer,
      customId: o.input.reservationId,
    };
    return o.captured;
  }
}

const outage = () =>
  new PayPalApiError("PayPal request failed: fake outage", 503, "SERVICE_UNAVAILABLE", [], "fake-debug-id");

/** A tiny valid-looking PNG data URL for tests. */
export const FAKE_QR =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** In-memory PayPal Invoicing v2. `fail` makes the named step throw once, like an outage. */
export class FakePayPalInvoices implements InvoicesGateway {
  invoices = new Map<
    string,
    { input: CreateInvoiceInput; status: string; paidCents?: number; transactionId?: string }
  >();
  calls: string[] = [];
  fail: { create?: boolean; send?: boolean; qr?: boolean; get?: boolean } = {};
  /** When a send fails, whether PayPal actually sent it anyway (an ambiguous failure). */
  sendFailsButSent = false;
  private seq = 0;

  private take(step: keyof FakePayPalInvoices["fail"]) {
    if (!this.fail[step]) return false;
    this.fail[step] = false;
    return true;
  }

  async createInvoice(input: CreateInvoiceInput) {
    this.calls.push("create");
    if (this.take("create")) throw outage();
    const invoiceId = `INV2-FAKE-${String(++this.seq).padStart(4, "0")}`;
    this.invoices.set(invoiceId, { input, status: "DRAFT" });
    return { invoiceId };
  }

  async sendInvoice(invoiceId: string) {
    this.calls.push("send");
    const inv = this.invoices.get(invoiceId);
    if (!inv) throw new PayPalApiError("PayPal request failed: not found", 404, "RESOURCE_NOT_FOUND", [], null);
    if (this.take("send")) {
      if (this.sendFailsButSent) inv.status = "SENT";
      throw outage();
    }
    inv.status = "SENT";
    return { payerViewUrl: `https://www.sandbox.paypal.com/invoice/p/#${invoiceId}` };
  }

  async getInvoiceStatus(invoiceId: string) {
    this.calls.push("get");
    if (this.take("get")) throw outage();
    const inv = this.invoices.get(invoiceId);
    if (!inv) throw new PayPalApiError("PayPal request failed: not found", 404, "RESOURCE_NOT_FOUND", [], null);
    return {
      status: inv.status,
      payerViewUrl: inv.status === "DRAFT" ? null : `https://www.sandbox.paypal.com/invoice/p/#${invoiceId}`,
      paidCents: inv.paidCents ?? null,
      transactionId: inv.transactionId ?? null,
    };
  }

  /** Simulates the sponsor paying the invoice in PayPal (defaults to the full amount). */
  pay(invoiceId: string, cents?: number) {
    const inv = this.invoices.get(invoiceId);
    if (!inv) throw new Error(`fake: unknown invoice ${invoiceId}`);
    inv.status = "PAID";
    inv.paidCents = cents ?? inv.input.items.reduce((s, i) => s + i.amountCents, 0);
    inv.transactionId = `FAKEPAY${invoiceId.slice(-4)}`;
  }

  async generateQrCode(invoiceId: string) {
    this.calls.push("qr");
    if (this.take("qr")) throw outage();
    if (this.invoices.get(invoiceId)?.status !== "SENT") {
      throw new PayPalApiError("PayPal request failed: invoice not sent", 422, "UNPROCESSABLE_ENTITY", [], null);
    }
    return FAKE_QR;
  }

  async deleteDraft(invoiceId: string) {
    this.calls.push("delete");
    this.invoices.delete(invoiceId);
  }
}

/** In-memory capture refunds. Same request id (action id) → same refund, like PayPal-Request-Id. */
export class FakePayPalRefunds implements RefundsGateway {
  refunds = new Map<string, RefundCaptureInput & RefundResult>();
  calls: RefundCaptureInput[] = [];
  failNext = false;
  status = "COMPLETED";

  async refundCapture(input: RefundCaptureInput): Promise<RefundResult> {
    this.calls.push(input);
    if (this.failNext) {
      this.failNext = false;
      throw outage();
    }
    const existing = this.refunds.get(input.actionId);
    if (existing) return { refundId: existing.refundId, status: existing.status, amountCents: existing.amountCents };
    const r = { refundId: `FAKEREFUND${this.refunds.size + 1}`, status: this.status, amountCents: input.amountCents };
    this.refunds.set(input.actionId, { ...input, ...r });
    return r;
  }
}

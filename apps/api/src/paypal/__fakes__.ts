/**
 * In-memory stand-in for PayPal Orders v2, for tests. Mirrors the real gateway's behaviour:
 * - capture before approval → 409 INVALID_STATE (ORDER_NOT_APPROVED)
 * - capturing twice returns the same capture (idempotent)
 */
import { HttpError } from "../lib/http";
import { PayPalApiError } from "./client";
import type { CapturedOrder, CreateOrderInput, OrdersGateway } from "./orders";

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

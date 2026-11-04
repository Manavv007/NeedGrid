/** Invoicing v2 request/response helpers. Response samples copied from a real sandbox call (Nov 4, 2026). */
import { describe, expect, it } from "vitest";
import { buildCreateInvoiceBody, invoiceIdFromCreate, invoiceStateOf, payerViewUrlOf, qrDataUrlFrom } from "./invoices";

const PNG_B64 = `iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ${"A".repeat(80)}ErkJggg==`;

describe("PayPal invoices", () => {
  it("builds one AMOUNT line per need, no tips, no partial payments", () => {
    const body = buildCreateInvoiceBody({
      sponsorInvoiceId: "11111111-1111-4111-8111-111111111111",
      orgName: "Harbor Food Bank",
      recipientEmail: "sponsor@acme.example",
      recipientName: "Acme Hardware",
      note: null,
      items: [
        { title: "Winter coat, size 8", amountCents: 4500 },
        { title: "Winter coat, size 10", amountCents: 3005 },
      ],
    });
    expect(body.detail).toEqual({
      currency_code: "USD",
      reference: "11111111-1111-4111-8111-111111111111",
      memo: "NeedGrid sponsor invoice",
    });
    expect(body.primary_recipients[0]!.billing_info).toEqual({
      email_address: "sponsor@acme.example",
      business_name: "Acme Hardware",
    });
    expect(body.items.map((i) => i.unit_amount.value)).toEqual(["45.00", "30.05"]);
    expect(body.items[0]).toMatchObject({ quantity: "1", unit_of_measure: "AMOUNT" });
    expect(body.configuration).toEqual({ allow_tip: false, partial_payment: { allow_partial_payment: false } });
  });

  it("reads the invoice id from the full invoice or from a link", () => {
    expect(invoiceIdFromCreate({ id: "INV2-AAAA", status: "DRAFT" })).toBe("INV2-AAAA");
    expect(
      invoiceIdFromCreate({ href: "https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-BBBB", rel: "self" }),
    ).toBe("INV2-BBBB");
    expect(() => invoiceIdFromCreate({})).toThrow(/invoice id/);
  });

  it("finds the payer link in the send response or the invoice metadata", () => {
    const send = { href: "https://www.sandbox.paypal.com/invoice/p/#INV2-9LLG", rel: "payer-view", method: "GET" };
    expect(payerViewUrlOf(send)).toBe(send.href);
    expect(payerViewUrlOf({ detail: { metadata: { recipient_view_url: "https://x.example/p" } } })).toBe(
      "https://x.example/p",
    );
    expect(payerViewUrlOf(null)).toBeNull();
  });

  it("reads status, paid amount and the latest payment id from GET invoice", () => {
    expect(
      invoiceStateOf({
        id: "INV2-9LLG",
        status: "PAID",
        payments: {
          paid_amount: { currency_code: "USD", value: "75.00" },
          transactions: [{ payment_id: "PAY-1", payment_date: "2026-11-05" }],
        },
        detail: { metadata: { recipient_view_url: "https://www.sandbox.paypal.com/invoice/p/#9LLG" } },
      }),
    ).toEqual({
      status: "PAID",
      paidCents: 7500,
      transactionId: "PAY-1",
      payerViewUrl: "https://www.sandbox.paypal.com/invoice/p/#9LLG",
    });
    expect(invoiceStateOf({ status: "SENT" })).toMatchObject({ status: "SENT", paidCents: null, transactionId: null });
    expect(() =>
      invoiceStateOf({ status: "PAID", payments: { paid_amount: { currency_code: "EUR", value: "1" } } }),
    ).toThrow(/currency/);
  });

  it("extracts the PNG from PayPal's multipart QR response", () => {
    const multipart =
      "--9f1485d4-b8f2-438f-8bcd-c464e6481b76\r\n" +
      'Content-Disposition: form-data; name="image"\r\nContent-Type: text/plain\r\n\r\n' +
      `${PNG_B64}\r\n--9f1485d4-b8f2-438f-8bcd-c464e6481b76--\r\n`;
    expect(qrDataUrlFrom(multipart)).toBe(`data:image/png;base64,${PNG_B64}`);
    expect(qrDataUrlFrom(PNG_B64)).toBe(`data:image/png;base64,${PNG_B64}`);
    expect(() => qrDataUrlFrom("<html>nope</html>")).toThrow(/unexpected format/);
  });
});

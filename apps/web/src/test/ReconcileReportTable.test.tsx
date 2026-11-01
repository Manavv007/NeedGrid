import type { ReconcileReport } from "@needgrid/shared";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReconcileReportTable } from "@/features/assistant/ReconcileReportTable";

const PERIOD = { periodStart: "2026-10-21T12:00:00.000Z", periodEnd: "2026-10-27T12:00:00.000Z" };

const okReport: ReconcileReport = {
  ...PERIOD,
  paypalTotalCents: 61_200,
  recordedTotalCents: 61_200,
  matchedCount: 31,
  mismatches: [],
  ok: true,
};

const badReport: ReconcileReport = {
  ...PERIOD,
  paypalTotalCents: 63_700,
  recordedTotalCents: 60_700,
  matchedCount: 30,
  mismatches: [
    {
      kind: "missing_in_records",
      paypalTransactionId: "8XK29D4L1M0P7741Q",
      donationId: null,
      paypalCents: 2_500,
      recordedCents: null,
    },
    {
      kind: "amount_mismatch",
      paypalTransactionId: "3MP9AB12CD34EF07C",
      donationId: "4c1f7a2e-9b3d-4e5f-8a6b-0000000000aa",
      paypalCents: 4_000,
      recordedCents: 3_500,
    },
    { kind: "missing_in_paypal", paypalTransactionId: null, donationId: null, paypalCents: null, recordedCents: 1_000 },
  ],
  ok: false,
};

const cells = (row: HTMLElement) =>
  within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent);

describe("ReconcileReportTable", () => {
  it("everything matches: a green banner, the period, both totals and the matched count", () => {
    render(<ReconcileReportTable report={okReport} />);
    const report = screen.getByRole("region", { name: "Everything matches" });
    expect(within(report).getByRole("rowheader", { name: "Period" }).nextElementSibling).toHaveTextContent(
      "Oct 21 to Oct 27",
    );
    expect(within(report).getByRole("row", { name: /PayPal total/ })).toHaveTextContent("$612.00");
    expect(within(report).getByRole("row", { name: /Our records/ })).toHaveTextContent("$612.00");
    expect(within(report).getByRole("row", { name: /Payments matched/ })).toHaveTextContent("31 of 31");
    expect(within(report).queryByRole("region", { name: "What doesn't match" })).not.toBeInTheDocument();
  });

  it("mismatches: a red banner with the count, the totals, and one plain-English row each", () => {
    render(<ReconcileReportTable report={badReport} />);
    const report = screen.getByRole("region", { name: "3 things don't match" });
    expect(within(report).getByText("PayPal total").nextElementSibling).toHaveTextContent("$637.00");
    expect(within(report).getByText("Our records").nextElementSibling).toHaveTextContent("$607.00");
    expect(within(report).getByText("Matched").nextElementSibling).toHaveTextContent("30 of 33");
    expect(within(report).getByText("Period: Oct 21 to Oct 27")).toBeInTheDocument();

    const table = within(report).getByRole("region", { name: "What doesn't match" });
    expect(table).toHaveAttribute("tabindex", "0");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map(cells)).toEqual([
      ["Missing in our records", "8XK2…41Q8XK29D4L1M0P7741Q", "$25.00", "none"],
      ["Amount differs", "3MP9…07C3MP9AB12CD34EF07C", "$40.00", "$35.00"],
      ["Missing in PayPal", "none", "none", "$10.00"],
    ]);
    // Short on screen, the full id in the title and for screen readers.
    expect(within(rows[0] as HTMLElement).getByTitle("8XK29D4L1M0P7741Q")).toBeInTheDocument();
  });

  it("one mismatch reads in the singular", () => {
    const first = badReport.mismatches[0];
    render(<ReconcileReportTable report={{ ...badReport, mismatches: first ? [first] : [] }} />);
    expect(screen.getByRole("heading", { name: "1 thing doesn't match" })).toBeInTheDocument();
  });
});

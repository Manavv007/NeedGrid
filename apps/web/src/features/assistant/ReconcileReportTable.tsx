import type { ReconcileReport } from "@needgrid/shared";
import { Check, CircleAlert } from "lucide-react";
import { useId } from "react";
import { formatShortDate, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

type Mismatch = ReconcileReport["mismatches"][number];

/** Plain-English mismatch kinds (AssistantStates.dc.html). */
const KIND_LABELS: Readonly<Record<Mismatch["kind"], string>> = {
  missing_in_records: "Missing in our records",
  missing_in_paypal: "Missing in PayPal",
  amount_mismatch: "Amount differs",
};

const period = (report: ReconcileReport) =>
  `${formatShortDate(report.periodStart)} to ${formatShortDate(report.periodEnd)}`;

/** "30 of 32": matched payments out of everything compared (matched + the mismatches). */
const matchedOf = (report: ReconcileReport) =>
  `${report.matchedCount} of ${report.matchedCount + report.mismatches.length}`;

function headline(report: ReconcileReport): string {
  if (report.ok) return "Everything matches";
  const n = report.mismatches.length;
  if (n === 0) return "Something doesn't match";
  return n === 1 ? "1 thing doesn't match" : `${n} things don't match`;
}

/**
 * The assistant's money check (Reconcile.dc.html "Everything matches", AssistantStates.dc.html
 * "Money check found a problem"): green or red banner (text + icon, never colour alone), the period,
 * PayPal's total, our records and the matched count, then one row per mismatch. Every number is
 * the server's report.
 */
export function ReconcileReportTable({ report }: { report: ReconcileReport }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-xl border bg-surface">
      <div
        className={cn(
          "flex items-center gap-2.5 px-4.5 py-3.5 text-primary-foreground",
          report.ok ? "bg-success" : "bg-danger",
        )}
      >
        {report.ok ? (
          <Check aria-hidden="true" className="size-5" strokeWidth={3} />
        ) : (
          <CircleAlert aria-hidden="true" className="size-5" strokeWidth={2.5} />
        )}
        <h3 id={headingId} className="text-[17px] font-extrabold">
          {headline(report)}
        </h3>
      </div>
      {report.ok ? <Summary report={report} /> : <ProblemSummary report={report} />}
      {report.mismatches.length > 0 ? <MismatchTable mismatches={report.mismatches} /> : null}
    </section>
  );
}

/** Everything matches: four plain rows. */
function Summary({ report }: { report: ReconcileReport }) {
  const rows: Array<[label: string, value: string, strong: boolean]> = [
    ["Period", period(report), false],
    ["PayPal total", formatUsd(report.paypalTotalCents), true],
    ["Our records", formatUsd(report.recordedTotalCents), true],
    ["Payments matched", matchedOf(report), false],
  ];
  return (
    <table className="w-full border-collapse text-[15px]">
      <tbody>
        {rows.map(([label, value, strong], i) => (
          <tr key={label} className={cn(i > 0 && "border-t border-track")}>
            <th scope="row" className="px-4.5 py-3 text-left font-medium text-muted-foreground">
              {label}
            </th>
            <td className={cn("px-4.5 py-3 text-right", strong ? "font-extrabold" : "font-semibold")}>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Something's off: the three totals side by side, then the period. */
function ProblemSummary({ report }: { report: ReconcileReport }) {
  const stats: Array<[label: string, value: string]> = [
    ["PayPal total", formatUsd(report.paypalTotalCents)],
    ["Our records", formatUsd(report.recordedTotalCents)],
    ["Matched", matchedOf(report)],
  ];
  return (
    <div className="border-b border-track">
      <dl className="m-0 grid grid-cols-3">
        {stats.map(([label, value], i) => (
          <div key={label} className={cn("min-w-0 px-3 py-3 sm:px-4", i > 0 && "border-l border-track")}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="m-0 mt-0.5 text-lg font-extrabold">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-track px-4 py-2 text-[13px] text-muted-foreground">Period: {period(report)}</p>
    </div>
  );
}

/** "8XK2…41Q" for long PayPal ids; the full id is in the title and read to screen readers. */
function PayPalId({ id }: { id: string | null }) {
  if (id === null) return <span className="text-muted-foreground">none</span>;
  const short = id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-3)}` : id;
  return (
    <span title={id} className="font-mono">
      <span aria-hidden="true">{short}</span>
      <span className="sr-only">{id}</span>
    </span>
  );
}

function Amount({ cents }: { cents: number | null }) {
  return cents === null ? <span className="text-muted-foreground">none</span> : <>{formatUsd(cents)}</>;
}

/** The mismatch rows. On phones the table scrolls inside its own box (keyboard-scrollable). */
function MismatchTable({ mismatches }: { mismatches: readonly Mismatch[] }) {
  const captionId = useId();
  return (
    // Keyboard users must be able to scroll it too (the rule's docs suggest this per-instance exception).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div role="region" aria-labelledby={captionId} tabIndex={0} className="overflow-x-auto">
      <table className="w-full min-w-120 border-collapse text-[13px]">
        <caption id={captionId} className="sr-only">
          What doesn't match
        </caption>
        <thead>
          <tr className="text-left text-muted-foreground">
            <th scope="col" className="px-4 py-2.5 font-semibold">
              Problem
            </th>
            <th scope="col" className="px-4 py-2.5 font-semibold">
              PayPal ID
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold">
              PayPal
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold">
              Ours
            </th>
          </tr>
        </thead>
        <tbody>
          {mismatches.map((m, i) => (
            <tr key={`${m.kind}-${m.paypalTransactionId ?? m.donationId ?? i}`} className="border-t border-track">
              <td className="px-4 py-2.5 font-semibold">{KIND_LABELS[m.kind]}</td>
              <td className="px-4 py-2.5">
                <PayPalId id={m.paypalTransactionId} />
              </td>
              <td className="px-4 py-2.5 text-right">
                <Amount cents={m.paypalCents} />
              </td>
              <td className="px-4 py-2.5 text-right">
                <Amount cents={m.recordedCents} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

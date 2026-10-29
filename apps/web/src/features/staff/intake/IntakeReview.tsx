import { ListChecks, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatUsdShort } from "@/lib/format";
import { DraftCard } from "./DraftCard";
import { estimatedTotalCents, hasErrors, isIncluded, type DraftRow } from "./draftRows";
import { IntakeSteps } from "./IntakeSteps";
import { useFocusHeading } from "./useFocusHeading";

type IntakeReviewProps = {
  rows: readonly DraftRow[];
  warnings: readonly string[];
  /** The photo the items came from, if any (a local preview, never uploaded again). */
  previewUrl: string | null;
  onChange: (id: string, changes: Partial<Omit<DraftRow, "id">>) => void;
  onReplace: (row: DraftRow) => void;
  onSubmit: (publish: boolean) => void;
};

/** Step 2 (Intake.dc.html): check every item, pick products, then publish or save as drafts. */
export function IntakeReview({ rows, warnings, previewUrl, onChange, onReplace, onSubmit }: IntakeReviewProps) {
  const headingRef = useFocusHeading(true);
  const included = rows.filter(isIncluded);
  const blocked = included.some(hasErrors);
  const count = included.length;
  const itemsWord = rows.length === 1 ? "item" : "items";

  return (
    <section aria-labelledby="intake-review-heading" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1
            id="intake-review-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-3xl font-extrabold tracking-[-0.03em] outline-none"
          >
            Review {rows.length} {itemsWord}
          </h1>
          <p className="max-w-2xl text-soft">
            We read your list and matched real products. Check each one. Nothing goes live until you publish.
          </p>
        </div>
        <IntakeSteps current={2} />
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border bg-surface p-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="What you uploaded"
              className="size-14 rounded-lg border bg-placeholder object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-14 items-center justify-center rounded-lg bg-placeholder text-placeholder-icon"
            >
              <ListChecks className="size-6" />
            </span>
          )}
          <div>
            <p className="text-sm font-bold">{previewUrl ? "Your photo" : "Your list"}</p>
            <p className="text-[13px] text-muted-foreground">
              {rows.length} {itemsWord} found
            </p>
          </div>
        </div>
        {warnings.length > 0 ? <Warnings warnings={warnings} /> : null}
      </div>

      <ul className="flex flex-col gap-4">
        {rows.map((row) => (
          <li key={row.id}>
            <DraftCard row={row} onChange={(changes) => onChange(row.id, changes)} onReplace={onReplace} />
          </li>
        ))}
      </ul>

      <div className="sticky bottom-0 z-10 -mx-4 border-t bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgb(0_0_0/0.06)] sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <p aria-live="polite" className="text-sm">
              <strong>
                {count} of {rows.length}
              </strong>{" "}
              items selected <span aria-hidden="true">·</span> estimated total{" "}
              {formatUsdShort(estimatedTotalCents(rows))}
            </p>
            {blocked ? (
              <p className="text-[13px] font-semibold text-danger">Fix the fields marked in red first.</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={count === 0 || blocked} onClick={() => onSubmit(false)}>
              Save as drafts
            </Button>
            <Button disabled={count === 0 || blocked} onClick={() => onSubmit(true)}>
              Publish {count} {count === 1 ? "need" : "needs"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Warnings({ warnings }: { warnings: readonly string[] }) {
  return (
    <div
      role="alert"
      className="flex flex-1 items-start gap-2.5 rounded-lg bg-badge-warning-bg px-3 py-2.5 text-sm text-badge-warning-text"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {warnings.length === 1 ? (
        <p>{warnings[0]}</p>
      ) : (
        <ul className="flex list-disc flex-col gap-1 pl-4">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

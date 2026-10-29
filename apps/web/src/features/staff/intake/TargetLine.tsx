import { centsToPayPalValue } from "@needgrid/shared";
import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { formatUsdShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { estimateCents, fieldErrors, targetView, type DraftRow } from "./draftRows";

type TargetLineProps = {
  row: DraftRow;
  onTargetTextChange: (text: string | null) => void;
};

/**
 * "Target $84 estimate, incl. 8% for tax and shipping" (Intake.dc.html). The estimate is the shared
 * `computeTargetCents`; the server computes the real target. "Edit target" lets staff type their own,
 * which is sent as `targetCents`. Without enough to estimate from, staff are asked to set one.
 */
export function TargetLine({ row, onTargetTextChange }: TargetLineProps) {
  const view = targetView(row);
  const editing = row.targetText !== null;
  const estimate = estimateCents(row);
  const amount = view.kind === "estimate" || view.kind === "override" ? view.cents : null;

  function startEditing() {
    onTargetTextChange(estimate === null ? "" : centsToPayPalValue(estimate));
  }

  return (
    <div className="flex flex-col gap-3 rounded-[10px] bg-staff-bg p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          {amount !== null ? (
            <>
              <span>Target</span>
              <strong className="text-lg">{formatUsdShort(amount)}</strong>
              {view.kind === "estimate" ? (
                <>
                  <span className="rounded-full bg-badge-warning-bg px-2 py-0.5 text-xs font-bold text-badge-warning-text">
                    estimate
                  </span>
                  <span className="text-[13px] text-muted-foreground">incl. 8% for tax and shipping</span>
                </>
              ) : (
                <span className="rounded-full bg-badge-info-bg px-2 py-0.5 text-xs font-bold text-badge-info-text">
                  your target
                </span>
              )}
            </>
          ) : view.kind === "needsQuantity" ? (
            <span className="font-semibold text-soft">Enter a quantity to see the target estimate</span>
          ) : (
            <>
              <strong className="text-base">Set a target</strong>
              <span className="text-[13px] text-soft">We couldn't tell how many packs this needs.</span>
            </>
          )}
        </p>
        {editing ? null : (
          <Button variant="outline" size="sm" onClick={startEditing}>
            {view.kind === "needsTarget" ? "Set target" : "Edit target"}
          </Button>
        )}
      </div>
      {editing ? (
        <TargetEditor
          value={row.targetText ?? ""}
          error={fieldErrors(row).target ?? null}
          canUseEstimate={row.suggestedTargetCents !== null}
          onChange={onTargetTextChange}
          onDone={() => onTargetTextChange(null)}
        />
      ) : null}
    </div>
  );
}

type TargetEditorProps = {
  value: string;
  error: string | null;
  canUseEstimate: boolean;
  onChange: (text: string) => void;
  onDone: () => void;
};

/** Dollars typed by staff, parsed with integer string maths (`parseDollarsToCents`); the server re-checks. */
function TargetEditor({ value, error, canUseEstimate, onChange, onDone }: TargetEditorProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-soft">
        Target in dollars
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <div
          className={cn(
            "flex h-11 w-40 items-center gap-1 rounded-md bg-surface px-3 text-base focus-within:ring-3 focus-within:ring-ring",
            error ? "border-2 border-danger" : "border border-border-strong focus-within:border-ring",
          )}
        >
          <span aria-hidden="true">$</span>
          <input
            ref={inputRef}
            id={id}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className="min-w-0 flex-1 border-0 bg-transparent outline-none"
          />
        </div>
        <Button variant="ghost" size="sm" onClick={onDone}>
          {canUseEstimate ? "Use the estimate" : "Cancel"}
        </Button>
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-[13px] font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

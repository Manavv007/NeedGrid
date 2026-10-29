import { CATEGORIES } from "@needgrid/shared";
import { PackageSearch, TriangleAlert } from "lucide-react";
import { useId, type ReactNode } from "react";
import { CATEGORY_LABELS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { canInclude, fieldErrors, isLowConfidence, type DraftRow, type FieldErrors } from "./draftRows";
import { ProductLinkLookup } from "./ProductLinkLookup";
import { ProductOptions } from "./ProductOptions";
import { TargetLine } from "./TargetLine";
import { UrgencyControl } from "./UrgencyControl";

type DraftCardProps = {
  row: DraftRow;
  /** Field edits; the page applies `withChanges` (ticking rules). */
  onChange: (changes: Partial<Omit<DraftRow, "id">>) => void;
  /** A whole new row, from a pasted product link. */
  onReplace: (row: DraftRow) => void;
};

const control =
  "h-11 w-full min-w-0 rounded-md bg-surface px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring md:text-sm";

/** One extracted item to check and edit before it is published (Intake.dc.html). */
export function DraftCard({ row, onChange, onReplace }: DraftCardProps) {
  const titleId = useId();
  const hasProduct = row.options.length > 0;

  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-4 rounded-2xl border bg-surface p-4 sm:p-5">
      <h2 id={titleId} className="sr-only">
        {row.title}
      </h2>
      <CardHeader row={row} hasProduct={hasProduct} onIncludedChange={(included) => onChange({ included })} />
      {hasProduct ? <Editor row={row} onChange={onChange} /> : <NoProduct row={row} onReplace={onReplace} />}
    </article>
  );
}

type CardHeaderProps = { row: DraftRow; hasProduct: boolean; onIncludedChange: (included: boolean) => void };

function CardHeader({ row, hasProduct, onIncludedChange }: CardHeaderProps) {
  const id = useId();
  const allowed = canInclude(row);
  const hint = !hasProduct
    ? "Unticked until it has a product, so it won't be published by mistake."
    : !allowed
      ? "Set a target to include this item."
      : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label
          htmlFor={id}
          className={cn(
            "flex min-h-11 items-center gap-2.5 text-sm font-bold",
            allowed ? "cursor-pointer" : "cursor-not-allowed text-muted-foreground",
          )}
        >
          <input
            id={id}
            type="checkbox"
            checked={row.included && allowed}
            disabled={!allowed}
            onChange={(event) => onIncludedChange(event.target.checked)}
            aria-describedby={hint ? `${id}-hint` : undefined}
            className="size-5 accent-primary"
          />
          Include this item
        </label>
        <span className="flex flex-wrap gap-2">
          {!hasProduct ? (
            <Tag tone="danger" icon={<PackageSearch aria-hidden="true" className="size-3.5" />}>
              No product found
            </Tag>
          ) : null}
          {isLowConfidence(row) ? (
            <Tag tone="warning" icon={<TriangleAlert aria-hidden="true" className="size-3.5" />}>
              Please check{row.notes ? ` · ${row.notes}` : ""}
            </Tag>
          ) : null}
        </span>
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type TagProps = { tone: "warning" | "danger"; icon: ReactNode; children: ReactNode };

function Tag({ tone, icon, children }: TagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold",
        tone === "warning"
          ? "bg-badge-warning-bg text-badge-warning-text"
          : "bg-badge-danger-bg text-badge-danger-text",
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function NoProduct({ row, onReplace }: { row: DraftRow; onReplace: (row: DraftRow) => void }) {
  return (
    <>
      <p className="text-base font-bold">
        {row.title}{" "}
        <span className="font-normal text-muted-foreground">
          <span aria-hidden="true">·</span> {row.quantity} × {row.unit}
        </span>
      </p>
      <ProductLinkLookup row={row} onFound={onReplace} />
    </>
  );
}

type EditorProps = { row: DraftRow; onChange: (changes: Partial<Omit<DraftRow, "id">>) => void };

function Editor({ row, onChange }: EditorProps) {
  const errors = fieldErrors(row);
  const showNotes = row.notes !== null && !isLowConfidence(row);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <Field label="Item" error={errors.title} className="col-span-2 sm:col-span-3">
          {(props) => (
            <input
              {...props}
              type="text"
              value={row.title}
              onChange={(event) => onChange({ title: event.target.value })}
              className={fieldClass(props, control)}
            />
          )}
        </Field>
        <Field label="Quantity" error={errors.quantity} className="sm:col-span-1">
          {(props) => (
            <input
              {...props}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={row.quantity}
              onChange={(event) => onChange({ quantity: event.target.value })}
              className={fieldClass(props, control)}
            />
          )}
        </Field>
        <Field label="Unit" error={errors.unit} className="sm:col-span-2">
          {(props) => (
            <input
              {...props}
              type="text"
              value={row.unit}
              onChange={(event) => onChange({ unit: event.target.value })}
              className={fieldClass(props, control)}
            />
          )}
        </Field>
        <Field label="Category" className="col-span-2">
          {(props) => (
            <select
              {...props}
              value={row.category}
              onChange={(event) => {
                const category = CATEGORIES.find((c) => c === event.target.value);
                if (category) onChange({ category });
              }}
              className={fieldClass(props, control)}
            >
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="col-span-2">
          <UrgencyControl
            name={`urgency-${row.id}`}
            value={row.urgency}
            onChange={(urgency) => onChange({ urgency })}
          />
        </div>
        <Field label="Needed by (optional)" error={errors.deadline} className="col-span-2">
          {(props) => (
            <input
              {...props}
              type="date"
              value={row.deadline}
              onChange={(event) => onChange({ deadline: event.target.value })}
              className={fieldClass(props, control)}
            />
          )}
        </Field>
        <Field label="Why it's needed (donors see this)" error={errors.description} className="col-span-full">
          {(props) => (
            <textarea
              {...props}
              rows={2}
              value={row.description}
              onChange={(event) => onChange({ description: event.target.value })}
              className={fieldClass(
                props,
                "w-full rounded-md bg-surface px-3 py-2 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring md:text-sm",
              )}
            />
          )}
        </Field>
      </div>
      {showNotes ? <p className="text-[13px] text-soft">Note: {row.notes}</p> : null}
      <ProductOptions
        name={`product-${row.id}`}
        options={row.options}
        selected={row.selected}
        onSelect={(selected) => onChange({ selected })}
      />
      <TargetLine row={row} onTargetTextChange={(targetText) => onChange({ targetText })} />
    </>
  );
}

type ControlProps = {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
};

/** Error state from `aria-invalid`, so the control and the message never disagree. */
function fieldClass(props: ControlProps, base: string): string {
  return cn(
    base,
    props["aria-invalid"] ? "border-2 border-danger" : "border border-border-strong focus-visible:border-ring",
  );
}

type FieldProps = {
  label: string;
  error?: FieldErrors[keyof FieldErrors];
  className?: string;
  children: (props: ControlProps) => ReactNode;
};

/** A label above its control and the control's error below, wired together with ids. */
function Field({ label, error, className, children }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-semibold text-soft">
        {label}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": error ? errorId : undefined })}
      {error ? (
        <p id={errorId} className="text-[13px] font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

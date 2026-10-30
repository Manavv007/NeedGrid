import type { StaffNeedDetailRes } from "@needgrid/shared";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatUsd, formatUsdShort, STAFF_URGENCY_LABELS } from "@/lib/format";
import { usePatchNeed } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { errorMessage } from "../errorMessage";
import { CloseNeedDialog } from "./CloseNeedDialog";
import {
  buildPatch,
  editErrors,
  editLocks,
  formFromNeed,
  isEmptyPatch,
  productChoices,
  type EditErrors,
  type EditForm,
} from "./editNeed";

type EditNeedDialogProps = {
  detail: StaffNeedDetailRes;
  /** The need was closed from this dialog: its Edit button is about to go, so the page takes focus. */
  onNeedClosed: () => void;
};

/**
 * "Edit need" (NeedManageStates.dc.html, `PatchNeedReq`). Radix traps focus, Esc closes, and focus
 * returns to the Edit button. The form mounts fresh on every open.
 */
export function EditNeedDialog({ detail, onNeedClosed }: EditNeedDialogProps) {
  const [open, setOpen] = useState(false);
  const closedNeed = useRef(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Edit need</Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[calc(100svh-2rem)] gap-3.5 overflow-y-auto rounded-2xl p-5.5 sm:max-w-130"
        onCloseAutoFocus={(event) => {
          if (!closedNeed.current) return;
          closedNeed.current = false;
          event.preventDefault();
          onNeedClosed();
        }}
      >
        <EditNeedForm
          detail={detail}
          onSaved={() => setOpen(false)}
          onClosedNeed={() => {
            closedNeed.current = true;
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

type EditNeedFormProps = { detail: StaffNeedDetailRes; onSaved: () => void; onClosedNeed: () => void };

const control =
  "h-11 w-full min-w-0 rounded-md bg-surface px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring disabled:bg-staff-bg disabled:text-muted-foreground md:text-[15px]";

function EditNeedForm({ detail, onSaved, onClosedNeed }: EditNeedFormProps) {
  const { need } = detail;
  // What the dialog opened with: only fields that differ from it are sent.
  const [initial] = useState(() => formFromNeed(need));
  const [form, setForm] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const [serverProblem, setServerProblem] = useState<string | null>(null);
  const patch = usePatchNeed();
  const busy = useRef(false);
  const hintId = useId();

  // Locks follow the latest need (a donation can arrive while the dialog is open).
  const locks = editLocks(need);
  const products = productChoices(need, detail.alternatives);
  const errors: EditErrors = submitted ? editErrors(form, locks) : {};
  const change = (changes: Partial<EditForm>) => {
    setForm((current) => ({ ...current, ...changes }));
    setServerProblem(null);
  };

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (busy.current || Object.keys(editErrors(form, locks)).length > 0) return;
    const body = buildPatch(initial, form, locks, products);
    if (isEmptyPatch(body)) {
      onSaved();
      return;
    }
    busy.current = true;
    setServerProblem(null);
    try {
      await patch.mutateAsync({ id: need.id, patch: body });
      toast.success("Changes saved.");
      onSaved();
    } catch (error) {
      const message = errorMessage(error, "We couldn't save your changes. Please try again.");
      setServerProblem(message);
      toast.error(message);
    } finally {
      busy.current = false;
    }
  }

  const hints = [
    locks.quantity,
    locks.target ??
      (locks.minTargetCents > 0
        ? `Target can't go below ${formatUsdShort(locks.minTargetCents)} (raised plus held).`
        : null),
  ].filter((hint): hint is string => hint !== null);

  return (
    <form noValidate onSubmit={(event) => void save(event)} className="flex flex-col gap-3.5">
      <div className="pr-10">
        <DialogTitle className="text-xl font-extrabold">Edit need</DialogTitle>
        <DialogDescription className="mt-1 text-[13px] text-soft">
          Changes show on your public page straight away.
        </DialogDescription>
      </div>

      <Field label="Title" error={errors.title}>
        {(props) => (
          <input
            {...props}
            type="text"
            value={form.title}
            onChange={(event) => change({ title: event.target.value })}
            className={fieldClass(props, control)}
          />
        )}
      </Field>
      <Field label="Why it's needed" error={errors.description}>
        {(props) => (
          <textarea
            {...props}
            rows={2}
            value={form.description}
            onChange={(event) => change({ description: event.target.value })}
            className={fieldClass(
              props,
              "w-full rounded-md bg-surface px-3 py-2.5 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring md:text-[15px]",
            )}
          />
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantity" error={errors.quantity} hintId={hints.length > 0 ? hintId : undefined}>
          {(props) => (
            <input
              {...props}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              disabled={locks.quantity !== null}
              value={form.quantity}
              onChange={(event) => change({ quantity: event.target.value })}
              className={fieldClass(props, control)}
            />
          )}
        </Field>
        <Field label="Target ($)" error={errors.target} hintId={hints.length > 0 ? hintId : undefined}>
          {(props) => (
            <input
              {...props}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              disabled={locks.target !== null}
              value={form.target}
              onChange={(event) => change({ target: event.target.value })}
              className={fieldClass(props, control)}
            />
          )}
        </Field>
      </div>
      {hints.length > 0 ? (
        <p id={hintId} className="-mt-1.5 text-xs text-muted-foreground">
          {hints.join(" ")}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Urgency">
          {(props) => (
            <select
              {...props}
              value={form.urgency}
              onChange={(event) => {
                const level = ([3, 2, 1] as const).find((u) => String(u) === event.target.value);
                if (level) change({ urgency: level });
              }}
              className={fieldClass(props, control)}
            >
              {([3, 2, 1] as const).map((level) => (
                <option key={level} value={level}>
                  {STAFF_URGENCY_LABELS[level]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Needed by" error={errors.deadline}>
          {(props) => (
            <div className="flex gap-1.5">
              <input
                {...props}
                type="date"
                value={form.deadline}
                onChange={(event) => change({ deadline: event.target.value })}
                className={fieldClass(props, control)}
              />
              {form.deadline !== "" ? (
                <Button type="button" variant="ghost" size="icon" onClick={() => change({ deadline: "" })}>
                  <span aria-hidden="true">×</span>
                  <span className="sr-only">Clear the date</span>
                </Button>
              ) : null}
            </div>
          )}
        </Field>
      </div>

      {products.length > 1 ? (
        <Field label="Product" hintId={`${hintId}-product`}>
          {(props) => (
            <select
              {...props}
              disabled={locks.product !== null}
              value={form.productId}
              onChange={(event) => change({ productId: event.target.value })}
              className={fieldClass(props, control)}
            >
              {products.map((product) => (
                <option key={product.channel3Id} value={product.channel3Id}>
                  {product.title} · {product.retailer} · {formatUsd(product.unitPriceCents)}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : null}
      {products.length > 1 ? (
        <p id={`${hintId}-product`} className="-mt-1.5 text-xs text-muted-foreground">
          {locks.product ?? "Another product recalculates the target, unless you change the target here too."}
        </p>
      ) : null}

      {serverProblem ? (
        <p
          role="alert"
          className="rounded-md bg-badge-danger-bg px-3 py-2.5 text-sm font-semibold text-badge-danger-text"
        >
          {serverProblem}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-between gap-2.5 border-t border-track pt-3.5">
        <CloseNeedDialog need={need} onClosed={onClosedNeed} />
        <div className="flex gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" disabled={patch.isPending}>
            {patch.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </form>
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
  error?: string;
  /** A shared hint under a group of fields (e.g. why the quantity is locked). */
  hintId?: string;
  children: (props: ControlProps) => ReactNode;
};

/** A label above its control and the control's error below, wired together with ids. */
function Field({ label, error, hintId, children }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hintId ?? null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-soft">
        {label}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {error ? (
        <p id={errorId} className="text-[13px] font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

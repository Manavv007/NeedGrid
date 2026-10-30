import { IntakeReq } from "@needgrid/shared";
import { Camera, CircleAlert } from "lucide-react";
import { useId, useState, type ChangeEvent, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { checkImageFile } from "@/lib/cloudinary";
import { cn } from "@/lib/utils";
import { IntakeSteps } from "./IntakeSteps";
import { useFocusHeading } from "./useFocusHeading";

/** Same limit as `IntakeReq.text`. */
const MAX_TEXT = 5000;

export type StartProblem = { message: string; canRetry: boolean };

type IntakeStartProps = {
  text: string;
  onTextChange: (text: string) => void;
  /** False when Cloudinary isn't configured (and mocks are off): only the list works. */
  photoAvailable: boolean;
  onPhoto: (file: File) => void;
  onText: (text: string) => void;
  /** The last try failed (or found nothing). */
  problem: StartProblem | null;
  onRetry: () => void;
  focusHeading: boolean;
};

/** Step 1 (IntakeStart.dc.html): a photo of the shelf or list, or a typed/pasted list or product link. */
export function IntakeStart({
  text,
  onTextChange,
  photoAvailable,
  onPhoto,
  onText,
  problem,
  onRetry,
  focusHeading,
}: IntakeStartProps) {
  const headingRef = useFocusHeading(focusHeading);

  return (
    <section aria-labelledby="intake-start-heading" className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <IntakeSteps current={1} />
        <p className="text-[13px] font-bold tracking-wide text-muted-foreground uppercase">Step 1 of 3</p>
        <h1
          id="intake-start-heading"
          ref={headingRef}
          tabIndex={-1}
          className="text-3xl font-extrabold tracking-[-0.03em] outline-none"
        >
          What do you need?
        </h1>
        <p className="max-w-xl text-soft">
          Show us the empty shelf or your list. We'll turn it into items with real products and prices.
        </p>
      </div>

      {problem ? <ProblemAlert problem={problem} onRetry={onRetry} /> : null}

      {photoAvailable ? <PhotoPicker onPhoto={onPhoto} /> : <PhotoUnavailable />}
      <ListForm text={text} onTextChange={onTextChange} onSubmit={onText} />
    </section>
  );
}

function ProblemAlert({ problem, onRetry }: { problem: StartProblem; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-badge-danger-bg bg-surface p-4 text-sm"
    >
      <CircleAlert aria-hidden="true" className="size-5 shrink-0 text-danger" />
      <p className="min-w-0 flex-1 font-medium text-danger">{problem.message}</p>
      {problem.canRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

function PhotoPicker({ onPhoto }: { onPhoto: (file: File) => void }) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Let the same file be picked again after a failed try.
    event.target.value = "";
    if (!file) return;
    const problem = checkImageFile(file);
    setError(problem);
    if (problem === null) onPhoto(file);
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className="flex min-h-24 cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed border-primary bg-surface p-5 hover:bg-primary-soft has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary"
      >
        <span
          aria-hidden="true"
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
        >
          <Camera className="size-7" strokeWidth={2} />
        </span>
        <span className="flex flex-col gap-1">
          <strong className="text-lg">Take or upload a photo</strong>
          <span className="text-sm text-soft">A shelf, a handwritten list or a printed one. Up to 10 MB.</span>
        </span>
        <input
          id={id}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onChange}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="sr-only"
        />
      </label>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PhotoUnavailable() {
  return (
    <div className="flex min-h-24 items-center gap-4 rounded-2xl border-2 border-dashed border-border-strong bg-surface p-5 text-soft">
      <span
        aria-hidden="true"
        className="flex size-14 shrink-0 items-center justify-center rounded-full bg-placeholder text-placeholder-icon"
      >
        <Camera className="size-7" strokeWidth={2} />
      </span>
      <span className="flex flex-col gap-1">
        <strong className="text-lg text-foreground">Photo upload isn't set up yet</strong>
        <span className="text-sm">Type or paste your list below instead.</span>
      </span>
    </div>
  );
}

type ListFormProps = { text: string; onTextChange: (text: string) => void; onSubmit: (text: string) => void };

function ListForm({ text, onTextChange, onSubmit }: ListFormProps) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed === "") {
      setError("Type or paste a list first.");
      return;
    }
    if (!IntakeReq.safeParse({ text: trimmed }).success) {
      setError(`Keep the list under ${MAX_TEXT.toLocaleString("en-US")} characters.`);
      return;
    }
    setError(null);
    onSubmit(trimmed);
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-2xl border bg-surface p-5">
      <label htmlFor={id} className="text-base font-bold">
        Or type or paste a list
      </label>
      <textarea
        id={id}
        rows={5}
        value={text}
        onChange={(event) => {
          onTextChange(event.target.value);
          if (error) setError(null);
        }}
        placeholder={"e.g.\n2 packs size 4 diapers\n24 cans of chicken\nsocks for women"}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error ${id}-hint` : `${id}-hint`}
        className={cn(
          "w-full rounded-lg border bg-surface px-3 py-2.5 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring",
          error ? "border-2 border-danger" : "border-border-strong",
        )}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span id={`${id}-hint`} className="text-[13px] text-muted-foreground">
          Have a product link instead? Paste it in the box.
        </span>
        <Button type="submit">Find products</Button>
      </div>
    </form>
  );
}

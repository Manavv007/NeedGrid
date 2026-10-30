import { useId } from "react";
import { cn } from "@/lib/utils";
import { MAX_NOTE_LENGTH } from "./delivery";

type NoteFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  help: string;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
};

/** A labelled text box with a character counter, for notes and messages to donors (≤ 500). */
export function NoteField({ label, value, onChange, help, rows = 4, placeholder, disabled }: NoteFieldProps) {
  const id = useId();
  const tooLong = value.length > MAX_NOTE_LENGTH;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-bold">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={tooLong ? true : undefined}
        aria-describedby={`${id}-help ${id}-count${tooLong ? ` ${id}-error` : ""}`}
        className={cn(
          "w-full resize-y rounded-lg bg-surface px-3 py-2.5 text-base leading-normal outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:opacity-50",
          tooLong ? "border-2 border-danger" : "border border-border-strong",
        )}
      />
      <div className="flex justify-between gap-3 text-xs text-muted-foreground">
        <p id={`${id}-help`}>{help}</p>
        <p id={`${id}-count`} className={cn("shrink-0", tooLong && "font-semibold text-danger")}>
          {value.length}/{MAX_NOTE_LENGTH}
          <span className="sr-only"> characters</span>
        </p>
      </div>
      {tooLong ? (
        <p id={`${id}-error`} className="text-[13px] font-semibold text-danger">
          Keep it to {MAX_NOTE_LENGTH} characters or fewer.
        </p>
      ) : null}
    </div>
  );
}

import { MIN_DONATION_CENTS } from "@needgrid/shared";
import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { formatUsd, formatUsdShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  checkOtherAmount,
  formatCentsWords,
  maxGiftCents,
  onlyRestOffered,
  presetsFor,
  restOffered,
  type GiftChoice,
} from "./money-input";

type AmountPickerProps = {
  /** What's left on the item, as the server sent it. */
  remainingCents: number;
  choice: GiftChoice;
  otherText: string;
  onChoiceChange: (choice: GiftChoice) => void;
  onOtherTextChange: (text: string) => void;
  disabled?: boolean;
  /** Focus (and scroll to) the selected option when mounted: `?donate=1` and the phone sheet. */
  focusOnMount?: boolean;
};

/**
 * "Choose your gift" (brief §9.4.1): $10 / $25 / $50 below what's left, "Fund the rest" and "Other".
 * With less than the minimum left, only the exact remainder is offered (DonateVariants.dc.html).
 */
export function AmountPicker({
  remainingCents,
  choice,
  otherText,
  onChoiceChange,
  onOtherTextChange,
  disabled = false,
  focusOnMount = false,
}: AmountPickerProps) {
  const optionsRef = useRef<HTMLDivElement>(null);
  const otherInputRef = useRef<HTMLInputElement>(null);
  const focusOtherInput = useRef(false);

  const onlyRest = onlyRestOffered(remainingCents);
  const presets = onlyRest ? [] : presetsFor(remainingCents);
  const showRest = restOffered(remainingCents);
  const showOther = !onlyRest && remainingCents >= MIN_DONATION_CENTS;

  useEffect(() => {
    if (!focusOnMount) return;
    const selected = optionsRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    selected?.focus({ preventScroll: true });
    // jsdom has no scrollIntoView; real browsers smooth-scroll unless reduced motion is on (globals.css).
    selected?.scrollIntoView?.({ block: "center" });
  }, [focusOnMount]);

  useEffect(() => {
    if (choice.kind !== "other" || !focusOtherInput.current) return;
    focusOtherInput.current = false;
    otherInputRef.current?.focus();
  }, [choice.kind]);

  return (
    <fieldset disabled={disabled} className="m-0 flex min-w-0 flex-col gap-2.5 border-0 p-0">
      <legend className="mb-2.5 text-sm font-bold">Choose your gift</legend>
      <div ref={optionsRef} className="grid grid-cols-2 gap-2.5">
        {presets.map((cents) => (
          <AmountOption
            key={cents}
            pressed={choice.kind === "preset" && choice.cents === cents}
            onClick={() => onChoiceChange({ kind: "preset", cents })}
          >
            {formatUsdShort(cents)}
          </AmountOption>
        ))}
        {showRest ? (
          <AmountOption
            pressed={choice.kind === "rest"}
            onClick={() => onChoiceChange({ kind: "rest" })}
            className={onlyRest ? "col-span-2 min-h-13 text-base" : undefined}
          >
            Fund the rest ({formatUsd(remainingCents)})
          </AmountOption>
        ) : null}
        {showOther ? (
          <AmountOption
            pressed={choice.kind === "other"}
            onClick={() => {
              focusOtherInput.current = true;
              onChoiceChange({ kind: "other" });
            }}
          >
            Other amount
          </AmountOption>
        ) : null}
      </div>
      {onlyRest ? (
        <p className="text-[13px] leading-normal text-soft">
          Only {formatCentsWords(remainingCents)} to go, so we only offer the exact amount.
        </p>
      ) : null}
      {showOther && choice.kind === "other" ? (
        <OtherAmountField
          inputRef={otherInputRef}
          value={otherText}
          remainingCents={remainingCents}
          onChange={onOtherTextChange}
        />
      ) : null}
    </fieldset>
  );
}

type AmountOptionProps = { pressed: boolean; onClick: () => void; className?: string; children: ReactNode };

function AmountOption({ pressed, onClick, className, children }: AmountOptionProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "min-h-12 rounded-md px-3 text-[15px] leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        pressed
          ? "border-2 border-primary bg-primary-soft font-extrabold text-primary"
          : "border border-border-strong bg-surface font-semibold text-foreground hover:bg-placeholder",
        className,
      )}
    >
      {children}
    </button>
  );
}

type OtherAmountFieldProps = {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  remainingCents: number;
  onChange: (text: string) => void;
};

/** Dollars typed by the donor, checked as they type; the server checks again. */
function OtherAmountField({ inputRef, value, remainingCents, onChange }: OtherAmountFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const check = checkOtherAmount(value, remainingCents);
  const error = check.ok ? null : check.error;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-soft">
        Amount in dollars
      </label>
      <div
        className={cn(
          "flex h-12 items-center gap-1 rounded-md bg-surface px-3 text-base focus-within:ring-3 focus-within:ring-ring",
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
          placeholder="12.50"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${errorId} ${hintId}` : hintId}
          className="min-w-0 flex-1 border-0 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      <p id={errorId} aria-live="polite" className="text-[13px] font-semibold text-danger empty:hidden">
        {error ?? ""}
      </p>
      <p id={hintId} className="text-xs text-muted-foreground">
        Min {formatUsdShort(MIN_DONATION_CENTS)}, max {formatUsdShort(maxGiftCents(remainingCents))} for this item.
      </p>
    </div>
  );
}

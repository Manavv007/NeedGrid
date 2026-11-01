import type { MatchReq, MatchRes } from "@needgrid/shared";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { formatUsdShort } from "@/lib/format";
import { useMatch } from "@/lib/queries";
import { cn } from "@/lib/utils";
import {
  BUDGET_CHIPS,
  BUSY_MESSAGE,
  checkBudget,
  checkMatchForm,
  COUNTER_FROM,
  DEFAULT_BUDGET_TEXT,
  matchesFound,
  matchFailure,
  TEXT_MAX,
  trimmedLength,
  type MatchFailure,
  type MatchFormErrors,
} from "./matchForm";
import { MatchResults } from "./MatchResults";

type View =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; matches: MatchRes["matches"]; budgetCents: number }
  | { kind: "failed"; failure: MatchFailure; req: MatchReq };

const NO_ERRORS: MatchFormErrors = { text: null, budget: null };

// White focus ring: the default teal ring is invisible on the dark teal box (like the staff header).
const onDark = "focus-visible:outline-white";
const field = cn(
  "h-12.5 min-w-0 rounded-[10px] border-0 bg-surface px-3.5 text-base text-foreground placeholder:text-muted-foreground",
  onDark,
);
const fieldError = "rounded-md bg-badge-danger-bg px-2.5 py-1.5 text-[13px] font-semibold text-badge-danger-text";

/** B's message as a sentence ("…try again tomorrow" → "…try again tomorrow."). */
const asSentence = (message: string) => (/[.!?…]$/.test(message.trim()) ? message.trim() : `${message.trim()}.`);

/**
 * "Not sure where to start?" on the landing page (brief §9.1, MatchMe.dc.html): what the donor cares
 * about and a budget → B's `POST /api/match` → up to 3 needs to fund. Behind the `matchMe` flag.
 * Nothing the donor types is stored: no URL, no storage, no autocomplete history.
 */
export function MatchMeBox() {
  const titleId = useId();
  const [text, setText] = useState("");
  const [budgetText, setBudgetText] = useState(DEFAULT_BUDGET_TEXT);
  const [showErrors, setShowErrors] = useState(false);
  const [view, setView] = useState<View>({ kind: "idle" });
  const [announcement, setAnnouncement] = useState("");
  const match = useMatch();
  const inFlight = useRef<AbortController | null>(null);

  // Leaving the page cancels a search that is still running.
  useEffect(() => () => inFlight.current?.abort(), []);

  const check = checkMatchForm(text, budgetText);
  const errors = showErrors && !check.ok ? check.errors : NO_ERRORS;
  const loading = view.kind === "loading";

  async function find(req: MatchReq) {
    if (inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setView({ kind: "loading" });
    setAnnouncement("");
    try {
      const res = await match.mutateAsync({ req, signal: controller.signal });
      if (controller.signal.aborted) return;
      setView({ kind: "results", matches: res.matches, budgetCents: req.budgetCents });
      setAnnouncement(matchesFound(res.matches.length));
    } catch (error) {
      if (controller.signal.aborted) return;
      setView({ kind: "failed", failure: matchFailure(error), req });
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    if (!check.ok) {
      setShowErrors(true);
      return;
    }
    void find(check.req);
  }

  function cancel() {
    inFlight.current?.abort();
    inFlight.current = null;
    match.reset();
    setView({ kind: "idle" });
  }

  return (
    <section aria-labelledby={titleId} className="mx-auto flex w-full max-w-300 flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-4 rounded-2xl bg-staff-header p-5 text-primary-foreground sm:p-7">
        <div>
          <h2 id={titleId} className="mb-1.5 text-[22px] font-extrabold tracking-[-0.02em] sm:text-[26px]">
            Not sure where to start?
          </h2>
          <p className="text-base text-staff-header-link">
            Tell us what you care about and your budget. We'll find 3 items you can fund.
          </p>
        </div>
        <form noValidate onSubmit={submit} className="flex flex-wrap items-start gap-2.5">
          <TextField value={text} onChange={setText} error={errors.text} disabled={loading} />
          <BudgetField value={budgetText} onChange={setBudgetText} error={errors.budget} disabled={loading} />
          <Button
            type="submit"
            size="lg"
            disabled={loading}
            className={cn(
              "h-12.5 w-full bg-surface font-extrabold text-staff-header hover:bg-primary-soft hover:text-staff-header sm:mt-6.5 sm:w-auto",
              onDark,
            )}
          >
            Find matches
          </Button>
        </form>
        <MatchStatus view={view} onCancel={cancel} onRetry={(req) => void find(req)} />
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {view.kind === "results" ? <MatchResults matches={view.matches} budgetCents={view.budgetCents} /> : null}
    </section>
  );
}

type FieldProps = { value: string; onChange: (value: string) => void; error: string | null; disabled: boolean };

function TextField({ value, onChange, error, disabled }: FieldProps) {
  const id = useId();
  const length = trimmedLength(value);
  const counter = length >= COUNTER_FROM;
  const describedBy = [error ? `${id}-error` : null, counter ? `${id}-count` : null].filter(Boolean).join(" ");
  return (
    <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-staff-header-link">
        What do you care about?
      </label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        placeholder="Kids staying warm this winter"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(field, "w-full", error && "outline-2 outline-badge-danger-bg")}
      />
      {counter ? (
        <p id={`${id}-count`} className="text-xs text-staff-header-link">
          {length}/{TEXT_MAX} characters
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className={fieldError}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function BudgetField({ value, onChange, error, disabled }: FieldProps) {
  const id = useId();
  const budget = checkBudget(value);
  return (
    <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-1.5 sm:flex-[0_1_260px]">
      <label htmlFor={id} className="text-[13px] font-semibold text-staff-header-link">
        Your budget
      </label>
      <div className="flex gap-2">
        <div
          className={cn(
            "flex h-12.5 w-28 shrink-0 items-center gap-1 rounded-[10px] bg-surface px-3 text-base text-foreground focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-white",
            error && "outline-2 outline-badge-danger-bg",
          )}
        >
          <span aria-hidden="true">$</span>
          <input
            id={id}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className="w-full min-w-0 border-0 bg-transparent outline-none"
          />
        </div>
        <div role="group" aria-label="Quick budgets" className="flex gap-1.5">
          {BUDGET_CHIPS.map((cents) => (
            <button
              key={cents}
              type="button"
              disabled={disabled}
              aria-pressed={budget.ok && budget.cents === cents}
              onClick={() => onChange(String(cents / 100))}
              className={cn(
                "h-12.5 min-w-11 cursor-pointer rounded-[10px] border px-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60",
                budget.ok && budget.cents === cents
                  ? "border-surface bg-surface text-staff-header"
                  : "border-staff-header-link/60 bg-transparent text-primary-foreground hover:bg-white/10",
                onDark,
              )}
            >
              {formatUsdShort(cents)}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <p id={`${id}-error`} className={fieldError}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

type MatchStatusProps = { view: View; onCancel: () => void; onRetry: (req: MatchReq) => void };

/** "Finding needs that fit…" with Cancel, or why the last search didn't work. */
function MatchStatus({ view, onCancel, onRetry }: MatchStatusProps) {
  if (view.kind === "loading") {
    return (
      <div role="status" className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden="true"
          className="size-5 rounded-full border-3 border-staff-header-link/40 border-t-surface motion-safe:animate-spin"
        />
        <span className="text-[15px] font-semibold">Finding needs that fit…</span>
        <Button
          variant="outline"
          onClick={onCancel}
          className={cn("border-staff-header-link/60 bg-transparent text-primary-foreground hover:bg-white/10", onDark)}
        >
          Cancel
        </Button>
      </div>
    );
  }
  if (view.kind !== "failed") return null;
  const { failure, req } = view;
  switch (failure.kind) {
    case "invalid":
      return (
        <p role="alert" className={fieldError}>
          {failure.message}
        </p>
      );
    case "busy":
      return (
        <p
          role="status"
          className="rounded-md bg-badge-warning-bg px-3 py-2 text-sm font-semibold text-badge-warning-text"
        >
          {BUSY_MESSAGE}
        </p>
      );
    case "resting":
      return (
        <p role="status" className="rounded-md bg-badge-info-bg px-3 py-2 text-sm text-badge-info-text">
          {asSentence(failure.message)} You can still pick any item from the charities below.
        </p>
      );
    case "other":
      return (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md bg-surface px-3 py-2 text-foreground">
          <p className="text-sm">We couldn't find matches just now. Please try again.</p>
          <Button variant="outline" size="sm" onClick={() => onRetry(req)}>
            Retry
          </Button>
        </div>
      );
  }
}

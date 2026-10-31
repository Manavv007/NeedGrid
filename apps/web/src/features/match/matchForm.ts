/**
 * The Match me form as pure functions. Only helps the donor send something B's route accepts: the
 * server checks `MatchReq` again. Dollars become cents with integer string maths (money-input.ts).
 */
import { formatUsd, MatchReq, MAX_DONATION_CENTS, MIN_DONATION_CENTS } from "@needgrid/shared";
import { FORMAT_ERROR, parseDollarsToCents } from "@/features/donate/money-input";
import { ApiClientError } from "@/lib/api";

/** `MatchReq.text`: 3 to 300 characters once trimmed. */
export const TEXT_MIN = 3;
export const TEXT_MAX = 300;
/** The character counter appears from here on. */
export const COUNTER_FROM = 250;

/** Quick budget chips (MatchMe.dc.html). */
export const BUDGET_CHIPS = [1000, 2500, 5000] as const;
export const DEFAULT_BUDGET_TEXT = "25";

export const TEXT_SHORT_ERROR = `Tell us a little more (at least ${TEXT_MIN} characters).`;
export const TEXT_LONG_ERROR = `Keep it to ${TEXT_MAX} characters or fewer.`;
export const BUDGET_EMPTY_ERROR = "Enter a budget in dollars.";
export const BUDGET_MIN_ERROR = `The smallest budget is ${formatUsd(MIN_DONATION_CENTS)}.`;
export const BUDGET_MAX_ERROR = `The largest budget is ${formatUsd(MAX_DONATION_CENTS)}.`;

/** What the donor typed, as `MatchReq` will see it. */
export const trimmedLength = (text: string) => text.trim().length;

export function textError(text: string): string | null {
  const length = trimmedLength(text);
  if (length < TEXT_MIN) return TEXT_SHORT_ERROR;
  if (length > TEXT_MAX) return TEXT_LONG_ERROR;
  return null;
}

export type BudgetCheck = { ok: true; cents: number } | { ok: false; error: string };

/** "25" → 2500, "12.50" → 1250. $1 to $1,000, like a gift (`MatchReq.budgetCents`). */
export function checkBudget(text: string): BudgetCheck {
  if (text.trim() === "") return { ok: false, error: BUDGET_EMPTY_ERROR };
  const cents = parseDollarsToCents(text);
  // Well-formed but too big to count exactly is still just "too much".
  if (cents === null) return { ok: false, error: /^\d+(\.\d{1,2})?$/.test(text) ? BUDGET_MAX_ERROR : FORMAT_ERROR };
  if (cents < MIN_DONATION_CENTS) return { ok: false, error: BUDGET_MIN_ERROR };
  if (cents > MAX_DONATION_CENTS) return { ok: false, error: BUDGET_MAX_ERROR };
  return { ok: true, cents };
}

export type MatchFormErrors = { text: string | null; budget: string | null };
export type MatchFormCheck = { ok: true; req: MatchReq } | { ok: false; errors: MatchFormErrors };

/** The request to send (exactly `MatchReq`, text trimmed by the schema), or what to fix first. */
export function checkMatchForm(text: string, budgetText: string): MatchFormCheck {
  const budget = checkBudget(budgetText);
  const errors: MatchFormErrors = { text: textError(text), budget: budget.ok ? null : budget.error };
  if (errors.text !== null || !budget.ok) return { ok: false, errors };
  const parsed = MatchReq.safeParse({ text, budgetCents: budget.cents });
  if (parsed.success) return { ok: true, req: parsed.data };
  const fields = new Set(parsed.error.issues.map((issue) => issue.path[0]));
  return {
    ok: false,
    errors: {
      text: fields.has("text") ? TEXT_SHORT_ERROR : null,
      budget: fields.has("budgetCents") ? BUDGET_MIN_ERROR : null,
    },
  };
}

/** How a request failed, in the words the box shows. */
export type MatchFailure =
  { kind: "invalid"; message: string } | { kind: "busy" } | { kind: "resting"; message: string } | { kind: "other" };

export const BUSY_MESSAGE = "Too many tries, wait a minute.";
const RESTING_FALLBACK = "The AI is resting. Please try again later.";

export function matchFailure(error: unknown): MatchFailure {
  if (!(error instanceof ApiClientError)) return { kind: "other" };
  if (error.status === 400) return { kind: "invalid", message: error.message };
  if (error.status === 429) return { kind: "busy" };
  // B's free-tier guard: "The AI is resting, try again tomorrow" (or "…in a minute").
  if (error.status === 503) return { kind: "resting", message: error.message || RESTING_FALLBACK };
  return { kind: "other" };
}

/** "3 matches found" for the live region. */
export function matchesFound(count: number): string {
  if (count === 0) return "No matches found";
  return `${count} ${count === 1 ? "match" : "matches"} found`;
}

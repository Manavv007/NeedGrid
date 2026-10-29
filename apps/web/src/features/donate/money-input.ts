/**
 * The donor's amount choice, as pure functions. This only helps the donor pick something the server
 * will accept: the server re-checks every amount, clamps it to what's left and decides the charge.
 * No floating point anywhere: dollar text becomes cents by joining digit strings.
 */
import { formatUsd, MAX_DONATION_CENTS, MIN_DONATION_CENTS } from "@needgrid/shared";

/** Whole dollars with optional 1–2 decimals. No signs, spaces, exponents or thousands separators. */
const DOLLARS = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * "10.5" → 1050, "10" → 1000, "0.05" → 5. Returns null for anything else ("1.234", "-1", "abc", "",
 * "1e3", " 5", "+5") and for numbers too large to count exactly.
 */
export function parseDollarsToCents(input: string): number | null {
  const match = DOLLARS.exec(input);
  if (!match) return null;
  const [, dollars = "", fraction = ""] = match;
  const cents = Number(`${dollars}${fraction.padEnd(2, "0")}`);
  return Number.isSafeInteger(cents) ? cents : null;
}

export const FORMAT_ERROR = "Use dollars and cents, like 12.50.";
export const MIN_ERROR = `The minimum is ${formatUsd(MIN_DONATION_CENTS)}.`;
const maxError = (maxCents: number) => `The most you can give here is ${formatUsd(maxCents)}.`;

/** The biggest gift the panel offers for this item: what's left, capped at the per-checkout maximum. */
export function maxGiftCents(remainingCents: number): number {
  return Math.min(MAX_DONATION_CENTS, remainingCents);
}

export type OtherAmountCheck = { ok: true; cents: number } | { ok: false; error: string | null };

/** Validates the "Other" field. An empty field isn't an error yet (`error: null`), just not payable. */
export function checkOtherAmount(text: string, remainingCents: number): OtherAmountCheck {
  if (text === "") return { ok: false, error: null };
  const maxCents = maxGiftCents(remainingCents);
  const cents = parseDollarsToCents(text);
  // Well-formed but too big to count exactly is still just "too much".
  if (cents === null) return { ok: false, error: DOLLARS.test(text) ? maxError(maxCents) : FORMAT_ERROR };
  if (cents > maxCents) return { ok: false, error: maxError(maxCents) };
  if (cents < MIN_DONATION_CENTS) return { ok: false, error: MIN_ERROR };
  return { ok: true, cents };
}

// ---------- choices ----------

const PRESET_CENTS = [1000, 2500, 5000] as const;

/** Up to this much left, the panel starts on "Fund the rest" instead of $25. */
const REST_BY_DEFAULT_CENTS = 2500;

export type GiftChoice = { kind: "preset"; cents: number } | { kind: "rest" } | { kind: "other" };

/** Presets below what's left (a preset that would cover it all is just "Fund the rest"). */
export function presetsFor(remainingCents: number): number[] {
  return PRESET_CENTS.filter((cents) => cents < remainingCents);
}

/** Less than the minimum gift left: only "Fund the rest" is offered (DonateVariants.dc.html). */
export function onlyRestOffered(remainingCents: number): boolean {
  return remainingCents > 0 && remainingCents < MIN_DONATION_CENTS;
}

/** "Fund the rest" needs something left, and no more than one checkout may carry. */
export function restOffered(remainingCents: number): boolean {
  return remainingCents > 0 && remainingCents <= MAX_DONATION_CENTS;
}

export function defaultChoice(remainingCents: number): GiftChoice {
  return remainingCents <= REST_BY_DEFAULT_CENTS ? { kind: "rest" } : { kind: "preset", cents: 2500 };
}

/** Whether `choice` is still on offer, e.g. after the amount left changed. */
export function isOffered(choice: GiftChoice, remainingCents: number): boolean {
  if (choice.kind === "rest") return restOffered(remainingCents);
  if (onlyRestOffered(remainingCents)) return false;
  if (choice.kind === "other") return remainingCents >= MIN_DONATION_CENTS;
  return presetsFor(remainingCents).includes(choice.cents);
}

/**
 * What the donor picked: `displayCents` is what the panel shows ("give $14.00"), `requestCents` what
 * the browser asks the server for. They differ only when less than the minimum is left: the API
 * accepts requests from MIN_DONATION_CENTS, so the panel asks for that and the server clamps it to
 * the remainder (money rule 3), exactly what "Fund the rest ($0.60)" promised.
 */
export type Gift = { requestCents: number; displayCents: number };

export function resolveGift(choice: GiftChoice, otherText: string, remainingCents: number): Gift | null {
  if (!isOffered(choice, remainingCents)) return null;
  if (choice.kind === "preset") return { requestCents: choice.cents, displayCents: choice.cents };
  if (choice.kind === "rest") {
    const requestCents = remainingCents < MIN_DONATION_CENTS ? MIN_DONATION_CENTS : remainingCents;
    return { requestCents, displayCents: remainingCents };
  }
  const other = checkOtherAmount(otherText, remainingCents);
  return other.ok ? { requestCents: other.cents, displayCents: other.cents } : null;
}

/** "60 cents" for the tiny-remainder explainer. */
export function formatCentsWords(cents: number): string {
  return cents === 1 ? "1 cent" : `${cents} cents`;
}

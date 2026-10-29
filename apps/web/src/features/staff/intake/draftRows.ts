/**
 * The intake review screen's rows, as plain data and pure functions (no React). A row starts as the
 * AI's `DraftNeed` and then belongs to staff: they edit it here, in the browser, until they publish.
 *
 * Money rules: the browser sends IDs, chosen products and *requested* values only. The target shown
 * here is a labelled estimate from the shared `computeTargetCents`; the server computes the real one
 * (unless staff typed their own, which is sent as `targetCents` and still re-checked by the server).
 */
import {
  computeTargetCents,
  formatUsd,
  MIN_DONATION_CENTS,
  PublishNeedReq,
  type Category,
  type DraftNeed,
  type IntakeRes,
  type ProductOption,
  type ProductSnapshot,
} from "@needgrid/shared";
import { parseDollarsToCents } from "@/features/donate/money-input";

export type UrgencyLevel = 1 | 2 | 3;

export type DraftRow = {
  /** `draftId` from the server: a temporary id for React keys and radio group names. */
  id: string;
  /** Staff's tick. What actually counts is `isIncluded`, which also needs a product and a target. */
  included: boolean;
  title: string;
  /** Typed text, so half-typed values don't fight the user. */
  quantity: string;
  unit: string;
  category: Category;
  urgency: UrgencyLevel;
  /** "" or YYYY-MM-DD (the date input's value). */
  deadline: string;
  description: string;
  /** 0 to 1. Under `LOW_CONFIDENCE` the row is flagged "Please check". */
  confidence: number;
  notes: string | null;
  /** Up to 3, best first. Empty = no product found. */
  options: ProductOption[];
  /** Index into `options`. */
  selected: number;
  /** The server's target for `options[0]`; null when it couldn't tell how many packs are needed. */
  suggestedTargetCents: number | null;
  /** Dollars typed by staff to override the target; null = use the estimate. */
  targetText: string | null;
};

export const LOW_CONFIDENCE = 0.6;
export const MAX_QUANTITY = 10_000;
const MAX_TITLE = 120;
const MIN_TITLE = 2;
const MAX_UNIT = 30;
const MAX_DESCRIPTION = 1000;

export const isLowConfidence = (row: Pick<DraftRow, "confidence">) => row.confidence < LOW_CONFIDENCE;

function toUrgency(value: number): UrgencyLevel {
  return value >= 3 ? 3 : value <= 1 ? 1 : 2;
}

export function rowFromDraft(draft: DraftNeed): DraftRow {
  const e = draft.extracted;
  const row: DraftRow = {
    id: draft.draftId,
    included: false,
    title: e.title,
    quantity: String(e.quantity),
    unit: e.unit,
    category: e.category,
    urgency: toUrgency(e.urgency),
    deadline: "",
    description: "",
    confidence: e.confidence,
    notes: e.notes,
    options: draft.options,
    selected: 0,
    suggestedTargetCents: draft.suggestedTargetCents,
    targetText: null,
  };
  // Design: rows without a product start unticked. So do rows the server couldn't price.
  return { ...row, included: canInclude(row) };
}

// ---------- fields ----------

/** A whole number from 1 to 10 000, else null. */
export function parseQuantity(text: string): number | null {
  if (!/^\d{1,5}$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= MAX_QUANTITY ? n : null;
}

export function selectedOption(row: Pick<DraftRow, "options" | "selected">): ProductOption | null {
  return row.options[row.selected] ?? null;
}

/** A date input value → the end of that day in UTC, as the API wants it. Null if it isn't a real date. */
export function deadlineIso(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const iso = `${date}T23:59:59.000Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== iso ? null : iso;
}

// ---------- target ----------

/** The typed override in cents; null when there is none or it isn't a valid amount of at least $1. */
export function overrideCents(row: Pick<DraftRow, "targetText">): number | null {
  if (row.targetText === null) return null;
  const cents = parseDollarsToCents(row.targetText.trim());
  return cents !== null && cents >= MIN_DONATION_CENTS ? cents : null;
}

/** What is wrong with the typed override, or null if there is none (or it is still empty). */
export function overrideProblem(row: Pick<DraftRow, "targetText">): string | null {
  if (row.targetText === null || row.targetText.trim() === "") return null;
  const cents = parseDollarsToCents(row.targetText.trim());
  if (cents === null) return "Use dollars and cents, like 84.00.";
  return cents < MIN_DONATION_CENTS ? `The target must be at least ${formatUsd(MIN_DONATION_CENTS)}.` : null;
}

/**
 * The labelled estimate: `computeTargetCents(selected unit price, quantity)`. Null without a product,
 * without a usable quantity, or when the server couldn't tell how many packs this item needs
 * (`suggestedTargetCents` null): guessing there could overshoot, so staff set the target themselves.
 */
export function estimateCents(row: DraftRow): number | null {
  const option = selectedOption(row);
  const quantity = parseQuantity(row.quantity);
  if (!option || quantity === null || row.suggestedTargetCents === null) return null;
  return computeTargetCents(option.unitPriceCents, quantity);
}

export type TargetView =
  | { kind: "estimate"; cents: number }
  | { kind: "override"; cents: number }
  | { kind: "needsTarget" }
  | { kind: "needsQuantity" };

/** What the target line shows for a row that has a product. */
export function targetView(row: DraftRow): TargetView {
  const override = overrideCents(row);
  if (override !== null) return { kind: "override", cents: override };
  if (row.suggestedTargetCents === null) return { kind: "needsTarget" };
  const estimate = estimateCents(row);
  return estimate === null ? { kind: "needsQuantity" } : { kind: "estimate", cents: estimate };
}

/** The target this row would be published with, as far as the browser can tell. */
export function effectiveTargetCents(row: DraftRow): number | null {
  const view = targetView(row);
  return view.kind === "estimate" || view.kind === "override" ? view.cents : null;
}

// ---------- ticking and publishing ----------

/** A row can be ticked once it has a product and a target (the server's, an estimate, or staff's own). */
export function canInclude(row: DraftRow): boolean {
  return selectedOption(row) !== null && (row.suggestedTargetCents !== null || overrideCents(row) !== null);
}

export const isIncluded = (row: DraftRow) => row.included && canInclude(row);

/**
 * Applies staff's edits. A row that just became publishable (it got a product or a target) is
 * ticked; one that can't be published any more is unticked, so it never goes out by mistake.
 */
export function withChanges(row: DraftRow, changes: Partial<Omit<DraftRow, "id">>): DraftRow {
  const next = { ...row, ...changes };
  if (!canInclude(next)) return { ...next, included: false };
  if (!canInclude(row) && changes.included === undefined) return { ...next, included: true };
  return next;
}

export type FieldErrors = Partial<
  Record<"title" | "quantity" | "unit" | "description" | "deadline" | "target", string>
>;

/** Instant checks that mirror `PublishNeedReq`. The server re-checks everything. */
export function fieldErrors(row: DraftRow): FieldErrors {
  const errors: FieldErrors = {};
  const title = row.title.trim();
  if (title.length < MIN_TITLE) errors.title = "Give the item a name.";
  else if (title.length > MAX_TITLE) errors.title = `Keep the name under ${MAX_TITLE} characters.`;
  if (parseQuantity(row.quantity) === null) errors.quantity = `Enter a whole number from 1 to ${MAX_QUANTITY}.`;
  const unit = row.unit.trim();
  if (unit === "") errors.unit = "Add a unit, like can or pack.";
  else if (unit.length > MAX_UNIT) errors.unit = `Keep it under ${MAX_UNIT} characters.`;
  if (row.description.length > MAX_DESCRIPTION) errors.description = `Keep it under ${MAX_DESCRIPTION} characters.`;
  if (row.deadline !== "" && deadlineIso(row.deadline) === null) errors.deadline = "Choose a real date.";
  const target = overrideProblem(row);
  if (target) errors.target = target;
  return errors;
}

export const hasErrors = (row: DraftRow) => Object.keys(fieldErrors(row)).length > 0;

/** The "estimated total" in the sticky bar: the targets of the ticked rows that have one. */
export function estimatedTotalCents(rows: readonly DraftRow[]): number {
  return rows.filter(isIncluded).reduce((sum, row) => sum + (effectiveTargetCents(row) ?? 0), 0);
}

/** The product exactly as the API stores it: no AI fit score, reason or per-item price. */
export function toSnapshot(option: ProductOption): ProductSnapshot {
  return {
    channel3Id: option.channel3Id,
    title: option.title,
    imageUrl: option.imageUrl,
    retailer: option.retailer,
    url: option.url,
    unitPriceCents: option.unitPriceCents,
    packSize: option.packSize,
    inStock: option.inStock,
    fetchedAt: option.fetchedAt,
  };
}

/**
 * The body for `POST /api/staff/needs`. `product` is the chosen option and `alternatives` the others,
 * both stripped to a `ProductSnapshot`. `targetCents` is only present when staff typed one; otherwise
 * the server computes the target itself. Throws if the row isn't ready (callers check `isIncluded` and
 * `hasErrors` first).
 */
export function buildPublishRequest(row: DraftRow, publish: boolean): PublishNeedReq {
  const option = selectedOption(row);
  const quantity = parseQuantity(row.quantity);
  if (!option || quantity === null) throw new Error("This item needs a product and a quantity first.");
  const override = overrideCents(row);
  return PublishNeedReq.parse({
    title: row.title.trim(),
    description: row.description.trim(),
    category: row.category,
    urgency: row.urgency,
    quantity,
    unit: row.unit.trim(),
    product: toSnapshot(option),
    alternatives: row.options.filter((_, index) => index !== row.selected).map(toSnapshot),
    ...(override === null ? {} : { targetCents: override }),
    deadlineAt: row.deadline === "" ? null : deadlineIso(row.deadline),
    publish,
  });
}

// ---------- pasted product links ----------

export type LinkOutcome = { ok: true; row: DraftRow } | { ok: false; problem: string };

const NO_PRODUCT_AT_LINK = "We couldn't find a product at that link. Try another link.";

/** Swap the product of a "no product found" row for the first option of a link-based intake result. */
export function applyLinkResult(row: DraftRow, result: IntakeRes): LinkOutcome {
  const draft = result.drafts[0];
  const option = draft?.options[0];
  if (!draft || !option) return { ok: false, problem: result.warnings[0] ?? NO_PRODUCT_AT_LINK };
  const updated = withChanges(row, {
    options: [option],
    selected: 0,
    suggestedTargetCents: draft.suggestedTargetCents,
    notes: draft.extracted.notes ?? row.notes,
    targetText: null,
  });
  return { ok: true, row: updated };
}

/** A pasted product link, if it is an http(s) URL (the API looks it up; anything else isn't sent). */
export function productLink(text: string): string | null {
  const trimmed = text.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? trimmed : null;
  } catch {
    return null;
  }
}

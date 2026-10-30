/**
 * The edit dialog as plain data and pure functions. The browser only helps: it locks fields the
 * server would refuse, checks formats instantly, and sends the fields staff changed. The server
 * (core/needs.ts → patchNeed) enforces every rule again, including the minimum target.
 */
import {
  centsToPayPalValue,
  PatchNeedReq,
  type NeedCard,
  type NeedStatus,
  type ProductSnapshot,
} from "@needgrid/shared";
import { parseDollarsToCents } from "@/features/donate/money-input";
import { deadlineIso, parseQuantity, type UrgencyLevel } from "@/features/staff/intake/draftRows";

export type EditForm = {
  title: string;
  description: string;
  urgency: UrgencyLevel;
  /** Typed text, so half-typed values don't fight the user. */
  quantity: string;
  /** Dollars, e.g. "84" or "84.50". */
  target: string;
  /** "" or YYYY-MM-DD (the date input's value). */
  deadline: string;
  /** `channel3Id` of the chosen product; "" when the need has none. */
  productId: string;
};

const MIN_TITLE = 2;
const MAX_TITLE = 120;
const MAX_DESCRIPTION = 1000;

/** Statuses whose target may change, and whose product may be swapped (patchNeed). */
const EDITABLE_TARGET: readonly NeedStatus[] = ["draft", "open", "topping_up", "funded"];
const PRE_FUNDING: readonly NeedStatus[] = ["draft", "open", "topping_up"];

/** The dialog is offered for every status the server lets staff edit. */
export const canEdit = (status: NeedStatus) => status !== "delivered" && status !== "closed";

function toUrgency(value: number): UrgencyLevel {
  return value >= 3 ? 3 : value <= 1 ? 1 : 2;
}

/** 8400 → "84", 8450 → "84.50" (display only). */
export function centsToDollarText(cents: number): string {
  return cents % 100 === 0 ? centsToPayPalValue(cents).slice(0, -3) : centsToPayPalValue(cents);
}

export function formFromNeed(need: NeedCard): EditForm {
  return {
    title: need.title,
    description: need.description,
    urgency: toUrgency(need.urgency),
    quantity: String(need.quantity),
    target: centsToDollarText(need.targetCents),
    // Deadlines are stored as the end of a day in UTC, so the UTC date is the day staff picked.
    deadline: need.deadlineAt ? need.deadlineAt.slice(0, 10) : "",
    productId: need.product?.channel3Id ?? "",
  };
}

export type EditLocks = {
  /** Why the quantity can't change, or null. */
  quantity: string | null;
  target: string | null;
  product: string | null;
  /** Funded plus held: the server refuses a target below it. Shown as a hint, not enforced here. */
  minTargetCents: number;
};

/** Which fields the server would refuse to change right now, in words staff can act on. */
export function editLocks(need: NeedCard): EditLocks {
  const moneyIn = need.fundedCents + need.heldCents;
  return {
    quantity: moneyIn > 0 ? "Quantity is locked because donations came in." : null,
    target: EDITABLE_TARGET.includes(need.status) ? null : `The target can't change once the item is ${need.status}.`,
    product: PRE_FUNDING.includes(need.status) ? null : "The product can only change before the item is funded.",
    minTargetCents: moneyIn,
  };
}

/** The current product first, then the alternatives saved with the need (no duplicates). */
export function productChoices(need: NeedCard, alternatives: readonly ProductSnapshot[]): ProductSnapshot[] {
  const all = need.product ? [need.product, ...alternatives] : [...alternatives];
  return all.filter((p, index) => all.findIndex((q) => q.channel3Id === p.channel3Id) === index);
}

export type EditErrors = Partial<Record<"title" | "description" | "quantity" | "target" | "deadline", string>>;

/** Instant format checks that mirror `PatchNeedReq`. */
export function editErrors(form: EditForm, locks: EditLocks): EditErrors {
  const errors: EditErrors = {};
  const title = form.title.trim();
  if (title.length < MIN_TITLE) errors.title = "Give the item a name.";
  else if (title.length > MAX_TITLE) errors.title = `Keep the name under ${MAX_TITLE} characters.`;
  if (form.description.trim().length > MAX_DESCRIPTION) {
    errors.description = `Keep it under ${MAX_DESCRIPTION} characters.`;
  }
  if (!locks.quantity && parseQuantity(form.quantity.trim()) === null) {
    errors.quantity = "Enter a whole number from 1 to 10,000.";
  }
  if (!locks.target && parseDollarsToCents(form.target.trim()) === null) {
    errors.target = "Use dollars and cents, like 84.00.";
  }
  if (form.deadline !== "" && deadlineIso(form.deadline) === null) errors.deadline = "Choose a real date.";
  return errors;
}

/**
 * The PATCH body: only what differs from `initial` (the need as the dialog opened), so a change
 * someone else made meanwhile is never overwritten with old values. Call after `editErrors` is empty.
 */
export function buildPatch(
  initial: EditForm,
  form: EditForm,
  locks: EditLocks,
  products: readonly ProductSnapshot[],
): PatchNeedReq {
  const patch: PatchNeedReq = {};
  const title = form.title.trim();
  if (title !== initial.title.trim()) patch.title = title;
  const description = form.description.trim();
  if (description !== initial.description.trim()) patch.description = description;
  if (form.urgency !== initial.urgency) patch.urgency = form.urgency;
  if (!locks.quantity && form.quantity.trim() !== initial.quantity) {
    const quantity = parseQuantity(form.quantity.trim());
    if (quantity !== null && String(quantity) !== initial.quantity) patch.quantity = quantity;
  }
  if (!locks.target) {
    const cents = parseDollarsToCents(form.target.trim());
    const initialCents = parseDollarsToCents(initial.target);
    if (cents !== null && cents !== initialCents) patch.targetCents = cents;
  }
  if (form.deadline !== initial.deadline) patch.deadlineAt = form.deadline === "" ? null : deadlineIso(form.deadline);
  if (!locks.product && form.productId !== initial.productId) {
    const product = products.find((p) => p.channel3Id === form.productId);
    if (product) patch.product = product;
  }
  return PatchNeedReq.parse(patch);
}

export const isEmptyPatch = (patch: PatchNeedReq) => Object.keys(patch).length === 0;

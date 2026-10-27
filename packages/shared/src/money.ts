/** All money is integer cents. This file is the ONLY place that converts to/from decimal strings. */

export const TARGET_BUFFER_BPS = 800; // +8% for tax & shipping
export const MIN_DONATION_CENTS = 100; // $1 (a smaller remaining amount may still be donated to finish a tile)
export const MAX_DONATION_CENTS = 100_000; // $1,000 per checkout in the demo
export const HOLD_MINUTES = 15;
export const DELIVERY_MATCH_THRESHOLD = 0.6; // below → needs human review

export function assertCents(n: number, label = "amount"): number {
  if (!Number.isSafeInteger(n)) throw new Error(`${label} must be an integer number of cents, got ${n}`);
  return n;
}

/** unit × quantity, +8%, rounded UP to the whole dollar. Example: 2 × 3849 → 7698 → 8313.84 → 8314 → 8400. */
export function computeTargetCents(unitPriceCents: number, quantity: number, bufferBps = TARGET_BUFFER_BPS): number {
  assertCents(unitPriceCents, "unitPriceCents");
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error("quantity must be a positive integer");
  const raw = unitPriceCents * quantity;
  const buffered = Math.ceil((raw * (10_000 + bufferBps)) / 10_000);
  return Math.ceil(buffered / 100) * 100;
}

export function remainingCents(n: { targetCents: number; fundedCents: number; heldCents: number }): number {
  return Math.max(0, n.targetCents - n.fundedCents - n.heldCents);
}

/** Rule 3: amount = min(requested, remaining). Returns null when nothing is left. */
export function clampDonation(
  requestedCents: number,
  remaining: number,
): { amountCents: number; wasClamped: boolean } | null {
  assertCents(requestedCents, "requestedCents");
  if (remaining <= 0) return null;
  const amountCents = Math.min(requestedCents, remaining);
  return { amountCents, wasClamped: amountCents < requestedCents };
}

/** Rule 6: at capture time, split the captured amount into what still fits the tile and the overflow. */
export function splitCapture(
  capturedCents: number,
  roomNowCents: number,
): { directCents: number; overflowCents: number } {
  assertCents(capturedCents, "capturedCents");
  const directCents = Math.max(0, Math.min(capturedCents, roomNowCents));
  return { directCents, overflowCents: capturedCents - directCents };
}

export type PurchaseMoney =
  | { kind: "exact" }
  | { kind: "surplus"; cents: number } // cheaper: move surplus to the next need (price_drop)
  | { kind: "gap"; cents: number }; // pricier: raise target, need goes to topping_up

/** Rule 7. newTargetCents = computeTargetCents(newUnitPrice, quantity). */
export function planPurchaseMoney(fundedCents: number, newTargetCents: number): PurchaseMoney {
  assertCents(fundedCents, "fundedCents");
  assertCents(newTargetCents, "newTargetCents");
  if (fundedCents === newTargetCents) return { kind: "exact" };
  if (fundedCents > newTargetCents) return { kind: "surplus", cents: fundedCents - newTargetCents };
  return { kind: "gap", cents: newTargetCents - fundedCents };
}

/**
 * Deterministically take `amountCents` back out of a need's existing positive allocations,
 * newest donation first. Used for price_drop surplus moves and refunds so that every
 * donation's allocations still sum to what that donation paid.
 */
export function takeFromAllocations(
  allocations: ReadonlyArray<{ donationId: string; amountCents: number; createdAt: string }>,
  amountCents: number,
): Array<{ donationId: string; amountCents: number }> {
  assertCents(amountCents);
  const byDonation = new Map<string, { net: number; latest: string }>();
  for (const a of allocations) {
    const cur = byDonation.get(a.donationId) ?? { net: 0, latest: a.createdAt };
    cur.net += a.amountCents;
    if (a.createdAt > cur.latest) cur.latest = a.createdAt;
    byDonation.set(a.donationId, cur);
  }
  const ordered = [...byDonation.entries()]
    .filter(([, v]) => v.net > 0)
    .sort((x, y) => (x[1].latest < y[1].latest ? 1 : x[1].latest > y[1].latest ? -1 : x[0] < y[0] ? -1 : 1));
  const out: Array<{ donationId: string; amountCents: number }> = [];
  let left = amountCents;
  for (const [donationId, v] of ordered) {
    if (left === 0) break;
    const take = Math.min(left, v.net);
    out.push({ donationId, amountCents: take });
    left -= take;
  }
  if (left !== 0) throw new Error("takeFromAllocations: not enough allocated money");
  return out;
}

/** 8400 → "84.00" (PayPal amount.value). */
export function centsToPayPalValue(cents: number): string {
  assertCents(cents);
  if (cents < 0) throw new Error("negative amount");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** "84.00" | "84.5" | "84" → 8400 | 8450 | 8400. No float math. */
export function payPalValueToCents(value: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) throw new Error(`invalid money string: ${value}`);
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** Dollars from an external API (e.g. Channel3 returns 38.49). Boundary use only. */
export function dollarsToCents(dollars: number): number {
  if (!Number.isFinite(dollars) || dollars < 0) throw new Error(`invalid dollars: ${dollars}`);
  return Math.round(dollars * 100);
}

/** Display only. Dashboard datasets use this for *Usd fields. */
export function centsToUsdNumber(cents: number): number {
  return Math.round(cents) / 100;
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

// Display-only formatting. Never use these results for maths.
import type { Category, NeedStatus } from "@needgrid/shared";

export { formatUsd } from "@needgrid/shared";

const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Tiles and stats: "$14" for whole dollars, "$14.50" otherwise. */
export function formatUsdShort(cents: number): string {
  return cents % 100 === 0 ? usdWhole.format(cents / 100) : usdCents.format(cents / 100);
}

/** "$14 left", or "$5 more needed" while a tile is topping up after a price rise (TileStates.dc.html). */
export function formatLeft(
  status: NeedStatus,
  remainingCents: number,
  format: (cents: number) => string = formatUsdShort,
): string {
  return status === "topping_up" ? `${format(remainingCents)} more needed` : `${format(remainingCents)} left`;
}

/** Headline totals ("Raised $1,284"): whole dollars, cents dropped so a total is never overstated. */
export function formatUsdWhole(cents: number): string {
  return usdWhole.format(Math.floor(cents / 100));
}

/** "No donors yet", "1 donor", "6 donors". */
export function formatDonorCount(count: number): string {
  if (count === 0) return "No donors yet";
  return `${count.toLocaleString("en-US")} ${count === 1 ? "donor" : "donors"}`;
}

/** Plain-English category names for donors (chips, labels). */
export const CATEGORY_LABELS: Readonly<Record<Category, string>> = {
  food: "Food",
  hygiene: "Hygiene",
  baby: "Baby",
  clothing: "Clothing",
  bedding: "Bedding",
  school: "School supplies",
  pet: "Pet supplies",
  medical: "Medical",
  household: "Household",
  other: "Other",
};

/** Share of `whole` as a whole-number percentage between 0 and 100, for labels like "83%". */
export function percentOf(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((part / whole) * 100)));
}

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

/** "Oct 24". Dates are shown in UTC so every viewer sees the same day as the server. */
export function formatShortDate(iso: string): string {
  return shortDate.format(new Date(iso));
}

/** Deadlines: the weekday ("Fri") when it's within the next 6 days, otherwise "Nov 14". */
export function formatDeadline(iso: string, now: Date = new Date()): string {
  const days = (new Date(iso).getTime() - now.getTime()) / 86_400_000;
  return days >= 0 && days < 6 ? weekday.format(new Date(iso)) : formatShortDate(iso);
}

/** "Fri" / "Nov 14" for a deadline still ahead; null when there is none or it has passed. */
export function formatNeededBy(iso: string | null, now: Date = new Date()): string | null {
  if (iso === null || new Date(iso).getTime() < now.getTime()) return null;
  return formatDeadline(iso, now);
}

/** Staff-facing urgency names (design-ref README): 3 = Urgent, 2 = Medium, 1 = Low. */
export const STAFF_URGENCY_LABELS = { 1: "Low", 2: "Medium", 3: "Urgent" } as const;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * "just now", "12 min ago", "2 h ago", "Yesterday", "3 days ago", then a date ("Oct 24") after a
 * week. Used where staff want to know how fresh a row is.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const elapsed = now.getTime() - new Date(iso).getTime();
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} h ago`;
  const days = Math.floor(elapsed / DAY_MS);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return formatShortDate(iso);
}

/** "26¢ each" under a dollar, "$1.25 each" above (the price of one item in a pack). */
export function formatPerItem(cents: number): string {
  return cents < 100 ? `${cents}¢ each` : `${usdCents.format(cents / 100)} each`;
}

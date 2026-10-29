// Display-only formatting. Never use these results for maths.
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

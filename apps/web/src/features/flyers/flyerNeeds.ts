/** What goes on a printed flyer. Pure functions over needs the server already sent. */
import type { NeedCard } from "@needgrid/shared";
import { compareMostUrgent, isDonatable } from "@/features/tiles/filterNeeds";

/** A flyer lists at most this many items (Flyer.dc.html). */
export const FLYER_MAX_ITEMS = 6;

/** Worth printing: takes donations and still has something left (a fully held tile has nothing to give to). */
export const isFundable = (need: NeedCard) => isDonatable(need.status) && need.remainingCents > 0;

/** Up to 6 needs that still take money, most urgent first. */
export function flyerNeeds(needs: readonly NeedCard[]): NeedCard[] {
  return needs.filter(isFundable).sort(compareMostUrgent).slice(0, FLYER_MAX_ITEMS);
}

/** "Help us get these 6 items" (or "this item"). */
export function flyerHeadline(count: number): string {
  return count === 1 ? "Help us get this item" : `Help us get these ${count} items`;
}

/** "needgrid.app/o/harbor-food-bank": the address in words under the QR code, without "https://". */
export function shortUrl(href: string): string {
  const url = new URL(href);
  return `${url.host}${url.pathname}`;
}

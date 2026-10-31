/**
 * Words and order for the donor's impact page. Display only: amounts, statuses and photos are the
 * server's (`ImpactRes`); nothing here adds money up or decides anything.
 */
import type { AllocationReason, ImpactItem, NeedStatus } from "@needgrid/shared";

/** How far along each status is, for "the rest by status progress" (furthest first). */
const PROGRESS: Readonly<Record<NeedStatus, number>> = {
  delivered: 5,
  ordered: 4,
  funded: 3,
  topping_up: 2,
  open: 1,
  closed: 0,
  draft: 0,
};

/** When the donor can see it arrived: a delivered need with its public delivery. */
export function arrivedAt(item: ImpactItem): string | null {
  return item.need.status === "delivered" && item.delivery ? item.delivery.deliveredAt : null;
}

/**
 * Arrivals first (newest photo first), then the rest by how far along they are. Ties keep the
 * server's order (the order the gift was placed in).
 */
export function sortImpactItems(items: readonly ImpactItem[]): ImpactItem[] {
  return [...items].sort((a, b) => {
    const aAt = arrivedAt(a);
    const bAt = arrivedAt(b);
    if (aAt !== null && bAt !== null) return bAt.localeCompare(aAt);
    if (aAt !== null) return -1;
    if (bAt !== null) return 1;
    return PROGRESS[b.need.status] - PROGRESS[a.need.status];
  });
}

/** Why the money is on this item, when it isn't simply the item the donor picked. */
export function reasonLabel(reason: AllocationReason): string | null {
  switch (reason) {
    case "direct":
      return null;
    case "overflow":
    case "rollover":
    case "price_drop":
      return "sent to the next most urgent need";
    case "sponsor":
      return "sponsor gift";
    case "refund":
      return "refunded";
  }
}

/**
 * The item's name inside a sentence: "Diapers, size 3" → "diapers", "Women's socks" → "women's
 * socks". The part before the first comma, first letter lowercased unless it looks like an acronym.
 */
export function itemName(title: string): string {
  const name = title.split(",")[0]?.trim() || title.trim();
  const [first = "", second = ""] = name;
  return second !== "" && second === second.toLowerCase() ? `${first.toLowerCase()}${name.slice(1)}` : name;
}

/** "Hi Sam, your diapers arrived." / "Your diapers arrived." / "Hi Sam, thanks for giving." */
export function impactHeadline(donorFirstName: string | null, sorted: readonly ImpactItem[]): string {
  const delivered = sorted.find((item) => item.need.status === "delivered");
  const name = donorFirstName?.trim() ?? "";
  const main = delivered ? `your ${itemName(delivered.need.title)} arrived.` : "thanks for giving.";
  return name !== "" ? `Hi ${name}, ${main}` : `${main.charAt(0).toUpperCase()}${main.slice(1)}`;
}

/**
 * Words for live changes. Pure functions over the server's cards: no money maths, the amounts are
 * the server's `remainingCents`.
 */
import type { NeedCard } from "@needgrid/shared";
import { isDonatable } from "@/features/tiles/filterNeeds";
import { formatLeft } from "@/lib/format";
import type { NeedUpdate } from "@/lib/sse";

/** The update moved a need into `funded` (the moment the big screen celebrates). */
export function becameFunded({ card, previous }: NeedUpdate): boolean {
  return previous !== null && previous.status !== "funded" && card.status === "funded";
}

function leftText(card: NeedCard): string {
  return card.remainingCents > 0
    ? `${card.title}: ${formatLeft(card.status, card.remainingCents)}`
    : `${card.title}: donors are paying for the rest right now`;
}

/**
 * What a screen reader hears, e.g. "Diapers, size 4: $14 left" or "Diapers, size 4 is fully funded".
 * Null when nothing a donor would notice changed (or the need isn't public).
 */
export function liveMessage({ card, previous }: NeedUpdate): string | null {
  const statusChanged = previous === null || previous.status !== card.status;
  switch (card.status) {
    case "open":
    case "topping_up":
      if (previous === null) return `New item: ${leftText(card)}`;
      if (!statusChanged && isDonatable(previous.status) && previous.remainingCents === card.remainingCents) {
        return null;
      }
      return leftText(card);
    case "funded":
      return statusChanged ? `${card.title} is fully funded` : null;
    case "ordered":
      return statusChanged ? `${card.title} has been ordered` : null;
    case "delivered":
      return statusChanged ? `${card.title} was delivered` : null;
    default:
      return null;
  }
}

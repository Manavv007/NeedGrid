/**
 * Rules and words for recording a delivery. The server decides everything that matters (the match
 * score, whether staff must review, the need's status); these only read what it sent.
 */
import type { DeliveryView } from "@needgrid/shared";
import { ApiClientError } from "@/lib/api";
import { errorMessage } from "../errorMessage";
import { AI_NOT_SET_UP } from "../manage/purchases";

/** Same limit as `DeliveryReq.staffNote` and `ConfirmDeliveryReq.message`. */
export const MAX_NOTE_LENGTH = 500;

/** B's `aiNotes` when the vision call fails (AGENT_B_AI_DATA.md §9.4), always with `matchScore` 0. */
export const VISION_UNAVAILABLE_NOTES = "Automatic check unavailable; please confirm.";

export const PHOTO_CHECK_FAILED = "The photo check didn't answer, try again.";
const CHECK_FALLBACK = "We couldn't check the photo. Please try again.";

/** The latest delivery when staff still have to look at it (donors don't see it until they confirm). */
export function deliveryToReview(delivery: DeliveryView | null): DeliveryView | null {
  return delivery !== null && delivery.needsReview && delivery.confirmedAt === null ? delivery : null;
}

/** The vision call failed: the server stored score 0 with B's fixed note, so there is no real score. */
export function checkDidNotRun(delivery: Pick<DeliveryView, "matchScore" | "aiNotes">): boolean {
  return delivery.matchScore === 0 && delivery.aiNotes.trim() === VISION_UNAVAILABLE_NOTES;
}

/**
 * What confirm sends as `message`: the text only when staff changed the server's message or wrote
 * one (trimmed). An emptied message is sent as "" (no message); unchanged sends nothing.
 */
export function editedMessage(original: string | null, draft: string): string | undefined {
  const next = draft.trim();
  return next === (original ?? "").trim() ? undefined : next;
}

/** A donor message worth showing (the server may store an empty one when staff cleared it). */
export function hasMessage(message: string | null): boolean {
  return message !== null && message.trim() !== "";
}

/** Why "Check delivery" failed, in staff words. Refusals (400, 404, 409) are the server's own message. */
export function deliveryErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 503) return AI_NOT_SET_UP;
    if (error.status === 502) return PHOTO_CHECK_FAILED;
  }
  return errorMessage(error, CHECK_FALLBACK);
}

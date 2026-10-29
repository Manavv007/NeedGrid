import { ApiClientError } from "@/lib/api";
import { UploadError } from "@/lib/cloudinary";

export const RATE_LIMITED_MESSAGE = "Too many tries, wait a minute.";
export const AI_NOT_SET_UP_MESSAGE = "AI isn't set up on this server.";
export const AI_DID_NOT_ANSWER_MESSAGE = "The AI didn't answer, try again.";
export const INTAKE_FALLBACK_MESSAGE = "We couldn't read that. Please try again.";
export const NO_ITEMS_MESSAGE = "We couldn't find any items. Try a clearer photo, or type the list.";

/**
 * What staff read when `POST /api/staff/intake` (or the photo upload before it) fails. The route
 * allows 10 requests a minute (429), answers 503 when no AI key is configured and 502 when Gemini
 * fails; everything else gets a friendly retry. Nothing is ever saved by a failed intake.
 */
export function intakeErrorMessage(error: unknown): string {
  if (error instanceof UploadError) return error.message;
  if (error instanceof ApiClientError) {
    if (error.status === 429) return RATE_LIMITED_MESSAGE;
    if (error.status === 503) return AI_NOT_SET_UP_MESSAGE;
    if (error.status === 502) return AI_DID_NOT_ANSWER_MESSAGE;
    if (error.code === "NETWORK") return error.message;
  }
  return INTAKE_FALLBACK_MESSAGE;
}

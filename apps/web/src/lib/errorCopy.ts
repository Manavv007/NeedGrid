import { ApiClientError } from "./api";

/** Who reads the message. Only donors are told their gifts are safe; staff get plain facts. */
export type Audience = "donor" | "staff";

/** `error`: something failed (red icon, role="alert"). `notice`: nothing is broken, it just isn't there yet. */
export type ErrorTone = "error" | "notice";

export type ErrorCopy = { message: string; tone: ErrorTone; title?: string };

export const NETWORK_COPY = "Check your connection and try again.";
export const SERVER_COPY = "Something went wrong on our side. Please try again in a moment.";
export const RATE_LIMITED_COPY = "Too many tries in a minute. Wait a moment, then try again.";
export const GENERIC_COPY = "Something went wrong. Please try again.";
export const NOT_LIVE_TITLE = "Not available yet";
export const NOT_LIVE_COPY = "This part isn't switched on yet. It will show up here once it's live.";
export const RELOAD_COPY = "Reload the page to try again.";
const DONOR_LINE = "Your gifts are safe.";

type ErrorCopyOptions = {
  /**
   * The query is a staff list of a feature the server may not have switched on yet (invoices,
   * agent actions). A 404 there means the route doesn't exist yet, not that something broke.
   */
  optionalFeature?: boolean;
};

/**
 * What an ErrorState says for a failed query, from the ApiClientError's status/code and who is
 * reading. Specific cases (401 sign-out, not-found pages, server refusals in toasts) are handled by
 * their pages before this is reached.
 */
export function errorCopy(
  error: unknown,
  audience: Audience,
  { optionalFeature = false }: ErrorCopyOptions = {},
): ErrorCopy {
  if (optionalFeature && audience === "staff" && error instanceof ApiClientError && error.status === 404) {
    return { title: NOT_LIVE_TITLE, message: NOT_LIVE_COPY, tone: "notice" };
  }
  return { message: forAudience(failureCopy(error), audience), tone: "error" };
}

/** The whole page crashed (route or render error): reload, and for donors, their gifts are safe. */
export function reloadCopy(audience: Audience): string {
  return forAudience(RELOAD_COPY, audience);
}

/** Staff pages live under /staff; every other page (tile wall, need page, flyers, dashboard) is public. */
export function audienceForPath(pathname: string): Audience {
  return pathname === "/staff" || pathname.startsWith("/staff/") ? "staff" : "donor";
}

function failureCopy(error: unknown): string {
  if (!(error instanceof ApiClientError)) return GENERIC_COPY;
  if (error.status === 0 || error.code === "NETWORK") return NETWORK_COPY;
  // INTERNAL also covers a response that doesn't match the shared schema (a contract bug, status 200).
  if (error.status >= 500 || error.code === "INTERNAL") return SERVER_COPY;
  if (error.status === 429) return RATE_LIMITED_COPY;
  return GENERIC_COPY;
}

function forAudience(message: string, audience: Audience): string {
  return audience === "donor" ? `${message} ${DONOR_LINE}` : message;
}

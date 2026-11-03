/** Classifying database errors. No imports: safe to use from plugins and from money code. */

/** Node/pg error codes and messages that mean "couldn't reach the database", not "the query was wrong". */
const CONNECTION_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "57P01",
]);
const CONNECTION_MESSAGES =
  /timeout exceeded when trying to connect|Connection terminated|connection timeout|Query read timeout/i;

/**
 * True when the database couldn't be reached (network blip, Neon waking up, dropped socket).
 * Looks through drizzle's `cause` and Node's AggregateError (dual-stack connect: IPv4 + IPv6 both failed,
 * which arrives with an EMPTY message: that's what produced blank `500 INTERNAL` responses).
 */
export function isConnectionError(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== "object" || depth > 4) return false;
  const e = err as { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown };
  if (typeof e.code === "string" && CONNECTION_CODES.has(e.code)) return true;
  if (typeof e.message === "string" && CONNECTION_MESSAGES.test(e.message)) return true;
  if (Array.isArray(e.errors) && e.errors.some((x) => isConnectionError(x, depth + 1))) return true;
  return isConnectionError(e.cause, depth + 1);
}

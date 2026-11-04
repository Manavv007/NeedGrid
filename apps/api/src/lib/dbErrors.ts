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

/**
 * True only when the connection could not be OPENED (the query was never sent), so retrying is safe even
 * for writes. Mid-query drops ("Connection terminated", read timeouts) are excluded: the write may have run.
 */
export function isConnectFailure(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== "object" || depth > 4) return false;
  const e = err as { code?: unknown; syscall?: unknown; message?: unknown; cause?: unknown; errors?: unknown };
  if (typeof e.message === "string" && /timeout exceeded when trying to connect/i.test(e.message)) return true;
  if (typeof e.code === "string" && ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(e.code)) return true;
  if (e.code === "ETIMEDOUT" && e.syscall === "connect") return true;
  if (Array.isArray(e.errors) && e.errors.length > 0 && e.errors.every((x) => isConnectFailure(x, depth + 1)))
    return true;
  return isConnectFailure(e.cause, depth + 1);
}

/** Make pool.query (promise form) retry when the connection couldn't be opened. Safe: nothing was executed. */
export function retryConnectFailures<P extends { query: (...args: never[]) => unknown }>(pool: P, attempts = 5): P {
  const original = pool.query.bind(pool) as (...args: unknown[]) => unknown;
  (pool as { query: unknown }).query = (...args: unknown[]) => {
    if (typeof args[args.length - 1] === "function") return original(...args); // callback form: untouched
    return (async () => {
      for (let i = 1; ; i++) {
        try {
          return await (original(...args) as Promise<unknown>);
        } catch (err) {
          if (!isConnectFailure(err) || i >= attempts) throw err;
          await new Promise((r) => setTimeout(r, 1000 * 2 ** (i - 1)));
        }
      }
    })();
  };
  return pool;
}

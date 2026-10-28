/**
 * Minimal PayPal REST client (AGENT_A_BACKEND.md §8.1).
 *
 * - OAuth2 client-credentials token, cached until 60 s before it expires (concurrent callers share one fetch)
 * - JSON in/out, `Prefer: return=representation`
 * - `PayPal-Request-Id` on every POST (the caller passes a deterministic id, so retries are idempotent)
 * - retries 429 / 5xx / network errors up to 3 times (250 ms × 2ⁿ), same request id; refreshes the token once on 401
 * - failures throw PayPalApiError (HTTP 502 UPSTREAM to our clients) carrying PayPal's debug_id
 *
 * Never logs request bodies, headers or tokens.
 */
import { env } from "../env";
import { HttpError } from "../lib/http";

export const PAYPAL_BASE_URL =
  env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

/** Tunables; tests set baseDelayMs to 0. */
export const paypalClientConfig = { baseDelayMs: 250, timeoutMs: 20_000, maxRetries: 3 };

/** A failed PayPal call. Reaches our API clients as 502 UPSTREAM unless a caller maps it first. */
export class PayPalApiError extends HttpError {
  constructor(
    message: string,
    /** PayPal's HTTP status; 0 for network errors/timeouts. */
    public readonly paypalStatus: number,
    /** PayPal error name, e.g. UNPROCESSABLE_ENTITY. */
    public readonly paypalName: string | null,
    /** PayPal `details[].issue` codes, e.g. ORDER_ALREADY_CAPTURED. */
    public readonly issues: string[],
    public readonly debugId: string | null,
  ) {
    super(502, "UPSTREAM", message, debugId ? { paypalDebugId: debugId } : undefined);
    this.name = "PayPalApiError";
  }

  hasIssue(issue: string): boolean {
    return this.issues.includes(issue);
  }
}

interface PayPalErrorBody {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: Array<{ issue?: string }>;
  error?: string; // OAuth errors
  error_description?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt: number) => sleep(paypalClientConfig.baseDelayMs * 2 ** attempt);

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toPayPalError(status: number, body: unknown, fallback: string): PayPalApiError {
  const b = (body ?? {}) as PayPalErrorBody;
  const issues = (b.details ?? []).map((d) => d.issue).filter((i): i is string => typeof i === "string");
  const name = b.name ?? b.error ?? null;
  const detail = b.message ?? b.error_description ?? fallback;
  return new PayPalApiError(`PayPal request failed: ${detail}`, status, name, issues, b.debug_id ?? null);
}

// ---------------------------------------------------------------------------------------------
// OAuth token
// ---------------------------------------------------------------------------------------------

let cachedToken: { value: string; expiresAt: number } | null = null;
let tokenInFlight: Promise<string> | null = null;

async function fetchToken(): Promise<string> {
  const basic = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          authorization: `Basic ${basic}`,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(paypalClientConfig.timeoutMs),
      });
    } catch (err) {
      if (attempt < paypalClientConfig.maxRetries) {
        await backoff(attempt);
        continue;
      }
      throw new PayPalApiError(`PayPal is unreachable: ${(err as Error).message}`, 0, null, [], null);
    }
    const body = await readJson(res);
    if (res.ok) {
      const b = body as { access_token?: string; expires_in?: number };
      if (!b?.access_token) throw new PayPalApiError("PayPal returned no access token", res.status, null, [], null);
      const ttlMs = Math.max(0, ((b.expires_in ?? 300) - 60) * 1000);
      cachedToken = { value: b.access_token, expiresAt: Date.now() + ttlMs };
      return b.access_token;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < paypalClientConfig.maxRetries) {
      await backoff(attempt);
      continue;
    }
    // 401 here means bad client id/secret: not retryable.
    throw toPayPalError(res.status, body, "could not get an access token");
  }
}

export async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;
  if (forceRefresh) cachedToken = null;
  tokenInFlight ??= fetchToken().finally(() => {
    tokenInFlight = null;
  });
  return tokenInFlight;
}

/** Tests only. */
export function resetPayPalTokenCache(): void {
  cachedToken = null;
  tokenInFlight = null;
}

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

export interface PayPalRequestOptions {
  body?: unknown;
  /** Pre-serialised JSON body, sent byte-for-byte (webhook verification needs the exact event bytes). */
  rawBody?: string;
  /** Required for POST: makes retries (ours and the caller's) idempotent on PayPal's side. */
  requestId?: string;
  query?: Record<string, string>;
}

export async function paypalFetch<T = unknown>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  opts: PayPalRequestOptions = {},
): Promise<{ status: number; data: T }> {
  if (method === "POST" && !opts.requestId) throw new Error(`paypalFetch: POST ${path} needs a requestId`);
  const url = new URL(path, PAYPAL_BASE_URL);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);

  let refreshed = false;
  for (let attempt = 0; ; attempt++) {
    const token = await getAccessToken();
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      prefer: "return=representation",
    };
    // PayPal requires a JSON content type on every write, even body-less ones like capture (else 415).
    if (opts.body !== undefined || method !== "GET") headers["content-type"] = "application/json";
    if (opts.requestId) headers["paypal-request-id"] = opts.requestId;

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
        signal: AbortSignal.timeout(paypalClientConfig.timeoutMs),
      });
    } catch (err) {
      if (attempt < paypalClientConfig.maxRetries) {
        await backoff(attempt);
        continue;
      }
      throw new PayPalApiError(`PayPal is unreachable: ${(err as Error).message}`, 0, null, [], null);
    }

    if (res.status === 401 && !refreshed) {
      refreshed = true;
      await getAccessToken(true);
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < paypalClientConfig.maxRetries) {
      await backoff(attempt);
      continue;
    }

    const data = await readJson(res);
    if (!res.ok) throw toPayPalError(res.status, data, `${method} ${url.pathname} returned ${res.status}`);
    return { status: res.status, data: data as T };
  }
}

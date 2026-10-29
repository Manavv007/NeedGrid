import { ApiError, STAFF_KEY_HEADER, type ErrorCode } from "@needgrid/shared";
import type { z } from "zod";
import { env } from "@/env";
import { clearStaffKey, getStaffKey } from "./staffKey";
import { notifyUnauthorized } from "./unauthorized";

/** Every failed API call becomes one of these. `code` is the server's ErrorCode, or "NETWORK". */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ErrorCode | "NETWORK";
  readonly details: unknown;

  constructor(status: number, code: ErrorCode | "NETWORK", message: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type ApiOptions = { staff?: boolean; signal?: AbortSignal };

const NETWORK_MESSAGE = "We couldn't reach NeedGrid. Check your connection and try again.";
const CONTRACT_MESSAGE = "The server sent something we didn't expect. Please try again later.";

/**
 * Base URL for API calls. In mock mode without VITE_API_URL, requests go to this page's own origin,
 * where the MSW worker answers them.
 */
export function apiUrl(path: string): string {
  const base = env.VITE_API_URL ?? (env.VITE_USE_MOCKS ? window.location.origin : "");
  return `${base}${path}`;
}

/** GET. Retries once after a network error (the free API server can be asleep). */
export function apiGet<T>(path: string, schema: z.ZodType<T>, opts: ApiOptions = {}): Promise<T> {
  return request("GET", path, undefined, schema, opts, 1);
}

export function apiPost<T>(path: string, body: unknown, schema: z.ZodType<T>, opts: ApiOptions = {}): Promise<T> {
  return request("POST", path, body, schema, opts, 0);
}

export function apiPatch<T>(path: string, body: unknown, schema: z.ZodType<T>, opts: ApiOptions = {}): Promise<T> {
  return request("PATCH", path, body, schema, opts, 0);
}

async function request<T>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  opts: ApiOptions,
  networkRetries: number,
): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (opts.staff) {
    const key = getStaffKey();
    if (key) headers[STAFF_KEY_HEADER] = key;
  }

  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    // Cancelled by the caller (e.g. TanStack Query unmounting): not a network failure.
    if (opts.signal?.aborted) throw err;
    if (networkRetries > 0) return request(method, path, body, schema, opts, networkRetries - 1);
    throw new ApiClientError(0, "NETWORK", NETWORK_MESSAGE);
  }

  const json = await readJson(res);

  if (!res.ok) {
    if (res.status === 401 && opts.staff) {
      clearStaffKey();
      notifyUnauthorized();
    }
    const apiError = ApiError.safeParse(json);
    if (apiError.success) {
      const { code, message, details } = apiError.data.error;
      throw new ApiClientError(res.status, code, message, details);
    }
    throw new ApiClientError(res.status, fallbackCode(res.status), `Request failed (${res.status}).`);
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    // A contract bug: report it to the endpoint's owner instead of patching around it in the UI.
    if (import.meta.env.DEV) {
      console.error(`[api] ${method} ${path}: response does not match the shared schema`, parsed.error.issues);
    }
    throw new ApiClientError(res.status, "INTERNAL", CONTRACT_MESSAGE, parsed.error.issues);
  }
  return parsed.data;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function fallbackCode(status: number): ErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "INTERNAL";
  return "VALIDATION";
}

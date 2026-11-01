/**
 * Small helpers every mock handler file uses, so mock answers look exactly like the API's: the same
 * `ApiError` body, the same staff-key rule, the same artificial latency.
 */
import { ApiError, STAFF_KEY_HEADER, type ErrorCode, type OrgPublic } from "@needgrid/shared";
import { delay, HttpResponse } from "msw";
import { z } from "zod";
import { mockDb, type StaffRefusal } from "./mockDb";

/** 300–800 ms so loading states are visible in the browser. Tests run without latency. */
export async function latency(): Promise<void> {
  if (import.meta.env.MODE === "test") return;
  await delay(300 + Math.floor(Math.random() * 500));
}

/** Waits `ms` in the browser only (long AI steps); tests never wait. */
export async function browserDelay(ms: number): Promise<void> {
  if (import.meta.env.MODE === "test") return;
  await delay(ms);
}

export function apiError(status: number, code: ErrorCode, message: string, details?: unknown) {
  const body = ApiError.parse({ error: details === undefined ? { code, message } : { code, message, details } });
  return HttpResponse.json(body, { status });
}

export const notFound = (what: string) => apiError(404, "NOT_FOUND", `${what} not found`);

/** The passcode sent with the request. */
export const staffKeyOf = (request: Request) => request.headers.get(STAFF_KEY_HEADER);

/** Same rule as the API's staff-auth plugin: the passcode picks the org, anything else is 401. */
export function staffOrg(request: Request): OrgPublic | null {
  return mockDb.orgByStaffKey(staffKeyOf(request));
}

export const unauthorized = () => apiError(401, "UNAUTHORIZED", "Missing or invalid staff key");

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

const issuesOf = (error: z.ZodError) => ({ issues: error.issues.map((i) => ({ path: i.path, message: i.message })) });

export const validation = (error: z.ZodError) => apiError(400, "VALIDATION", "Request is invalid", issuesOf(error));

export const refusal = (result: StaffRefusal) => apiError(result.status, result.code, result.message, result.details);

export const isUuid = (id: string) => z.uuid().safeParse(id).success;

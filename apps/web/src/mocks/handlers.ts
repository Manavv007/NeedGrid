/**
 * MSW v2 handlers that stand in for the API (brief §8). Every response is built by mockDb and parsed
 * with its shared schema before it leaves, exactly like the real routes do.
 *
 * Patterns start with "*" so they match any origin: VITE_API_URL in dev, this page's origin when
 * VITE_USE_MOCKS=true without an API URL, and http://api.test in tests.
 *
 * Mutation handlers arrive with their tasks (each in its own group below):
 *   C-3 donations (create order, capture) · C-4 intake + publish/patch · C-7 purchase plan/approve/ordered
 *   C-8 delivery/confirm · C-9 assistant chat (NDJSON) + agent actions · C-10 invoices · P1 match.
 */
import {
  ApiError,
  ImpactRes,
  NeedDetailRes,
  NeedStatus,
  OrgListRes,
  OrgPageRes,
  STAFF_KEY_HEADER,
  StaffMeRes,
  StaffNeedDetailRes,
  StaffNeedListRes,
  type ErrorCode,
  type OrgPublic,
} from "@needgrid/shared";
import { delay, http, HttpResponse } from "msw";
import { mockDb } from "./mockDb";

/** 300–800 ms so loading states are visible in the browser. Tests run without latency. */
async function latency(): Promise<void> {
  if (import.meta.env.MODE === "test") return;
  await delay(300 + Math.floor(Math.random() * 500));
}

function apiError(status: number, code: ErrorCode, message: string, details?: unknown) {
  const body = ApiError.parse({ error: details === undefined ? { code, message } : { code, message, details } });
  return HttpResponse.json(body, { status });
}

const notFound = (what: string) => apiError(404, "NOT_FOUND", `${what} not found`);

/** Same rule as the API's staff-auth plugin: the passcode picks the org, anything else is 401. */
function staffOrg(request: Request): OrgPublic | null {
  return mockDb.orgByStaffKey(request.headers.get(STAFF_KEY_HEADER));
}
const unauthorized = () => apiError(401, "UNAUTHORIZED", "Missing or invalid staff key");

// ---------- public reads ----------

const publicReadHandlers = [
  http.get("*/api/health", async () => {
    await latency();
    return HttpResponse.json({ ok: true, db: true });
  }),

  http.get("*/api/orgs", async () => {
    await latency();
    return HttpResponse.json(OrgListRes.parse({ orgs: mockDb.listOrgSummaries() }));
  }),

  http.get("*/api/orgs/:slug", async ({ params }) => {
    await latency();
    const page = mockDb.getOrgPage(String(params.slug));
    return page ? HttpResponse.json(OrgPageRes.parse(page)) : notFound("Organization");
  }),

  http.get("*/api/needs/:id", async ({ params }) => {
    await latency();
    const detail = mockDb.getNeedDetail(String(params.id));
    return detail ? HttpResponse.json(NeedDetailRes.parse(detail)) : notFound("Need");
  }),

  http.get("*/api/impact/:token", async ({ params }) => {
    await latency();
    const impact = mockDb.getImpact(String(params.token));
    return impact ? HttpResponse.json(ImpactRes.parse(impact)) : notFound("Impact page");
  }),
];

// ---------- staff reads ----------

const staffReadHandlers = [
  http.get("*/api/staff/me", async ({ request }) => {
    await latency();
    const org = staffOrg(request);
    return org ? HttpResponse.json(StaffMeRes.parse({ org })) : unauthorized();
  }),

  http.get("*/api/staff/needs", async ({ request }) => {
    await latency();
    const org = staffOrg(request);
    if (!org) return unauthorized();
    const raw = new URL(request.url).searchParams.get("status");
    const status = raw === null ? undefined : NeedStatus.safeParse(raw);
    if (status && !status.success) return apiError(400, "VALIDATION", "Request is invalid");
    return HttpResponse.json(StaffNeedListRes.parse({ needs: mockDb.listStaffNeeds(org.id, status?.data) }));
  }),

  http.get("*/api/staff/needs/:id", async ({ request, params }) => {
    await latency();
    const org = staffOrg(request);
    if (!org) return unauthorized();
    const detail = mockDb.getStaffNeedDetail(org.id, String(params.id));
    return detail ? HttpResponse.json(StaffNeedDetailRes.parse(detail)) : notFound("Need");
  }),
];

export const handlers = [...publicReadHandlers, ...staffReadHandlers];

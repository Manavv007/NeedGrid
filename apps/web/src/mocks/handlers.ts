/**
 * MSW v2 handlers that stand in for the API (brief §8). Every response is built by mockDb and parsed
 * with its shared schema before it leaves, exactly like the real routes do.
 *
 * Patterns start with "*" so they match any origin: VITE_API_URL in dev, this page's origin when
 * VITE_USE_MOCKS=true without an API URL, and http://api.test in tests.
 *
 * Mutation handlers arrive with their tasks (each in its own group below):
 *   C-3 donations (create order, capture) · C-4 intake + publish/patch (below) · C-7 purchase plan/approve/ordered
 *   C-8 delivery/confirm · C-9 assistant chat (NDJSON) + agent actions · C-10 invoices · P1 match.
 */
import {
  ApiError,
  CaptureRes,
  CreateOrderReq,
  CreateOrderRes,
  FullyFundedDetails,
  ImpactRes,
  IntakeReq,
  NeedDetailRes,
  NeedRes,
  NeedStatus,
  OrgListRes,
  OrgPageRes,
  PatchNeedReq,
  PublishNeedReq,
  STAFF_KEY_HEADER,
  StaffMeRes,
  StaffNeedDetailRes,
  StaffNeedListRes,
  type ErrorCode,
  type OrgPublic,
} from "@needgrid/shared";
import { delay, http, HttpResponse } from "msw";
import { z } from "zod";
import { mockIntake } from "./intake";
import { mockDb, type StaffNeedResult } from "./mockDb";

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

// ---------- donations (C-3) ----------

/** Same check as the API route: anything else never reaches the database or PayPal. */
const ORDER_ID = /^[A-Z0-9]{5,40}$/;

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

const donationHandlers = [
  http.post("*/api/donations/orders", async ({ request }) => {
    await latency();
    const body = CreateOrderReq.safeParse(await readJson(request));
    if (!body.success) {
      return apiError(400, "VALIDATION", "Request is invalid", {
        issues: body.error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }
    const result = mockDb.createOrder(body.data);
    if (result.kind === "notFound") return notFound("Need");
    if (result.kind === "fullyFunded") {
      return apiError(
        409,
        "FULLY_FUNDED",
        "This item is already fully funded",
        FullyFundedDetails.parse({ nextNeed: result.nextNeed }),
      );
    }
    return HttpResponse.json(CreateOrderRes.parse(result.order), { status: 201 });
  }),

  // Idempotent: calling it again returns the same donation.
  http.post("*/api/donations/orders/:orderId/capture", async ({ params }) => {
    await latency();
    const orderId = String(params.orderId);
    if (!ORDER_ID.test(orderId)) return notFound("Donation order");
    const result = mockDb.capture(orderId);
    if (result.kind === "notFound") return notFound("Donation order");
    if (result.kind === "declined") {
      return apiError(409, "INVALID_STATE", "The payment method was declined. Please choose another one in PayPal.", {
        paypalIssue: "INSTRUMENT_DECLINED",
      });
    }
    return HttpResponse.json(CaptureRes.parse(result.capture));
  }),
];

// ---------- staff writes (C-4) ----------

const issuesOf = (error: z.ZodError) => ({ issues: error.issues.map((i) => ({ path: i.path, message: i.message })) });

const validation = (error: z.ZodError) => apiError(400, "VALIDATION", "Request is invalid", issuesOf(error));

/** Same check as the API's `assertCloudinaryUrl` (minus the cloud name, which mocks don't have). */
function isCloudinaryUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === "res.cloudinary.com";
  } catch {
    return false;
  }
}

const INTAKE_LATENCY_MS = 2_000;

function needResponse(result: StaffNeedResult, status = 200) {
  if (result.kind === "notFound") return notFound("Need");
  if (result.kind === "refused") return apiError(result.status, result.code, result.message, result.details);
  return HttpResponse.json(NeedRes.parse({ need: result.need }), { status });
}

const staffWriteHandlers = [
  // Nothing is saved by intake: the browser holds the drafts until staff publish them.
  http.post("*/api/staff/intake", async ({ request }) => {
    const org = staffOrg(request);
    if (!org) return unauthorized();
    const body = IntakeReq.safeParse(await readJson(request));
    if (!body.success) return validation(body.error);
    if (body.data.imageUrl && !isCloudinaryUrl(body.data.imageUrl)) {
      return apiError(400, "VALIDATION", "Images must be uploaded to the NeedGrid Cloudinary account");
    }
    if (import.meta.env.MODE !== "test") await delay(INTAKE_LATENCY_MS);
    return HttpResponse.json(mockIntake(body.data));
  }),

  http.post("*/api/staff/needs", async ({ request }) => {
    await latency();
    const org = staffOrg(request);
    if (!org) return unauthorized();
    const body = PublishNeedReq.safeParse(await readJson(request));
    if (!body.success) return validation(body.error);
    return needResponse(mockDb.createStaffNeed(org.id, body.data), 201);
  }),

  http.patch("*/api/staff/needs/:id", async ({ request, params }) => {
    await latency();
    const org = staffOrg(request);
    if (!org) return unauthorized();
    const id = String(params.id);
    if (!z.uuid().safeParse(id).success) return notFound("Need");
    const body = PatchNeedReq.safeParse((await readJson(request)) ?? {});
    if (!body.success) return validation(body.error);
    return needResponse(mockDb.patchStaffNeed(org.id, id, body.data));
  }),
];

export const handlers = [...publicReadHandlers, ...donationHandlers, ...staffReadHandlers, ...staffWriteHandlers];

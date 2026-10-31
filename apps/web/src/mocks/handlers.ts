/**
 * MSW v2 handlers that stand in for the API (brief §8). Every response is built by mockDb and parsed
 * with its shared schema before it leaves, exactly like the real routes do.
 *
 * Patterns start with "*" so they match any origin: VITE_API_URL in dev, this page's origin when
 * VITE_USE_MOCKS=true without an API URL, and http://api.test in tests.
 *
 * Mutation handlers arrive with their tasks (each in its own group below):
 *   C-3 donations (create order, capture) · C-4 intake + publish/patch · C-7 purchase plan/approve/ordered
 *   C-8 delivery/confirm · C-9 assistant chat (NDJSON), agent actions, invoices (assistant.ts) and B's
 *   dashboard reads (dashboard.ts) · P1 match.
 */
import {
  ApprovePurchaseRes,
  CaptureRes,
  ConfirmDeliveryReq,
  CreateOrderReq,
  CreateOrderRes,
  DeliveryReq,
  DeliveryRes,
  FullyFundedDetails,
  ImpactRes,
  IntakeReq,
  MarkOrderedReq,
  NeedDetailRes,
  NeedRes,
  NeedStatus,
  OrgListRes,
  OrgPageRes,
  PatchNeedReq,
  PublishNeedReq,
  PurchasePlanRes,
  PurchaseRes,
  StaffMeRes,
  StaffNeedDetailRes,
  StaffNeedListRes,
} from "@needgrid/shared";
import { bypass, delay, http, HttpResponse } from "msw";
import { MOCK_UPLOAD_URL } from "@/lib/mockUploadUrl";
import { assistantHandlers } from "./assistant";
import { dashboardHandlers } from "./dashboard";
import { mockImage } from "./fixtures";
import { mockIntake } from "./intake";
import { mockDb, type StaffNeedResult } from "./mockDb";
import { apiError, isUuid, latency, notFound, readJson, refusal, staffOrg, unauthorized, validation } from "./respond";

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
  if (result.kind === "refused") return refusal(result);
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
    if (!isUuid(id)) return notFound("Need");
    const body = PatchNeedReq.safeParse((await readJson(request)) ?? {});
    if (!body.success) return validation(body.error);
    return needResponse(mockDb.patchStaffNeed(org.id, id, body.data));
  }),
];

// ---------- purchases (C-7) ----------

/** B's price check takes 5 to 15 s on the real server; a shorter wait still shows the staged progress. */
const PURCHASE_PLAN_LATENCY_MS = 1_500;

const purchaseHandlers = [
  // Body is `{}`: the server picks the offer; nothing about money comes from the browser.
  http.post("*/api/staff/needs/:id/purchase-plan", async ({ request, params }) => {
    const org = staffOrg(request);
    if (!org) return unauthorized();
    const id = String(params.id);
    if (!isUuid(id)) return notFound("Need");
    if (import.meta.env.MODE !== "test") await delay(PURCHASE_PLAN_LATENCY_MS);
    const result = mockDb.planPurchase(org.id, id);
    if (result.kind === "notFound") return notFound("Need");
    if (result.kind === "refused") return refusal(result);
    return HttpResponse.json(PurchasePlanRes.parse(result.plan));
  }),

  http.post("*/api/staff/purchases/:id/approve", async ({ request, params }) => {
    await latency();
    const org = staffOrg(request);
    if (!org) return unauthorized();
    const id = String(params.id);
    if (!isUuid(id)) return notFound("Purchase");
    const result = mockDb.approvePurchase(org.id, id);
    if (result.kind === "notFound") return notFound("Purchase");
    if (result.kind === "refused") return refusal(result);
    return HttpResponse.json(ApprovePurchaseRes.parse(result.approval));
  }),

  http.post("*/api/staff/purchases/:id/ordered", async ({ request, params }) => {
    await latency();
    const org = staffOrg(request);
    if (!org) return unauthorized();
    const id = String(params.id);
    if (!isUuid(id)) return notFound("Purchase");
    const body = MarkOrderedReq.safeParse(await readJson(request));
    if (!body.success) return validation(body.error);
    const result = mockDb.markOrdered(org.id, id, body.data);
    if (result.kind === "notFound") return notFound("Purchase");
    if (result.kind === "refused") return refusal(result);
    return HttpResponse.json(PurchaseRes.parse(result.ordered));
  }),
];

// ---------- deliveries (C-8) ----------

/** B's photo check takes 5 to 20 s on the real server; a shorter wait still shows the staged progress. */
const DELIVERY_CHECK_LATENCY_MS = 2_500;

const deliveryHandlers = [
  // Same order of checks as B's route: the body, then the photo host, then the need and its status.
  http.post("*/api/staff/needs/:id/delivery", async ({ request, params }) => {
    const org = staffOrg(request);
    if (!org) return unauthorized();
    const id = String(params.id);
    if (!isUuid(id)) return notFound("Need");
    const body = DeliveryReq.safeParse(await readJson(request));
    if (!body.success) return validation(body.error);
    if (!isCloudinaryUrl(body.data.photoUrl)) {
      return apiError(400, "VALIDATION", "Images must be uploaded to the NeedGrid Cloudinary account");
    }
    if (import.meta.env.MODE !== "test") await delay(DELIVERY_CHECK_LATENCY_MS);
    const result = mockDb.recordDelivery(org.id, id, body.data);
    if (result.kind === "notFound") return notFound("Need");
    if (result.kind === "refused") return refusal(result);
    return HttpResponse.json(DeliveryRes.parse(result.delivery));
  }),

  http.post("*/api/staff/deliveries/:id/confirm", async ({ request, params }) => {
    await latency();
    const org = staffOrg(request);
    if (!org) return unauthorized();
    const id = String(params.id);
    if (!isUuid(id)) return notFound("Delivery");
    const body = ConfirmDeliveryReq.safeParse((await readJson(request)) ?? {});
    if (!body.success) return validation(body.error);
    const result = mockDb.confirmDelivery(org.id, id, body.data);
    if (result.kind === "notFound") return notFound("Delivery");
    if (result.kind === "refused") return refusal(result);
    return HttpResponse.json(DeliveryRes.parse(result.delivery));
  }),
];

/**
 * Mock mode "uploads" every photo to one fixed Cloudinary-style URL (lib/cloudinary.ts), which isn't
 * a real image. The browser worker answers it with the mock arrival picture, so a delivery recorded
 * in mock mode shows a photo on the staff page and the donor's impact page.
 */
const mockPhotoHandlers = [
  http.get(MOCK_UPLOAD_URL, async () => {
    const picture = await fetch(bypass(mockImage("arrival"))).then((res) => res.arrayBuffer());
    return HttpResponse.arrayBuffer(picture, { headers: { "content-type": "image/svg+xml" } });
  }),
];

export const handlers = [
  ...publicReadHandlers,
  ...donationHandlers,
  ...staffReadHandlers,
  ...staffWriteHandlers,
  ...purchaseHandlers,
  ...deliveryHandlers,
  ...assistantHandlers,
  ...dashboardHandlers,
  ...mockPhotoHandlers,
];

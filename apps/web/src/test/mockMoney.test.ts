import {
  ApiError,
  CaptureRes,
  CreateOrderRes,
  FullyFundedDetails,
  HOLD_MINUTES,
  ImpactRes,
  NeedDetailRes,
  paths,
  type CreateOrderReq,
} from "@needgrid/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockDb } from "@/mocks/mockDb";
import { scenariosFromSearch } from "@/mocks/scenarios";

afterEach(() => {
  vi.useRealTimers();
});

const API = "http://api.test";
const ID = {
  diapers4: "4c1f7a2e-9b3d-4e5f-8a6b-000000000101", // open, $70 of $84, urgency 3, due tomorrow
  formula: "4c1f7a2e-9b3d-4e5f-8a6b-000000000102", // open, $41 of $112, $15 held, urgency 3, due in 2 days
  wipes: "4c1f7a2e-9b3d-4e5f-8a6b-000000000103", // open, $22 of $41
  laundry: "4c1f7a2e-9b3d-4e5f-8a6b-000000000110", // funded
  handSoap: "4c1f7a2e-9b3d-4e5f-8a6b-000000000113", // draft
} as const;

function detail(id: string) {
  return NeedDetailRes.parse(mockDb.getNeedDetail(id)).need;
}

function create(needId: string, amountCents: number, rollOverConsent = true) {
  const result = mockDb.createOrder({ needId, amountCents, rollOverConsent });
  if (result.kind !== "ok") throw new Error(`expected an order, got ${result.kind}`);
  return CreateOrderRes.parse(result.order);
}

function capture(orderId: string) {
  const result = mockDb.capture(orderId);
  if (result.kind !== "ok") throw new Error(`expected a capture, got ${result.kind}`);
  return CaptureRes.parse(result.capture);
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as unknown };
}

describe("mock money rules (mirror apps/api/src/money)", () => {
  it("create holds the amount: remaining drops, funded doesn't, hold lasts HOLD_MINUTES", () => {
    const before = Date.now();
    const order = create(ID.diapers4, 1000);
    expect(order.orderId).toMatch(/^[A-Z0-9]{5,40}$/);
    expect(order).toMatchObject({ amountCents: 1000, wasClamped: false });
    const expires = Date.parse(order.holdExpiresAt) - before;
    expect(expires).toBeGreaterThanOrEqual(HOLD_MINUTES * 60_000 - 1000);
    expect(expires).toBeLessThanOrEqual(HOLD_MINUTES * 60_000 + 1000);
    expect(detail(ID.diapers4)).toMatchObject({ fundedCents: 7000, heldCents: 1000, remainingCents: 400 });
  });

  it("clamps a request above what's left and says so", () => {
    create(ID.diapers4, 1000); // someone else holds $10 of the $14
    expect(create(ID.diapers4, 1400)).toMatchObject({ amountCents: 400, wasClamped: true });
    expect(detail(ID.diapers4).remainingCents).toBe(0);
  });

  it("FULLY_FUNDED with the next most urgent need when nothing is left or it isn't donatable", () => {
    create(ID.diapers4, 1400);
    const full = mockDb.createOrder({ needId: ID.diapers4, amountCents: 500, rollOverConsent: true });
    expect(full.kind).toBe("fullyFunded");
    if (full.kind === "fullyFunded") {
      expect(FullyFundedDetails.parse({ nextNeed: full.nextNeed }).nextNeed?.id).toBe(ID.formula);
    }
    expect(mockDb.createOrder({ needId: ID.laundry, amountCents: 500, rollOverConsent: true }).kind).toBe(
      "fullyFunded",
    );
  });

  it("drafts and unknown needs are not found", () => {
    expect(mockDb.createOrder({ needId: ID.handSoap, amountCents: 500, rollOverConsent: true }).kind).toBe("notFound");
    expect(mockDb.capture("NOSUCHORDER1").kind).toBe("notFound");
  });

  it("capture raises fundedCents, adds a donor, records the split and turns the need funded at target", () => {
    const order = create(ID.diapers4, 1400);
    const res = capture(order.orderId);
    expect(res).toMatchObject({
      amountCents: 1400,
      allocations: [{ needId: ID.diapers4, needTitle: "Diapers, size 4", amountCents: 1400, reason: "direct" }],
    });
    const need = detail(ID.diapers4);
    expect(need).toMatchObject({ status: "funded", fundedCents: 8400, heldCents: 0, remainingCents: 0, donorCount: 7 });
    const timeline = NeedDetailRes.parse(mockDb.getNeedDetail(ID.diapers4)).timeline;
    expect(timeline.at(-2)).toMatchObject({ type: "donation", label: "1 donor gave $14.00", amountCents: 1400 });
    expect(timeline.at(-1)).toMatchObject({ type: "funded", label: "Fully funded" });
  });

  it("capture is idempotent", () => {
    const order = create(ID.diapers4, 1000);
    const first = capture(order.orderId);
    expect(capture(order.orderId)).toEqual(first);
    expect(detail(ID.diapers4).fundedCents).toBe(8000);
  });

  it("sends overflow to the next most urgent need when the donor agreed", () => {
    // Donor A's hold expires while they're still in PayPal; donor B holds $5 meanwhile; then A pays.
    vi.useFakeTimers({ toFake: ["Date"] });
    const a = create(ID.diapers4, 1400);
    vi.setSystemTime(Date.now() + (HOLD_MINUTES + 1) * 60_000);
    expect(create(ID.diapers4, 500).amountCents).toBe(500);

    const res = capture(a.orderId);
    // Room for A is $84 − $70 − B's $5 = $9: that fits, the other $5 overflows to the formula.
    expect(res.allocations).toEqual([
      { needId: ID.diapers4, needTitle: "Diapers, size 4", amountCents: 900, reason: "direct" },
      { needId: ID.formula, needTitle: "Infant formula, 12.4 oz", amountCents: 500, reason: "overflow" },
    ]);
    expect(detail(ID.diapers4)).toMatchObject({ fundedCents: 7900, heldCents: 500, status: "open" });
    expect(detail(ID.formula)).toMatchObject({ fundedCents: 4600, donorCount: 6 });
  });

  it("keeps overflow unallocated without consent (the server proposes a refund)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const a = create(ID.diapers4, 1400, false);
    vi.setSystemTime(Date.now() + (HOLD_MINUTES + 1) * 60_000);
    create(ID.diapers4, 500);

    const res = capture(a.orderId);
    expect(res.amountCents).toBe(1400);
    expect(res.allocations).toEqual([
      { needId: ID.diapers4, needTitle: "Diapers, size 4", amountCents: 900, reason: "direct" },
    ]);
    expect(detail(ID.formula).fundedCents).toBe(4100);
  });

  it("creates an impact record for /thanks and /impact", () => {
    const res = capture(create(ID.diapers4, 1400).orderId);
    const impact = ImpactRes.parse(mockDb.getImpact(res.impactToken));
    expect(res.impactToken).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(impact).toMatchObject({ totalCents: 1400, donorFirstName: null });
    expect(impact.items).toEqual([
      expect.objectContaining({ orgName: "Harbor Food Bank", amountCents: 1400, reason: "direct" }),
    ]);
    expect(impact.items[0]?.need.status).toBe("funded");
  });

  it("raises the org's raised total", () => {
    const before = mockDb.listOrgSummaries().find((o) => o.slug === "harbor-food-bank")?.stats.raisedCents ?? 0;
    capture(create(ID.wipes, 1000).orderId);
    const after = mockDb.listOrgSummaries().find((o) => o.slug === "harbor-food-bank")?.stats.raisedCents ?? 0;
    expect(after - before).toBe(1000);
  });
});

describe("mock scenarios", () => {
  it("fullyFunded: another donor holds the rest first, once", () => {
    mockDb.armScenario("fullyFunded");
    const first = mockDb.createOrder({ needId: ID.wipes, amountCents: 1000, rollOverConsent: true });
    expect(first.kind).toBe("fullyFunded");
    expect(detail(ID.wipes).remainingCents).toBe(0);
    expect(mockDb.takeScenario("fullyFunded")).toBe(false);
  });

  it("declined: the next capture fails and the hold stays", () => {
    const order = create(ID.diapers4, 1400);
    mockDb.armScenario("declined");
    expect(mockDb.capture(order.orderId).kind).toBe("declined");
    expect(detail(ID.diapers4)).toMatchObject({ fundedCents: 7000, heldCents: 1400 });
    expect(mockDb.capture(order.orderId).kind).toBe("ok");
  });

  it("reads ?mock= from a page query string", () => {
    expect(scenariosFromSearch("?mock=fullyFunded")).toEqual(["fullyFunded"]);
    expect(scenariosFromSearch("?donate=1&mock=declined,cancel&mock=declined")).toEqual(["declined", "cancel"]);
    expect(scenariosFromSearch("?mock=everything")).toEqual([]);
  });
});

describe("mock donation handlers", () => {
  it("201 with a CreateOrderRes, then the capture", async () => {
    const created = await post(paths.createOrder, {
      needId: ID.diapers4,
      amountCents: 1400,
    } satisfies Partial<CreateOrderReq>);
    expect(created.status).toBe(201);
    const order = CreateOrderRes.parse(created.json);
    const captured = await post(paths.captureOrder(order.orderId), {});
    expect(captured.status).toBe(200);
    expect(CaptureRes.parse(captured.json).allocations[0]?.amountCents).toBe(1400);
  });

  it("400 VALIDATION for amounts the contract rejects", async () => {
    for (const amountCents of [50, 10.5, -100, 100_001]) {
      const res = await post(paths.createOrder, { needId: ID.diapers4, amountCents });
      expect(res.status).toBe(400);
      expect(ApiError.parse(res.json).error.code).toBe("VALIDATION");
    }
  });

  it("409 FULLY_FUNDED with nextNeed details, and 409 INVALID_STATE for a declined card", async () => {
    const full = await post(paths.createOrder, { needId: ID.laundry, amountCents: 1000 });
    expect(full.status).toBe(409);
    const error = ApiError.parse(full.json).error;
    expect(error.code).toBe("FULLY_FUNDED");
    expect(FullyFundedDetails.parse(error.details).nextNeed?.id).toBe(ID.diapers4);

    const order = CreateOrderRes.parse((await post(paths.createOrder, { needId: ID.wipes, amountCents: 1000 })).json);
    mockDb.armScenario("declined");
    const declined = await post(paths.captureOrder(order.orderId), {});
    expect(declined.status).toBe(409);
    expect(ApiError.parse(declined.json).error).toMatchObject({
      code: "INVALID_STATE",
      details: { paypalIssue: "INSTRUMENT_DECLINED" },
    });
  });

  it("404 for malformed and unknown order ids", async () => {
    expect((await post(paths.captureOrder("not-an-order"), {})).status).toBe(404);
    expect((await post(paths.captureOrder("NOSUCHORDER1"), {})).status).toBe(404);
  });
});

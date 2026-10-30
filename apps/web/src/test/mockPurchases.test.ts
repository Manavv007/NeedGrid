import {
  ApiError,
  ApprovePurchaseRes,
  computeTargetCents,
  paths,
  PurchasePlanRes,
  PurchaseRes,
  STAFF_KEY_HEADER,
  StaffNeedDetailRes,
} from "@needgrid/shared";
import { afterEach, describe, expect, it } from "vitest";
import { ORG_IDS } from "@/mocks/fixtures";
import { MANUAL_PRODUCT_FLAG, mockDb } from "@/mocks/mockDb";

const API = "http://api.test";
const HARBOR = ORG_IDS.harbor;
const ID = {
  diapers4: "4c1f7a2e-9b3d-4e5f-8a6b-000000000101", // open, $70 of $84, Harbor's most urgent
  tuna: "4c1f7a2e-9b3d-4e5f-8a6b-000000000108", // topping_up, approved purchase
  toothbrushes: "4c1f7a2e-9b3d-4e5f-8a6b-000000000109", // funded $38, fresh price pricier → $41
  laundry: "4c1f7a2e-9b3d-4e5f-8a6b-000000000110", // funded $95, fresh price cheaper → $88
  enzyme: "4c1f7a2e-9b3d-4e5f-8a6b-000000000208", // Paws, funded $108, 10¢ cheaper → still $108
  snacks: "4c1f7a2e-9b3d-4e5f-8a6b-000000000307", // Room 12, funded, hand-written product
} as const;

afterEach(() => {
  // Every money rule below must leave funded = sum of allocations on every need.
  expect(mockDb.moneyProblems()).toEqual([]);
});

const staffNeed = (orgId: string, id: string) => StaffNeedDetailRes.parse(mockDb.getStaffNeedDetail(orgId, id));

function plan(orgId: string, id: string) {
  const result = mockDb.planPurchase(orgId, id);
  if (result.kind !== "ok") throw new Error(`expected a plan, got ${result.kind}`);
  return PurchasePlanRes.parse(result.plan);
}

function approve(orgId: string, purchaseId: string) {
  const result = mockDb.approvePurchase(orgId, purchaseId);
  if (result.kind !== "ok") throw new Error(`expected an approval, got ${JSON.stringify(result)}`);
  return ApprovePurchaseRes.parse(result.approval);
}

function donate(needId: string, amountCents: number) {
  const order = mockDb.createOrder({ needId, amountCents, rollOverConsent: true });
  if (order.kind !== "ok") throw new Error(`expected an order, got ${order.kind}`);
  expect(mockDb.capture(order.order.orderId).kind).toBe("ok");
}

async function post(path: string, body: unknown, key: string | null = "harbor-demo-2026") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers[STAFF_KEY_HEADER] = key;
  const res = await fetch(`${API}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as unknown };
}

describe("mock purchase plan (B's route)", () => {
  it("cheaper: a proposed purchase at today's price, a surplus naming the next most urgent need", () => {
    const res = plan(HARBOR, ID.laundry);
    expect(res.priceChange).toBe("cheaper");
    expect(res.purchase).toMatchObject({ status: "proposed", needId: ID.laundry, newTargetCents: 8800 });
    expect(res.purchase.newTargetCents).toBe(computeTargetCents(res.purchase.offer.unitPriceCents, 6));
    expect(res.money).toMatchObject({ kind: "surplus", cents: 700, nextNeed: { id: ID.diapers4 } });
    expect(res.purchase.flags).toEqual(["Price dropped 8%", "In stock"]);
    expect(res.alternatives.length).toBeGreaterThan(0);
    // Nothing moves until approval.
    expect(staffNeed(HARBOR, ID.laundry).need).toMatchObject({ status: "funded", fundedCents: 9500 });
    expect(staffNeed(HARBOR, ID.laundry).purchases[0]?.id).toBe(res.purchase.id);
  });

  it("pricier → gap, same price → exact, and a hand-written product is never refreshed", () => {
    expect(plan(HARBOR, ID.toothbrushes)).toMatchObject({ priceChange: "pricier", money: { kind: "gap", cents: 300 } });
    expect(plan(ORG_IDS.paws, ID.enzyme)).toMatchObject({ priceChange: "cheaper", money: { kind: "exact" } });

    const manual = plan(ORG_IDS.room12, ID.snacks);
    expect(manual).toMatchObject({ priceChange: "same", money: { kind: "exact" }, alternatives: [] });
    expect(manual.purchase.flags).toEqual([MANUAL_PRODUCT_FLAG]);
    expect(manual.purchase.offer.channel3Id).toMatch(/^manual-/);
  });

  it("a new check supersedes the older proposal", () => {
    const first = plan(HARBOR, ID.laundry);
    const second = plan(HARBOR, ID.laundry);
    const purchases = staffNeed(HARBOR, ID.laundry).purchases;
    expect(purchases.map((p) => [p.id, p.status])).toEqual([
      [second.purchase.id, "proposed"],
      [first.purchase.id, "superseded"],
    ]);
    expect(mockDb.approvePurchase(HARBOR, first.purchase.id)).toMatchObject({ kind: "refused", status: 409 });
  });

  it("refuses needs that aren't funded, and other charities' needs are not found", () => {
    expect(mockDb.planPurchase(HARBOR, ID.diapers4)).toMatchObject({
      kind: "refused",
      status: 409,
      code: "INVALID_STATE",
    });
    expect(mockDb.planPurchase(HARBOR, ID.enzyme).kind).toBe("notFound");
  });
});

describe("mock approve and mark ordered (A's rules)", () => {
  it("surplus: moves to the next need as price_drop, lowers the target, keeps the need funded", () => {
    const before = staffNeed(HARBOR, ID.diapers4).need;
    const { purchase } = plan(HARBOR, ID.laundry);
    const res = approve(HARBOR, purchase.id);

    expect(res.surplusMoved).toEqual({ toNeedId: ID.diapers4, toNeedTitle: "Diapers, size 4", amountCents: 700 });
    expect(res.gapCents).toBeNull();
    expect(res.purchase).toMatchObject({ status: "approved", approvedAt: expect.any(String) });
    expect(res.need).toMatchObject({ status: "funded", fundedCents: 8800, targetCents: 8800, remainingCents: 0 });
    expect(res.need.product?.unitPriceCents).toBe(1349);

    const next = staffNeed(HARBOR, ID.diapers4).need;
    expect(next).toMatchObject({ fundedCents: before.fundedCents + 700, donorCount: before.donorCount + 1 });
    // The public tile wall moved too.
    expect(mockDb.getOrgPage("harbor-food-bank")?.needs.find((n) => n.id === ID.diapers4)?.fundedCents).toBe(7700);
    expect(staffNeed(HARBOR, ID.laundry).timeline.at(-1)).toMatchObject({
      type: "purchase_approved",
      label: "Purchase approved at Target",
    });
  });

  it("gap: the need goes back to topping_up for the difference; mark ordered waits until it's funded", () => {
    const { purchase } = plan(HARBOR, ID.toothbrushes);
    const res = approve(HARBOR, purchase.id);
    expect(res).toMatchObject({ surplusMoved: null, gapCents: 300 });
    expect(res.need).toMatchObject({ status: "topping_up", targetCents: 4100, fundedCents: 3800, remainingCents: 300 });
    expect(staffNeed(HARBOR, ID.toothbrushes).timeline.at(-1)).toMatchObject({
      type: "topping_up",
      amountCents: 300,
    });

    expect(mockDb.markOrdered(HARBOR, purchase.id, { orderRef: "AMZ-1" })).toMatchObject({
      kind: "refused",
      status: 409,
    });
    donate(ID.toothbrushes, 300);
    expect(staffNeed(HARBOR, ID.toothbrushes).need.status).toBe("funded");
    expect(mockDb.markOrdered(HARBOR, purchase.id, { orderRef: "AMZ-1" }).kind).toBe("ok");
  });

  it("only a proposed purchase of a funded need can be approved, once", () => {
    const { purchase } = plan(ORG_IDS.paws, ID.enzyme);
    expect(approve(ORG_IDS.paws, purchase.id)).toMatchObject({ surplusMoved: null, gapCents: null });
    expect(mockDb.approvePurchase(ORG_IDS.paws, purchase.id)).toMatchObject({ kind: "refused", status: 409 });
    expect(mockDb.approvePurchase(HARBOR, purchase.id).kind).toBe("notFound");
  });

  it("mark ordered needs an approved purchase; then the purchase and need are ordered", () => {
    const { purchase } = plan(HARBOR, ID.laundry);
    expect(mockDb.markOrdered(HARBOR, purchase.id, { orderRef: "TGT-1" })).toMatchObject({
      kind: "refused",
      status: 409,
    });
    approve(HARBOR, purchase.id);
    const result = mockDb.markOrdered(HARBOR, purchase.id, { orderRef: "TGT-1" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const ordered = PurchaseRes.parse(result.ordered);
    expect(ordered.purchase).toMatchObject({ status: "ordered", orderRef: "TGT-1", orderedAt: expect.any(String) });
    expect(ordered.need.status).toBe("ordered");
    expect(staffNeed(HARBOR, ID.laundry).timeline.at(-1)).toMatchObject({ type: "ordered" });
  });

  it("a topping_up need's approved purchase can't be ordered or approved again", () => {
    const [approved] = staffNeed(HARBOR, ID.tuna).purchases;
    expect(approved?.status).toBe("approved");
    if (!approved) return;
    expect(mockDb.markOrdered(HARBOR, approved.id, { orderRef: "WM-1" })).toMatchObject({ kind: "refused" });
    expect(mockDb.approvePurchase(HARBOR, approved.id)).toMatchObject({ kind: "refused" });
  });
});

describe("mock purchase handlers", () => {
  it("401 without the staff key, 404 for unknown or malformed ids", async () => {
    expect((await post(paths.staff.purchasePlan(ID.laundry), {}, null)).status).toBe(401);
    expect((await post(paths.staff.purchasePlan("4c1f7a2e-9b3d-4e5f-8a6b-000000000999"), {})).status).toBe(404);
    expect((await post(paths.staff.approvePurchase("not-a-uuid"), {})).status).toBe(404);
    expect((await post(paths.staff.markOrdered(crypto.randomUUID()), { orderRef: "X" })).status).toBe(404);
  });

  it("plan → approve → ordered over HTTP, with 409 and 400 where the server would refuse", async () => {
    const refused = await post(paths.staff.purchasePlan(ID.diapers4), {});
    expect(refused.status).toBe(409);
    expect(ApiError.parse(refused.json).error.code).toBe("INVALID_STATE");

    const planned = PurchasePlanRes.parse((await post(paths.staff.purchasePlan(ID.laundry), {})).json);
    const approved = await post(paths.staff.approvePurchase(planned.purchase.id), {});
    expect(approved.status).toBe(200);
    expect(ApprovePurchaseRes.parse(approved.json).surplusMoved?.amountCents).toBe(700);

    const blank = await post(paths.staff.markOrdered(planned.purchase.id), { orderRef: "   " });
    expect(blank.status).toBe(400);
    expect(ApiError.parse(blank.json).error.code).toBe("VALIDATION");

    const ordered = await post(paths.staff.markOrdered(planned.purchase.id), { orderRef: " TGT-77 " });
    expect(ordered.status).toBe(200);
    expect(PurchaseRes.parse(ordered.json).purchase.orderRef).toBe("TGT-77");
  });
});

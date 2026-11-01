import {
  ApiError,
  computeTargetCents,
  PurchasePlanRes,
  type NeedCard,
  type PurchaseOffer,
  type PurchaseView,
} from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app";
import { clearChannel3Cache, setChannel3Gateway } from "../channel3";
import { FakeChannel3, fakeOffer, fakeProduct } from "../channel3/__fakes__";
import * as core from "../core";
import { hashStaffKey } from "../lib/crypto";
import type { StaffOrg } from "../plugins/staffAuth";
import { demoProduct, nextIp } from "../test/fixtures";
import { scriptedModel } from "./__fakes__";
import { setAiModels } from "./models";
import { FLAG_MANUAL, offerFlags, planPurchase, plainExplanation } from "./purchasePlan";

// core.createProposedPurchase is A's (stub until Mon Nov 2): mocked here, together with the reads.
vi.mock("../core", async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  getNeedCard: vi.fn(),
  getNextMostUrgentNeed: vi.fn(),
  createProposedPurchase: vi.fn(),
}));

const ORG = "6f1c1d1e-2b3c-4d5e-8f90-0000000000aa";
const NEED = "6f1c1d1e-2b3c-4d5e-8f90-000000000001";
const NEXT = "6f1c1d1e-2b3c-4d5e-8f90-000000000002";

const card = (over: Partial<NeedCard> = {}): NeedCard => ({
  id: NEED,
  orgId: ORG,
  orgSlug: "harbor-food-bank",
  title: "Infant formula",
  description: "",
  category: "baby",
  urgency: 3,
  quantity: 2,
  unit: "can",
  status: "funded",
  targetCents: 6500, // computeTargetCents(3000, 2)
  fundedCents: 6500,
  heldCents: 0,
  remainingCents: 0,
  donorCount: 4,
  product: { ...demoProduct(3000), channel3Id: "prod_formula", fetchedAt: "2026-10-29T00:00:00.000Z" },
  deadlineAt: null,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-29T00:00:00.000Z",
  ...over,
});

const proposed = (input: { needId: string; offer: PurchaseOffer; explanation: string; flags: string[] }) =>
  ({
    id: "6f1c1d1e-2b3c-4d5e-8f90-0000000000f1",
    needId: input.needId,
    status: "proposed",
    offer: input.offer,
    newTargetCents: computeTargetCents(input.offer.unitPriceCents, 2),
    explanation: input.explanation,
    flags: input.flags,
    orderRef: null,
    createdAt: "2026-11-02T00:00:00.000Z",
    approvedAt: null,
    orderedAt: null,
  }) satisfies PurchaseView;

let channel3: FakeChannel3;
const formula = (offers: Parameters<typeof fakeOffer>[0][]) =>
  channel3.products.set(
    "prod_formula",
    fakeProduct({ id: "prod_formula", title: "Similac Advance 30.8 oz", offers: offers.map(fakeOffer) }),
  );

beforeEach(() => {
  channel3 = new FakeChannel3();
  setChannel3Gateway(channel3);
  vi.mocked(core.getNeedCard).mockResolvedValue(card());
  vi.mocked(core.getNextMostUrgentNeed).mockResolvedValue(card({ id: NEXT, title: "Diapers, size 4", status: "open" }));
  vi.mocked(core.createProposedPurchase).mockImplementation(async (input) => proposed(input));
});

afterEach(() => {
  vi.clearAllMocks();
  setAiModels(null);
  setChannel3Gateway(null);
  clearChannel3Cache();
});

describe("planPurchase", () => {
  it("cheaper today: best in-stock offer, surplus to the next most urgent need, other offers as alternatives", async () => {
    formula([
      { price: 26, domain: "walmart.com" },
      { price: 25, domain: "target.com", url: "https://www.target.com/p/1", availability: "OutOfStock" },
    ]);
    channel3.searchResults.set("infant formula", [
      fakeProduct({ id: "prod_other", title: "Enfamil NeuroPro 20.7 oz", offers: [fakeOffer({ price: 31 })] }),
      fakeProduct({ id: "prod_formula", title: "Similac Advance 30.8 oz", offers: [fakeOffer({ price: 26 })] }),
    ]);

    const res = PurchasePlanRes.parse(await planPurchase(NEED, ORG));

    expect(res.purchase.offer).toMatchObject({ retailer: "walmart.com", unitPriceCents: 2600, inStock: true });
    expect(res.priceChange).toBe("cheaper");
    // 2 × $26 + 8% = $56.16 → $57; funded $65 → $8 surplus
    expect(res.money).toMatchObject({ kind: "surplus", cents: 800, nextNeed: { id: NEXT } });
    expect(core.getNextMostUrgentNeed).toHaveBeenCalledWith(ORG, NEED);
    expect(res.purchase.flags).toEqual(["Price dropped 13%", "Only offer in stock"]);
    expect(res.alternatives.map((a) => `${a.channel3Id}@${a.retailer}`)).toEqual([
      "prod_formula@target.com",
      "prod_other@walmart.com",
    ]);
    // AI off in tests: the plain explanation
    expect(res.purchase.explanation).toBe(
      'Best offer: $26.00 each at walmart.com. The price dropped from $30.00 to $26.00. The $8.00 left over goes to "Diapers, size 4".',
    );
    expect(core.createProposedPurchase).toHaveBeenCalledWith({
      needId: NEED,
      offer: expect.objectContaining({ unitPriceCents: 2600 }),
      explanation: res.purchase.explanation,
      flags: res.purchase.flags,
    });
  });

  it("pricier today: gap = new target − funded", async () => {
    formula([{ price: 35 }]);
    const res = await planPurchase(NEED, ORG);
    expect(res.priceChange).toBe("pricier");
    expect(res.money).toEqual({ kind: "gap", cents: 7600 - 6500 });
    expect(res.purchase.flags).toEqual(["Price rose $5.00"]);
    expect(core.getNextMostUrgentNeed).not.toHaveBeenCalled();
  });

  it("same price: exact", async () => {
    formula([{ price: 30 }]);
    const res = await planPurchase(NEED, ORG);
    expect([res.priceChange, res.money.kind, res.purchase.flags]).toEqual(["same", "exact", []]);
  });

  it("a manual product isn't refreshed and is flagged", async () => {
    vi.mocked(core.getNeedCard).mockResolvedValue(
      card({ product: { ...demoProduct(3000), channel3Id: "manual-rice", fetchedAt: "2026-10-29T00:00:00.000Z" } }),
    );
    const res = await planPurchase(NEED, ORG);
    expect(channel3.calls.filter((c) => c.op === "retrieve")).toEqual([]);
    expect(res.purchase.flags).toEqual([FLAG_MANUAL]);
    expect(res.money.kind).toBe("exact");
  });

  it("refresh fails → stored price with a dated flag; product gone → same with its own flag", async () => {
    channel3.failWith = new Error("Channel3 down");
    let res = await planPurchase(NEED, ORG);
    expect(res.purchase.flags).toEqual(["Couldn't refresh the price; using the price from Oct 29"]);
    expect(res.purchase.offer.unitPriceCents).toBe(3000);
    expect(res.alternatives).toEqual([]);

    channel3.failWith = null;
    clearChannel3Cache();
    res = await planPurchase(NEED, ORG);
    expect(res.purchase.flags).toEqual(["Channel3 no longer lists this product; using the price from Oct 29"]);
  });

  it("404 for an unknown need or another org's need; 409 unless funded or without a product", async () => {
    vi.mocked(core.getNeedCard).mockResolvedValueOnce(null);
    await expect(planPurchase(NEED, ORG)).rejects.toMatchObject({ status: 404 });
    vi.mocked(core.getNeedCard).mockResolvedValueOnce(card({ orgId: NEXT }));
    await expect(planPurchase(NEED, ORG)).rejects.toMatchObject({ status: 404 });
    vi.mocked(core.getNeedCard).mockResolvedValueOnce(card({ status: "open" }));
    await expect(planPurchase(NEED, ORG)).rejects.toMatchObject({ status: 409, code: "INVALID_STATE" });
    vi.mocked(core.getNeedCard).mockResolvedValueOnce(card({ product: null }));
    await expect(planPurchase(NEED, ORG)).rejects.toMatchObject({ status: 409 });
    expect(core.createProposedPurchase).not.toHaveBeenCalled();
  });
});

describe("offerFlags", () => {
  it("out of stock at the stored retailer, moved retailer, only offer in stock", () => {
    const stored = demoProduct(3000);
    const offers: PurchaseOffer[] = [
      { ...stored, retailer: "amazon.com", unitPriceCents: 3100, inStock: true },
      { ...stored, retailer: "walmart.com", unitPriceCents: 2900, inStock: false },
    ];
    expect(offerFlags(stored, offers[0]!, offers)).toEqual([
      "Price rose $1.00",
      "Out of stock at walmart.com",
      "Now from amazon.com (was walmart.com)",
      "Only offer in stock",
    ]);
    const none = offers.map((o) => ({ ...o, inStock: false }));
    expect(offerFlags(stored, none[1]!, none)).toContain("Out of stock everywhere we checked; check before ordering");
  });
});

describe("explanation (AI)", () => {
  beforeEach(() => formula([{ price: 26 }]));

  it("uses the model's text when every number in it comes from the facts", async () => {
    const model = scriptedModel(() => ({
      explanation: 'Walmart has it in stock for $26.00, down 13%. The $8.00 left over goes to "Diapers, size 4".',
    }));
    setAiModels({ language: model });
    const res = await planPurchase(NEED, ORG);
    expect(res.purchase.explanation).toBe(
      'Walmart has it in stock for $26.00, down 13%. The $8.00 left over goes to "Diapers, size 4".',
    );
    // External text reaches the model wrapped as untrusted data
    expect(model.calls[0]!.promptJson).toContain("<untrusted_product_title>");
  });

  it("falls back to the plain text when the model invents a number, or fails", async () => {
    setAiModels({ language: scriptedModel(() => ({ explanation: "It's $20.00 now, so $45.00 moves on." })) });
    const plain = (await planPurchase(NEED, ORG)).purchase.explanation;
    expect(plain).toMatch(/^Best offer: \$26\.00 each/);

    setAiModels({
      language: scriptedModel(() => {
        throw new Error("model exploded");
      }),
    });
    expect((await planPurchase(NEED, ORG)).purchase.explanation).toBe(plain);
  });

  it("plain text for a surplus with nowhere to go, and for a gap", () => {
    const base = {
      needTitle: "x",
      quantity: 1,
      unit: "can",
      offer: { ...demoProduct(1000) },
      oldUnitPriceCents: 1000,
      fundedCents: 1100,
      newTargetCents: 1100,
      flags: [],
    };
    expect(plainExplanation({ ...base, money: { kind: "surplus", cents: 300, nextNeed: null } })).toContain(
      "$3.00 will be left over; there's no other open need to move it to yet.",
    );
    expect(plainExplanation({ ...base, money: { kind: "gap", cents: 400 } })).toContain(
      "Donors need to cover $4.00 more",
    );
  });
});

describe("POST /api/staff/needs/:id/purchase-plan", () => {
  const KEY = "harbor-demo-2026";
  const org: StaffOrg = {
    id: ORG,
    slug: "harbor-food-bank",
    name: "Harbor Food Bank",
    city: "Portland, OR",
    description: "",
    causeTags: [],
    logoUrl: null,
  };
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({
      logger: false,
      deps: { findOrgByStaffKeyHash: async (h) => (h === hashStaffKey(KEY) ? org : null) },
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  const post = (id: string, headers: Record<string, string> = { "x-staff-key": KEY }) =>
    app.inject({
      method: "POST",
      url: `/api/staff/needs/${id}/purchase-plan`,
      headers: { ...headers, "x-forwarded-for": nextIp(), "content-type": "application/json" },
      payload: "{}",
    });

  it("200 with a PurchasePlanRes for the staff member's own funded need", async () => {
    formula([{ price: 26 }]);
    const res = await post(NEED);
    expect(res.statusCode).toBe(200);
    expect(PurchasePlanRes.parse(res.json()).money.kind).toBe("surplus");
  });

  it("401 without a passcode; 404 for a malformed id", async () => {
    expect((await post(NEED, {})).statusCode).toBe(401);
    const bad = await post("not-a-uuid");
    expect(bad.statusCode).toBe(404);
    expect(ApiError.parse(bad.json()).error.code).toBe("NOT_FOUND");
  });
});

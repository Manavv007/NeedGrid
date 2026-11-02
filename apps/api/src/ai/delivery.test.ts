import { ApiError, DELIVERY_MATCH_THRESHOLD, DeliveryRes, type DeliveryView, type NeedCard } from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app";
import * as core from "../core";
import { hashStaffKey } from "../lib/crypto";
import { HttpError } from "../lib/http";
import type { StaffOrg } from "../plugins/staffAuth";
import { demoProduct, nextIp } from "../test/fixtures";
import { scriptedModel, type ModelCall } from "./__fakes__";
import { checkDeliveryPhoto, RETAIL_DISPLAY_MAX_SCORE, UNAVAILABLE_NOTES, writeImpactNote } from "./delivery";
import { setImageFetcher } from "./images";
import { setAiModels } from "./models";

// core.recordDelivery / confirmDelivery are A's (stubs until Tue Nov 3): mocked here, with getNeedCard.
vi.mock("../core", async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  getNeedCard: vi.fn(),
  recordDelivery: vi.fn(),
  confirmDelivery: vi.fn(),
}));

const ORG = "6f1c1d1e-2b3c-4d5e-8f90-0000000000aa";
const NEED = "6f1c1d1e-2b3c-4d5e-8f90-000000000001";
const DELIVERY = "6f1c1d1e-2b3c-4d5e-8f90-0000000000d1";
const PHOTO = "https://res.cloudinary.com/demo/image/upload/v1/needgrid/arrival.jpg";
const PRODUCT_IMAGE = "https://cdn.trychannel3.com/img/wipes.jpg";

const product = { title: "Pampers Sensitive Wipes, 12 Pack", quantity: 3, unit: "pack", imageUrl: PRODUCT_IMAGE };

let downloads: string[];
beforeEach(() => {
  downloads = [];
  setImageFetcher(async (url) => {
    downloads.push(url);
    return { bytes: new Uint8Array([1, 2, 3]), mediaType: "image/jpeg" };
  });
});
afterEach(() => {
  vi.clearAllMocks();
  setAiModels(null);
  setImageFetcher(null);
});

const isCheck = (c: ModelCall) => c.promptJson.includes("proof-of-delivery photo");
const fileParts = (c: ModelCall) => (c.promptJson.match(/"type":"file"/g) ?? []).length;

describe("checkDeliveryPhoto", () => {
  it("sends the product's reference image and the resized arrival photo; clamps and rounds the score", async () => {
    const model = scriptedModel(() => ({
      matchScore: 0.934,
      visibleQuantityOk: true,
      retailDisplay: false,
      notes: "  Three packs of\nPampers wipes. ",
    }));
    setAiModels({ language: model });
    expect(await checkDeliveryPhoto(PHOTO, product)).toEqual({
      matchScore: 0.93,
      notes: "Three packs of Pampers wipes.",
      visibleQuantityOk: true,
      checked: true,
    });
    expect(downloads).toEqual([
      "https://res.cloudinary.com/demo/image/upload/w_1600,c_limit,q_auto,f_jpg/v1/needgrid/arrival.jpg",
      PRODUCT_IMAGE,
    ]);
    expect(fileParts(model.calls[0]!)).toBe(2);
    expect(model.calls[0]!.promptJson).toContain("<untrusted_product_title>");
  });

  it("a product image on any other host is never downloaded; the check runs on the title alone", async () => {
    const model = scriptedModel(() => ({
      matchScore: 2,
      visibleQuantityOk: null,
      retailDisplay: false,
      notes: "x".repeat(300),
    }));
    setAiModels({ language: model });
    for (const imageUrl of [
      "https://evil.example.com/a.jpg",
      "http://cdn.trychannel3.com/a.jpg",
      "https://cdn.trychannel3.com:8443/a.jpg",
      "https://169.254.169.254/latest",
    ]) {
      downloads = [];
      const res = await checkDeliveryPhoto(PHOTO, { ...product, imageUrl });
      expect(downloads).toHaveLength(1); // the arrival photo only
      expect(res.matchScore).toBe(1);
      expect(res.notes).toHaveLength(200);
    }
    expect(fileParts(model.calls[0]!)).toBe(1);
  });

  it("a product on a store shelf is capped below the threshold (identifies the product, doesn't prove arrival)", async () => {
    setAiModels({
      language: scriptedModel(() => ({ matchScore: 0.9, visibleQuantityOk: null, retailDisplay: true, notes: "" })),
    });
    expect(await checkDeliveryPhoto(PHOTO, product)).toMatchObject({
      matchScore: RETAIL_DISPLAY_MAX_SCORE,
      notes: "The photo looks like a store shelf.",
      checked: true,
    });
    expect(RETAIL_DISPLAY_MAX_SCORE).toBeLessThan(DELIVERY_MATCH_THRESHOLD);
  });

  it("model failure, no AI key or a failed download → score 0 with the exact 'unavailable' notes", async () => {
    const unavailable = { matchScore: 0, notes: UNAVAILABLE_NOTES, visibleQuantityOk: null, checked: false };
    expect(await checkDeliveryPhoto(PHOTO, product)).toEqual(unavailable); // no key in tests
    expect(downloads).toEqual([]);

    setAiModels({
      language: scriptedModel(() => {
        throw new Error("model exploded");
      }),
    });
    expect(await checkDeliveryPhoto(PHOTO, product)).toEqual(unavailable);

    setAiModels({
      language: scriptedModel(() => ({ matchScore: 0.9, visibleQuantityOk: true, retailDisplay: false, notes: "ok" })),
    });
    setImageFetcher(async () => {
      throw new HttpError(502, "UPSTREAM", "Couldn't download the image, try again");
    });
    expect(await checkDeliveryPhoto(PHOTO, product)).toEqual(unavailable);
  });

  it("a photo that isn't ours, or can't be opened, is a 400 (upload again), not a silent pass", async () => {
    setAiModels({
      language: scriptedModel(() => ({ matchScore: 1, visibleQuantityOk: true, retailDisplay: false, notes: "ok" })),
    });
    await expect(checkDeliveryPhoto("https://example.com/a.jpg", product)).rejects.toMatchObject({ status: 400 });
    setImageFetcher(async () => {
      throw new HttpError(400, "VALIDATION", "That file isn't an image");
    });
    await expect(checkDeliveryPhoto(PHOTO, product)).rejects.toMatchObject({ status: 400 });
  });
});

describe("writeImpactNote", () => {
  it("returns the model's note, without exclamation marks", async () => {
    const model = scriptedModel(() => ({ note: "Your wipes arrived today! Families picked them up this afternoon." }));
    setAiModels({ language: model });
    expect(await writeImpactNote("wipes came in, families took them this afternoon", "Baby wipes")).toBe(
      "Your wipes arrived today. Families picked them up this afternoon.",
    );
    expect(model.calls[0]!.promptJson).toContain("<untrusted_staff_note>");
  });

  it("keeps the staff text when the model invents a number, fails, or the note is empty / AI is off", async () => {
    const note = "wipes came in, families took them";
    expect(await writeImpactNote(note, "Baby wipes")).toBe(note); // no key in tests
    setAiModels({ language: scriptedModel(() => ({ note: "Your wipes helped 40 families." })) });
    expect(await writeImpactNote(note, "Baby wipes")).toBe(note);
    setAiModels({
      language: scriptedModel(() => {
        throw new Error("model exploded");
      }),
    });
    expect(await writeImpactNote(note, "Baby wipes")).toBe(note);
    expect(await writeImpactNote("   ", "Baby wipes")).toBe("   ");
  });

  it("numbers from the note or the title are allowed", async () => {
    setAiModels({ language: scriptedModel(() => ({ note: "All 3 packs of size 4 diapers arrived. Thank you." })) });
    expect(await writeImpactNote("3 packs arrived", "Diapers, size 4")).toBe(
      "All 3 packs of size 4 diapers arrived. Thank you.",
    );
  });
});

describe("delivery routes", () => {
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
  const need = (over: Partial<NeedCard> = {}): NeedCard => ({
    id: NEED,
    orgId: ORG,
    orgSlug: "harbor-food-bank",
    title: "Baby wipes",
    description: "",
    category: "baby",
    urgency: 2,
    quantity: 3,
    unit: "pack",
    status: "ordered",
    targetCents: 33000,
    fundedCents: 33000,
    heldCents: 0,
    remainingCents: 0,
    donorCount: 5,
    product: { ...demoProduct(9900), title: product.title, imageUrl: PRODUCT_IMAGE },
    deadlineAt: null,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-29T00:00:00.000Z",
    ...over,
  });
  const delivery = (over: Partial<DeliveryView> = {}): DeliveryView => ({
    id: DELIVERY,
    needId: NEED,
    photoUrl: PHOTO,
    matchScore: 0.9,
    aiNotes: "ok",
    needsReview: false,
    message: null,
    createdAt: "2026-11-03T00:00:00.000Z",
    confirmedAt: null,
    ...over,
  });

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
  beforeEach(() => {
    vi.mocked(core.getNeedCard).mockResolvedValue(need());
    vi.mocked(core.recordDelivery).mockImplementation(async (input) => ({
      delivery: delivery({
        matchScore: input.matchScore,
        aiNotes: input.aiNotes,
        needsReview: input.needsReview,
        message: input.message,
      }),
      need: need({ status: input.needsReview ? "ordered" : "delivered" }),
    }));
    vi.mocked(core.confirmDelivery).mockResolvedValue({ delivery: delivery(), need: need({ status: "delivered" }) });
  });

  const post = (url: string, body: unknown, headers: Record<string, string> = { "x-staff-key": KEY }) =>
    app.inject({
      method: "POST",
      url,
      headers: { ...headers, "x-forwarded-for": nextIp(), "content-type": "application/json" },
      payload: JSON.stringify(body),
    });
  const deliver = (body: unknown, headers?: Record<string, string>) =>
    post(`/api/staff/needs/${NEED}/delivery`, body, headers);

  const model = (score: number) =>
    scriptedModel((c) =>
      isCheck(c)
        ? { matchScore: score, visibleQuantityOk: true, retailDisplay: false, notes: "Three packs of wipes." }
        : { note: "Your wipes arrived. Families took them home today." },
    );

  it("a clear match is recorded without review, with the polished donor note", async () => {
    setAiModels({ language: model(0.92) });
    const res = await deliver({ photoUrl: PHOTO, staffNote: "wipes in, families took them home today" });
    expect(res.statusCode).toBe(200);
    expect(DeliveryRes.parse(res.json()).need.status).toBe("delivered");
    expect(core.recordDelivery).toHaveBeenCalledWith({
      needId: NEED,
      photoUrl: PHOTO,
      matchScore: 0.92,
      aiNotes: "Three packs of wipes.",
      needsReview: false,
      message: "Your wipes arrived. Families took them home today.",
    });
  });

  it("below the threshold, or when the check didn't run, the delivery needs review; no note → message null", async () => {
    setAiModels({ language: model(0.4) });
    await deliver({ photoUrl: PHOTO });
    expect(core.recordDelivery).toHaveBeenLastCalledWith(
      expect.objectContaining({ matchScore: 0.4, needsReview: true, message: null }),
    );

    setAiModels(null); // no key: check unavailable
    await deliver({ photoUrl: PHOTO, staffNote: "arrived" });
    expect(core.recordDelivery).toHaveBeenLastCalledWith(
      expect.objectContaining({ matchScore: 0, aiNotes: UNAVAILABLE_NOTES, needsReview: true, message: "arrived" }),
    );
  });

  it("400 for a photo outside our Cloudinary; 404 for another org's need or a bad id; 409 unless ordered; 401", async () => {
    setAiModels({ language: model(0.9) });
    const bad = await deliver({ photoUrl: "https://example.com/a.jpg" });
    expect(bad.statusCode).toBe(400);
    expect(ApiError.parse(bad.json()).error.code).toBe("VALIDATION");

    vi.mocked(core.getNeedCard).mockResolvedValueOnce(need({ orgId: DELIVERY }));
    expect((await deliver({ photoUrl: PHOTO })).statusCode).toBe(404);
    expect((await post("/api/staff/needs/nope/delivery", { photoUrl: PHOTO })).statusCode).toBe(404);

    vi.mocked(core.getNeedCard).mockResolvedValueOnce(need({ status: "funded" }));
    const notOrdered = await deliver({ photoUrl: PHOTO });
    expect([notOrdered.statusCode, ApiError.parse(notOrdered.json()).error.code]).toEqual([409, "INVALID_STATE"]);

    expect((await deliver({ photoUrl: PHOTO }, {})).statusCode).toBe(401);
    expect(core.recordDelivery).not.toHaveBeenCalled();
  });

  it("confirm: passes the staff's org; an emptied message is sent as '' (stored as null), none as undefined", async () => {
    const confirm = (body: unknown, id = DELIVERY) => post(`/api/staff/deliveries/${id}/confirm`, body);
    expect((await confirm({ message: "  Thank you.  " })).statusCode).toBe(200);
    expect(core.confirmDelivery).toHaveBeenLastCalledWith(DELIVERY, ORG, "Thank you.");
    await confirm({ message: "" });
    expect(core.confirmDelivery).toHaveBeenLastCalledWith(DELIVERY, ORG, "");
    await confirm({});
    expect(core.confirmDelivery).toHaveBeenLastCalledWith(DELIVERY, ORG, undefined);
    expect((await confirm({}, "nope")).statusCode).toBe(404);
  });
});

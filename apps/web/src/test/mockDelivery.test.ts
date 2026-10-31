import {
  ApiError,
  DeliveryRes,
  ImpactRes,
  NeedCard,
  NeedDetailRes,
  paths,
  STAFF_KEY_HEADER,
  StaffNeedDetailRes,
  type DeliveryReq,
} from "@needgrid/shared";
import { afterEach, describe, expect, it } from "vitest";
import { MOCK_UPLOAD_URL } from "@/lib/cloudinary";
import { DEMO_IMPACT_TOKEN, ORG_IDS } from "@/mocks/fixtures";
import { MOCK_MATCH_SCORE, MOCK_REVIEW_SCORE, mockDb, VISION_UNAVAILABLE_NOTES } from "@/mocks/mockDb";
import { scenariosFromSearch } from "@/mocks/scenarios";

const API = "http://api.test";
const HARBOR = ORG_IDS.harbor;
const ID = {
  laundry: "4c1f7a2e-9b3d-4e5f-8a6b-000000000110", // funded
  socks: "4c1f7a2e-9b3d-4e5f-8a6b-000000000111", // ordered, part of Sam's demo gift
  diapers3: "4c1f7a2e-9b3d-4e5f-8a6b-000000000112", // delivered
  chewToys: "4c1f7a2e-9b3d-4e5f-8a6b-000000000209", // Paws, ordered
} as const;

afterEach(() => {
  expect(mockDb.moneyProblems()).toEqual([]);
});

const req = (staffNote = ""): DeliveryReq => ({ photoUrl: MOCK_UPLOAD_URL, staffNote });

function record(needId: string, staffNote = "") {
  const result = mockDb.recordDelivery(HARBOR, needId, req(staffNote));
  if (result.kind !== "ok") throw new Error(`expected a delivery, got ${JSON.stringify(result)}`);
  return DeliveryRes.parse(result.delivery);
}

function confirm(deliveryId: string, message?: string) {
  const result = mockDb.confirmDelivery(HARBOR, deliveryId, message === undefined ? {} : { message });
  if (result.kind !== "ok") throw new Error(`expected a confirmation, got ${JSON.stringify(result)}`);
  return DeliveryRes.parse(result.delivery);
}

const staffNeed = (id: string) => StaffNeedDetailRes.parse(mockDb.getStaffNeedDetail(HARBOR, id));
const publicNeed = (id: string) => NeedDetailRes.parse(mockDb.getNeedDetail(id));
const samsSocks = () => ImpactRes.parse(mockDb.getImpact(DEMO_IMPACT_TOKEN)).items.find((i) => i.need.id === ID.socks);

/** Live updates for Harbor's tile walls while `run` runs. */
function liveUpdates(run: () => void): NeedCard[] {
  const cards: NeedCard[] = [];
  const stop = mockDb.subscribeNeedUpdates("harbor-food-bank", (data) => cards.push(NeedCard.parse(JSON.parse(data))));
  try {
    run();
  } finally {
    stop();
  }
  return cards;
}

async function post(path: string, body: unknown, key: string | null = "harbor-demo-2026") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers[STAFF_KEY_HEADER] = key;
  const res = await fetch(`${API}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as unknown };
}

describe("mock delivery check (B's route)", () => {
  it("a matching photo: 94%, delivered at once, Arrived on the timeline, live, and donors see it", () => {
    let res: DeliveryRes | null = null;
    const cards = liveUpdates(() => {
      res = record(ID.socks, "  on the shelf   by lunch ");
    });
    expect(res).toMatchObject({
      delivery: {
        needId: ID.socks,
        photoUrl: MOCK_UPLOAD_URL,
        matchScore: MOCK_MATCH_SCORE,
        needsReview: false,
        message: "On the shelf by lunch. Thank you for helping us get it.",
        confirmedAt: null,
      },
      need: { id: ID.socks, status: "delivered" },
    });
    expect(cards.map((c) => [c.id, c.status])).toEqual([[ID.socks, "delivered"]]);
    expect(staffNeed(ID.socks).timeline.at(-1)).toMatchObject({ type: "delivered", label: "Arrived" });
    expect(publicNeed(ID.socks).delivery).toMatchObject({ photoUrl: MOCK_UPLOAD_URL, message: expect.any(String) });
    // Sam's impact page (a fixture gift in the ledger) now shows the socks' photo.
    expect(samsSocks()).toMatchObject({ need: { status: "delivered" }, delivery: { photoUrl: MOCK_UPLOAD_URL } });
  });

  it("no note, no message", () => {
    expect(record(ID.socks).delivery.message).toBeNull();
  });

  it('a note with "mismatch": 42%, waits for review, nothing public, no live update', () => {
    let res: DeliveryRes | null = null;
    const cards = liveUpdates(() => {
      res = record(ID.socks, "Mismatch? Only 2 packs came");
    });
    expect(res).toMatchObject({
      delivery: { matchScore: MOCK_REVIEW_SCORE, needsReview: true, confirmedAt: null },
      need: { status: "ordered" },
    });
    expect(cards).toEqual([]);
    expect(staffNeed(ID.socks).delivery).toMatchObject({ needsReview: true });
    expect(publicNeed(ID.socks).delivery).toBeNull();
    expect(samsSocks()?.delivery).toBeNull();
  });

  it("?mock=deliveryReview and ?mock=deliveryFail switch the next check only", () => {
    expect(scenariosFromSearch("?mock=deliveryReview,deliveryFail")).toEqual(["deliveryReview", "deliveryFail"]);

    mockDb.armScenario("deliveryFail");
    expect(record(ID.socks).delivery).toMatchObject({
      matchScore: 0,
      aiNotes: VISION_UNAVAILABLE_NOTES,
      needsReview: true,
    });

    mockDb.armScenario("deliveryReview");
    expect(record(ID.socks).delivery).toMatchObject({ matchScore: MOCK_REVIEW_SCORE, needsReview: true });
    expect(record(ID.socks).delivery).toMatchObject({ matchScore: MOCK_MATCH_SCORE, needsReview: false });
  });

  it("only an ordered need of the caller's charity", () => {
    expect(mockDb.recordDelivery(HARBOR, ID.laundry, req())).toMatchObject({
      kind: "refused",
      status: 409,
      code: "INVALID_STATE",
    });
    expect(mockDb.recordDelivery(HARBOR, ID.diapers3, req())).toMatchObject({ kind: "refused", status: 409 });
    expect(mockDb.recordDelivery(HARBOR, ID.chewToys, req()).kind).toBe("notFound");
  });
});

describe("mock confirm delivery (staff override)", () => {
  it("confirms a reviewed delivery with an edited message: delivered, dated, live, public", () => {
    const { delivery } = record(ID.socks, "mismatch");
    let res: DeliveryRes | null = null;
    const cards = liveUpdates(() => {
      res = confirm(delivery.id, "  All 4 packs arrived. Thank you!  ");
    });
    expect(res).toMatchObject({
      delivery: { id: delivery.id, confirmedAt: expect.any(String), message: "All 4 packs arrived. Thank you!" },
      need: { status: "delivered" },
    });
    expect(cards.map((c) => c.status)).toEqual(["delivered"]);
    expect(publicNeed(ID.socks).delivery).toMatchObject({ message: "All 4 packs arrived. Thank you!" });
    expect(samsSocks()?.delivery?.deliveredAt).toBe(staffNeed(ID.socks).delivery?.confirmedAt);
  });

  it("keeps the server's message without one, and an emptied message means none", () => {
    const first = record(ID.socks, "mismatch");
    expect(confirm(first.delivery.id).delivery.message).toBe(first.delivery.message);

    mockDb.reset();
    const second = record(ID.socks, "mismatch");
    expect(confirm(second.delivery.id, "   ").delivery.message).toBeNull();
    expect(publicNeed(ID.socks).delivery?.message).toBeNull();
  });

  it("confirming twice changes nothing; unknown and other charities' deliveries are not found", () => {
    const { delivery } = record(ID.socks, "mismatch");
    const once = confirm(delivery.id, "First");
    expect(confirm(delivery.id, "Second")).toEqual(once);
    expect(mockDb.confirmDelivery(HARBOR, crypto.randomUUID(), {}).kind).toBe("notFound");
    expect(mockDb.confirmDelivery(ORG_IDS.paws, delivery.id, {}).kind).toBe("notFound");
  });
});

describe("mock delivery handlers", () => {
  it("401 without the staff key, 404 for malformed or unknown ids", async () => {
    expect((await post(paths.staff.delivery(ID.socks), req(), null)).status).toBe(401);
    expect((await post(paths.staff.delivery("not-a-uuid"), req())).status).toBe(404);
    expect((await post(paths.staff.delivery("4c1f7a2e-9b3d-4e5f-8a6b-000000000999"), req())).status).toBe(404);
    expect((await post(paths.staff.confirmDelivery(crypto.randomUUID()), {})).status).toBe(404);
    expect((await post(paths.staff.confirmDelivery(crypto.randomUUID()), {}, null)).status).toBe(401);
  });

  it("400 VALIDATION for a photo that isn't on Cloudinary, or a note over 500 characters", async () => {
    for (const body of [
      { photoUrl: "https://example.com/arrival.jpg", staffNote: "" },
      { photoUrl: "http://res.cloudinary.com/demo/image/upload/a.jpg" },
      { photoUrl: MOCK_UPLOAD_URL, staffNote: "x".repeat(501) },
    ]) {
      const res = await post(paths.staff.delivery(ID.socks), body);
      expect(res.status).toBe(400);
      expect(ApiError.parse(res.json).error.code).toBe("VALIDATION");
    }
    expect(staffNeed(ID.socks).delivery).toBeNull();
  });

  it("check → review → confirm over HTTP, every response a DeliveryRes; 409 once it's delivered", async () => {
    const checked = await post(paths.staff.delivery(ID.socks), { photoUrl: MOCK_UPLOAD_URL, staffNote: "mismatch" });
    expect(checked.status).toBe(200);
    const { delivery } = DeliveryRes.parse(checked.json);
    expect(delivery.needsReview).toBe(true);

    const confirmed = await post(paths.staff.confirmDelivery(delivery.id), { message: "All here" });
    expect(confirmed.status).toBe(200);
    expect(DeliveryRes.parse(confirmed.json).need.status).toBe("delivered");

    const again = await post(paths.staff.delivery(ID.socks), req());
    expect(again.status).toBe(409);
    expect(ApiError.parse(again.json).error.code).toBe("INVALID_STATE");
  });
});

import {
  computeTargetCents,
  ImpactRes,
  NEED_STATUSES,
  NeedDetailRes,
  OrgListRes,
  OrgPageRes,
  PurchaseOffer,
  StaffNeedDetailRes,
} from "@needgrid/shared";
import { describe, expect, it } from "vitest";
import { DEMO_IMPACT_TOKEN, freshOffers, impacts, needs, orgs } from "@/mocks/fixtures";
import { mockDb } from "@/mocks/mockDb";

const harborDiapers = "4c1f7a2e-9b3d-4e5f-8a6b-000000000101";
const laundry = "4c1f7a2e-9b3d-4e5f-8a6b-000000000110";

describe("mock fixtures", () => {
  it("has the three demo orgs", () => {
    expect(orgs.map((o) => o.slug)).toEqual(["harbor-food-bank", "second-chance-paws", "room-12-readers"]);
  });

  it("gives every org about 12 needs covering every status", () => {
    for (const org of orgs) {
      const cards = needs.filter((n) => n.card.orgId === org.id).map((n) => n.card);
      expect(cards.length).toBeGreaterThanOrEqual(12);
      expect(new Set(cards.map((c) => c.status))).toEqual(new Set(NEED_STATUSES));
    }
  });

  it("uses unique ids and targets from computeTargetCents", () => {
    expect(new Set(needs.map((n) => n.card.id)).size).toBe(needs.length);
    for (const { card } of needs) {
      expect(card.product).not.toBeNull();
      if (card.product) expect(card.targetCents).toBe(computeTargetCents(card.product.unitPriceCents, card.quantity));
    }
  });

  it("has Harbor's Diapers, size 4 with exactly $14 left of $84", () => {
    const diapers = needs.find((n) => n.card.id === harborDiapers)?.card;
    expect(diapers).toMatchObject({ title: "Diapers, size 4", targetCents: 8400, remainingCents: 1400 });
  });

  it("has a funded need with a cheaper fresh price, an ordered need and a delivered need with a photo", () => {
    const funded = needs.find((n) => n.card.id === laundry);
    const offer = freshOffers[laundry];
    expect(funded?.card.status).toBe("funded");
    expect(offer && PurchaseOffer.parse(offer).unitPriceCents).toBeLessThan(funded?.card.product?.unitPriceCents ?? 0);
    expect(needs.some((n) => n.card.status === "ordered" && n.purchases[0]?.orderRef)).toBe(true);
    expect(needs.some((n) => n.card.status === "delivered" && n.delivery?.photoUrl)).toBe(true);
  });

  it("has the demo impact token and it adds up", () => {
    const impact = ImpactRes.parse(impacts[DEMO_IMPACT_TOKEN]);
    expect(impact.totalCents).toBe(impact.items.reduce((sum, i) => sum + i.amountCents, 0));
  });
});

describe("mockDb responses parse with the shared schemas", () => {
  it("orgs, org pages and need details", () => {
    const list = OrgListRes.parse({ orgs: mockDb.listOrgSummaries() });
    for (const org of list.orgs) {
      const page = OrgPageRes.parse(mockDb.getOrgPage(org.slug));
      expect(page.stats).toEqual(org.stats);
      expect(page.needs.some((n) => n.status === "draft" || n.status === "closed")).toBe(false);
      for (const need of page.needs) NeedDetailRes.parse(mockDb.getNeedDetail(need.id));
    }
  });

  it("keeps org stats consistent with the needs", () => {
    for (const org of mockDb.listOrgSummaries()) {
      const cards = needs.filter((n) => n.card.orgId === org.id).map((n) => n.card);
      expect(org.stats.raisedCents).toBe(cards.reduce((sum, c) => sum + c.fundedCents, 0));
      expect(org.stats.openNeeds).toBe(cards.filter((c) => c.status === "open" || c.status === "topping_up").length);
    }
  });

  it("staff need details", () => {
    for (const { card } of needs) StaffNeedDetailRes.parse(mockDb.getStaffNeedDetail(card.orgId, card.id));
  });

  it("hides drafts from the public need page", () => {
    const draft = needs.find((n) => n.card.status === "draft");
    expect(draft && mockDb.getNeedDetail(draft.card.id)).toBeNull();
  });
});

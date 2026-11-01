import {
  computeTargetCents,
  ImpactRes,
  NEED_STATUSES,
  NeedDetailRes,
  OrgListRes,
  OrgPageRes,
  planPurchaseMoney,
  PurchaseOffer,
  StaffNeedDetailRes,
} from "@needgrid/shared";
import { describe, expect, it } from "vitest";
import { DEMO_IMPACT_TOKEN, DEMO_NEEDS, freshOffers, impactRecords, needs, orgs } from "@/mocks/fixtures";
import { mockDb } from "@/mocks/mockDb";

const need = (id: string) => needs.find((n) => n.card.id === id);

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

  it("gives Harbor's tile wall a tile in every visible state and needs in at least 4 categories", () => {
    const page = OrgPageRes.parse(mockDb.getOrgPage("harbor-food-bank"));
    const statuses = new Set(page.needs.map((n) => n.status));
    for (const status of ["open", "topping_up", "funded", "ordered", "delivered"] as const) {
      expect(statuses).toContain(status);
    }
    expect(page.needs.some((n) => n.status === "open" && n.heldCents > 0)).toBe(true);
    expect(new Set(page.needs.map((n) => n.category)).size).toBeGreaterThanOrEqual(4);
  });
});

describe("the demo scenes mirror B's seed heroes", () => {
  it("donation: Harbor's Diapers, size 4 is open with exactly $14 left of $84", () => {
    expect(need(DEMO_NEEDS.fourteenLeft)?.card).toMatchObject({
      orgSlug: "harbor-food-bank",
      title: "Diapers, size 4",
      status: "open",
      targetCents: 8400,
      remainingCents: 1400,
    });
  });

  it("purchase plan: Harbor's Infant formula is funded at a price 15% above today's, so the plan has a surplus", () => {
    const formula = need(DEMO_NEEDS.priceDrop)?.card;
    const today = freshOffers[DEMO_NEEDS.priceDrop];
    expect(formula).toMatchObject({ orgSlug: "harbor-food-bank", title: "Infant formula", status: "funded" });
    const posted = formula?.product?.unitPriceCents ?? 0;
    const todayCents = today ? PurchaseOffer.parse(today).unitPriceCents : 0;
    // plan.ts: Math.ceil((price × 1.15) / 10) × 10, the cached Channel3 price marked up by 15%.
    expect(posted).toBe(Math.ceil((todayCents * 115) / 1000) * 10);
    const newTarget = computeTargetCents(todayCents, formula?.quantity ?? 1);
    expect(planPurchaseMoney(formula?.fundedCents ?? 0, newTarget)).toEqual({ kind: "surplus", cents: 1200 });
  });

  it("delivery: Harbor's Baby wipes is ordered, with an order number, and part of the demo impact gift", () => {
    const wipes = need(DEMO_NEEDS.ordered);
    expect(wipes?.card).toMatchObject({ orgSlug: "harbor-food-bank", title: "Baby wipes", status: "ordered" });
    expect(wipes?.purchases[0]).toMatchObject({ status: "ordered", orderRef: expect.any(String) });
    const sam = impactRecords.find((r) => r.token === DEMO_IMPACT_TOKEN);
    expect(sam?.items.map((i) => i.needId)).toContain(DEMO_NEEDS.ordered);
  });

  it("sponsor invoice: Room 12 has four open winter-coat needs, sizes 6 to 12, still to raise", () => {
    const coats = DEMO_NEEDS.coats.map((id) => need(id)?.card);
    expect(coats.map((c) => [c?.orgSlug, c?.title, c?.status])).toEqual(
      [6, 8, 10, 12].map((size) => ["room-12-readers", `Winter coats, kids' size ${size}`, "open"]),
    );
    for (const coat of coats) expect(coat?.remainingCents).toBeGreaterThan(0);
  });

  it("also has a delivered need with a photo", () => {
    expect(needs.some((n) => n.card.status === "delivered" && n.delivery?.photoUrl)).toBe(true);
  });

  it("has the demo impact token, built from the ledger, and it adds up", () => {
    const impact = ImpactRes.parse(mockDb.getImpact(DEMO_IMPACT_TOKEN));
    expect(impact.donorFirstName).toBe("Sam");
    expect(impact.totalCents).toBe(impact.items.reduce((sum, i) => sum + i.amountCents, 0));
    // ImpactPhone.dc.html: one delivered item with a photo and one ordered item.
    expect(impact.items.map((i) => [i.need.status, i.delivery !== null])).toEqual([
      ["delivered", true],
      ["ordered", false],
    ]);
    expect(mockDb.moneyProblems()).toEqual([]);
  });
});

describe("mock dates follow the clock", () => {
  // No date text here, only comparisons with whatever the clock says now. Fixed dates would break
  // these as soon as the calendar passed them.
  const DAY_MS = 86_400_000;
  const now = Date.now();
  const ms = (iso: string) => Date.parse(iso);

  it("keeps Diapers, size 4 needed within the week", () => {
    const deadline = need(DEMO_NEEDS.fourteenLeft)?.card.deadlineAt;
    expect(deadline).toBeTruthy();
    const ahead = ms(deadline ?? "") - now;
    expect(ahead).toBeGreaterThan(0);
    expect(ahead).toBeLessThan(6 * DAY_MS);
  });

  it("puts every donatable deadline ahead and everything that happened in the past", () => {
    for (const { card, timeline, delivery, purchases } of needs) {
      expect(ms(card.createdAt)).toBeLessThan(now);
      expect(ms(card.updatedAt)).toBeLessThan(now);
      if (card.deadlineAt && (card.status === "open" || card.status === "topping_up")) {
        expect(ms(card.deadlineAt)).toBeGreaterThan(now);
      }
      for (const event of timeline) expect(ms(event.at)).toBeLessThan(now);
      for (const purchase of purchases) expect(ms(purchase.createdAt)).toBeLessThan(now);
      if (delivery) expect(ms(delivery.deliveredAt)).toBeLessThan(now);
    }
    for (const record of impactRecords) expect(ms(record.donatedAt)).toBeLessThan(now);
  });

  it("keeps each need's story in order: posted, funded, delivered", () => {
    for (const { card, timeline } of needs) {
      const times = timeline.map((e) => ms(e.at));
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(times[0]).toBe(ms(card.createdAt));
    }
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

import { computeTargetCents, type DraftNeed, type IntakeRes, type ProductOption } from "@needgrid/shared";
import { describe, expect, it } from "vitest";
import {
  applyLinkResult,
  buildPublishRequest,
  canInclude,
  deadlineIso,
  estimatedTotalCents,
  estimateCents,
  fieldErrors,
  overrideCents,
  rowFromDraft,
  targetView,
  withChanges,
} from "@/features/staff/intake/draftRows";

const FETCHED = "2026-10-30T12:00:00.000Z";

function option(n: number, unitPriceCents: number): ProductOption {
  return {
    channel3Id: `c3_${n}`,
    title: `Option ${n}`,
    imageUrl: `https://images.example/${n}.jpg`,
    retailer: "Walmart",
    url: `https://www.walmart.com/ip/${n}`,
    unitPriceCents,
    packSize: 150,
    inStock: true,
    fetchedAt: FETCHED,
    fitScore: 0.9,
    fitReason: "Right size",
    pricePerItemCents: Math.round(unitPriceCents / 150),
  };
}

function draft(overrides: Partial<DraftNeed> = {}): DraftNeed {
  return {
    draftId: "d1",
    extracted: {
      title: "Diapers, size 4",
      quantity: 2,
      unit: "pack of 150",
      category: "baby",
      urgency: 3,
      notes: null,
      searchQuery: "diapers size 4",
      confidence: 0.95,
    },
    options: [option(1, 3849), option(2, 4199), option(3, 4497)],
    suggestedTargetCents: computeTargetCents(3849, 2),
    ...overrides,
  };
}

const SNAPSHOT_KEYS = [
  "channel3Id",
  "fetchedAt",
  "imageUrl",
  "inStock",
  "packSize",
  "retailer",
  "title",
  "unitPriceCents",
  "url",
].sort();

describe("intake draft rows", () => {
  it("ticks a row only when it has a product and a target", () => {
    expect(rowFromDraft(draft()).included).toBe(true);
    expect(rowFromDraft(draft({ options: [], suggestedTargetCents: null })).included).toBe(false);
    expect(rowFromDraft(draft({ suggestedTargetCents: null })).included).toBe(false);
  });

  it("estimates the target from the selected product and the quantity", () => {
    const row = rowFromDraft(draft());
    expect(estimateCents(row)).toBe(8400);
    expect(estimateCents({ ...row, quantity: "3" })).toBe(12500);
    expect(estimateCents({ ...row, selected: 1 })).toBe(computeTargetCents(4199, 2));
    expect(estimateCents({ ...row, quantity: "0" })).toBeNull();
    expect(estimateCents({ ...row, quantity: "2.5" })).toBeNull();
    expect(targetView(rowFromDraft(draft({ suggestedTargetCents: null })))).toEqual({ kind: "needsTarget" });
  });

  it("parses the target override with integer maths, from $1", () => {
    expect(overrideCents({ targetText: "84.5" })).toBe(8450);
    expect(overrideCents({ targetText: " 90 " })).toBe(9000);
    expect(overrideCents({ targetText: "1.234" })).toBeNull();
    expect(overrideCents({ targetText: "-5" })).toBeNull();
    expect(overrideCents({ targetText: "0.99" })).toBeNull();
    expect(overrideCents({ targetText: null })).toBeNull();
    expect(fieldErrors({ ...rowFromDraft(draft()), targetText: "abc" }).target).toBe(
      "Use dollars and cents, like 84.00.",
    );
  });

  it("a deadline is the end of that day in UTC", () => {
    expect(deadlineIso("2026-11-20")).toBe("2026-11-20T23:59:59.000Z");
    expect(deadlineIso("2026-02-30")).toBeNull();
    expect(deadlineIso("20-11-2026")).toBeNull();
  });

  it("ticks a row that just got a target and unticks one that lost it", () => {
    const noTarget = rowFromDraft(draft({ suggestedTargetCents: null }));
    const withTarget = withChanges(noTarget, { targetText: "60" });
    expect(withTarget.included).toBe(true);
    expect(withChanges(withTarget, { targetText: "" }).included).toBe(false);
    // An unticked row with a product stays unticked when staff edit it.
    const unticked = withChanges(rowFromDraft(draft()), { included: false });
    expect(withChanges(unticked, { title: "Diapers, size 5" }).included).toBe(false);
  });

  it("builds exactly the PublishNeedReq body: stripped products, no fit data, server-computed target", () => {
    const row = withChanges(rowFromDraft(draft()), { selected: 1, description: "  For 30 families  " });
    const body = buildPublishRequest(row, true);
    expect(body).toEqual({
      title: "Diapers, size 4",
      description: "For 30 families",
      category: "baby",
      urgency: 3,
      quantity: 2,
      unit: "pack of 150",
      product: {
        channel3Id: "c3_2",
        title: "Option 2",
        imageUrl: "https://images.example/2.jpg",
        retailer: "Walmart",
        url: "https://www.walmart.com/ip/2",
        unitPriceCents: 4199,
        packSize: 150,
        inStock: true,
        fetchedAt: FETCHED,
      },
      alternatives: [expect.objectContaining({ channel3Id: "c3_1" }), expect.objectContaining({ channel3Id: "c3_3" })],
      deadlineAt: null,
      publish: true,
    });
    expect("targetCents" in body).toBe(false);
    for (const alternative of body.alternatives) expect(Object.keys(alternative).sort()).toEqual(SNAPSHOT_KEYS);
  });

  it("sends targetCents and the deadline only when staff set them; drafts get publish: false", () => {
    const row = withChanges(rowFromDraft(draft()), { targetText: "90", deadline: "2026-11-20" });
    const body = buildPublishRequest(row, false);
    expect(body.targetCents).toBe(9000);
    expect(body.deadlineAt).toBe("2026-11-20T23:59:59.000Z");
    expect(body.publish).toBe(false);
  });

  it("the estimated total adds up the ticked rows only", () => {
    const a = rowFromDraft(draft());
    const b = withChanges(rowFromDraft({ ...draft(), draftId: "d2" }), { included: false });
    const c = rowFromDraft(draft({ draftId: "d3", options: [], suggestedTargetCents: null }));
    expect(estimatedTotalCents([a, b, c])).toBe(8400);
  });

  it("a pasted link swaps in its first option and makes the row publishable", () => {
    const empty = rowFromDraft(draft({ options: [], suggestedTargetCents: null }));
    expect(canInclude(empty)).toBe(false);
    const linked: IntakeRes = {
      drafts: [draft({ draftId: "link", options: [option(9, 2500)], suggestedTargetCents: 2700 })],
      warnings: [],
    };
    const outcome = applyLinkResult(empty, linked);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.row.id).toBe(empty.id);
    expect(outcome.row.options.map((o) => o.channel3Id)).toEqual(["c3_9"]);
    expect(outcome.row.included).toBe(true);

    const nothing = applyLinkResult(empty, { drafts: [], warnings: ["Couldn't find a product at that link."] });
    expect(nothing).toEqual({ ok: false, problem: "Couldn't find a product at that link." });
  });
});

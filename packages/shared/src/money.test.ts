import { describe, expect, it } from "vitest";
import {
  centsToPayPalValue,
  clampDonation,
  computeTargetCents,
  dollarsToCents,
  formatUsd,
  payPalValueToCents,
  planPurchaseMoney,
  remainingCents,
  splitCapture,
  takeFromAllocations,
} from "./money";

describe("computeTargetCents", () => {
  it("matches the plan example: 2 x $38.49 -> $84", () => {
    expect(computeTargetCents(3849, 2)).toBe(8400);
  });
  it("rounds up to the next dollar even when the base is a whole dollar", () => {
    expect(computeTargetCents(1000, 1)).toBe(1100); // 10.00 -> 10.80 -> 11.00
  });
  it("rejects non-integer cents and bad quantities", () => {
    expect(() => computeTargetCents(10.5, 1)).toThrow();
    expect(() => computeTargetCents(1000, 0)).toThrow();
    expect(() => computeTargetCents(1000, 1.5)).toThrow();
  });
});

describe("remainingCents", () => {
  it("subtracts funded and held, never below zero", () => {
    expect(remainingCents({ targetCents: 8400, fundedCents: 5000, heldCents: 2000 })).toBe(1400);
    expect(remainingCents({ targetCents: 8400, fundedCents: 8000, heldCents: 2000 })).toBe(0);
  });
});

describe("clampDonation", () => {
  it("returns null when nothing is left", () => {
    expect(clampDonation(2500, 0)).toBeNull();
  });
  it("clamps above remaining", () => {
    expect(clampDonation(2500, 1400)).toEqual({ amountCents: 1400, wasClamped: true });
  });
  it("passes a small remaining amount through", () => {
    expect(clampDonation(100, 50)).toEqual({ amountCents: 50, wasClamped: true });
    expect(clampDonation(50, 50)).toEqual({ amountCents: 50, wasClamped: false });
  });
});

describe("splitCapture", () => {
  it("room 0 -> everything overflows", () => {
    expect(splitCapture(1400, 0)).toEqual({ directCents: 0, overflowCents: 1400 });
  });
  it("partial room", () => {
    expect(splitCapture(1400, 1000)).toEqual({ directCents: 1000, overflowCents: 400 });
  });
  it("full room", () => {
    expect(splitCapture(1400, 5000)).toEqual({ directCents: 1400, overflowCents: 0 });
  });
});

describe("planPurchaseMoney", () => {
  it("exact", () => expect(planPurchaseMoney(8400, 8400)).toEqual({ kind: "exact" }));
  it("surplus when cheaper", () => expect(planPurchaseMoney(8400, 8100)).toEqual({ kind: "surplus", cents: 300 }));
  it("gap when pricier", () => expect(planPurchaseMoney(8400, 8900)).toEqual({ kind: "gap", cents: 500 }));
});

describe("takeFromAllocations", () => {
  const allocations = [
    { donationId: "a", amountCents: 500, createdAt: "2026-10-01T00:00:00.000Z" },
    { donationId: "b", amountCents: 300, createdAt: "2026-10-02T00:00:00.000Z" },
  ];
  it("takes from the newest donation first", () => {
    expect(takeFromAllocations(allocations, 200)).toEqual([{ donationId: "b", amountCents: 200 }]);
  });
  it("splits across donations", () => {
    expect(takeFromAllocations(allocations, 400)).toEqual([
      { donationId: "b", amountCents: 300 },
      { donationId: "a", amountCents: 100 },
    ]);
  });
  it("uses net amounts (negative rows reduce a donation)", () => {
    const withMove = [...allocations, { donationId: "b", amountCents: -300, createdAt: "2026-10-03T00:00:00.000Z" }];
    expect(takeFromAllocations(withMove, 200)).toEqual([{ donationId: "a", amountCents: 200 }]);
  });
  it("throws when there is not enough money", () => {
    expect(() => takeFromAllocations(allocations, 900)).toThrow();
  });
});

describe("PayPal string conversion", () => {
  it("formats cents", () => {
    expect(centsToPayPalValue(5)).toBe("0.05");
    expect(centsToPayPalValue(8400)).toBe("84.00");
    expect(centsToPayPalValue(1234567)).toBe("12345.67");
  });
  it("parses decimal strings without float maths", () => {
    expect(payPalValueToCents("84.00")).toBe(8400);
    expect(payPalValueToCents("84.5")).toBe(8450);
    expect(payPalValueToCents("84")).toBe(8400);
    expect(payPalValueToCents("0.07")).toBe(7);
  });
  it("rejects invalid strings", () => {
    for (const bad of ["1.234", "-1", "abc", "", "1,00"]) {
      expect(() => payPalValueToCents(bad)).toThrow();
    }
  });
  it("round-trips", () => {
    for (const c of [0, 1, 99, 100, 8314, 100000]) expect(payPalValueToCents(centsToPayPalValue(c))).toBe(c);
  });
});

describe("dollarsToCents / formatUsd", () => {
  it("converts external dollar prices at the boundary", () => {
    expect(dollarsToCents(38.49)).toBe(3849);
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
    expect(() => dollarsToCents(-1)).toThrow();
  });
  it("formats for display", () => {
    expect(formatUsd(8400)).toBe("$84.00");
  });
});

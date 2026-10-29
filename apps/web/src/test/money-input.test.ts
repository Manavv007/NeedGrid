import { MAX_DONATION_CENTS, MIN_DONATION_CENTS } from "@needgrid/shared";
import { describe, expect, it } from "vitest";
import {
  checkOtherAmount,
  defaultChoice,
  FORMAT_ERROR,
  isOffered,
  MIN_ERROR,
  parseDollarsToCents,
  presetsFor,
  resolveGift,
} from "@/features/donate/money-input";

describe("parseDollarsToCents", () => {
  it.each([
    ["10.5", 1050],
    ["10", 1000],
    ["10.50", 1050],
    ["0.05", 5],
    ["14.00", 1400],
    ["007.10", 710],
    ["1000", 100_000],
  ])("%s → %i cents", (input, cents) => {
    expect(parseDollarsToCents(input)).toBe(cents);
  });

  it.each([
    "1.234",
    "-1",
    "abc",
    "",
    "1e3",
    " 5",
    "5 ",
    "+5",
    "10.",
    ".5",
    "1,000",
    "12.3.4",
    "１０",
    "0x10",
    "Infinity",
  ])("rejects %j", (input) => {
    expect(parseDollarsToCents(input)).toBeNull();
  });

  it("rejects numbers too large to count exactly instead of rounding them", () => {
    expect(parseDollarsToCents("99999999999999999999")).toBeNull();
  });
});

describe("checkOtherAmount", () => {
  it("accepts amounts between the minimum and what's left", () => {
    expect(checkOtherAmount("12.50", 1400)).toEqual({ ok: true, cents: 1250 });
    expect(checkOtherAmount("14", 1400)).toEqual({ ok: true, cents: 1400 });
    expect(checkOtherAmount("1", 1400)).toEqual({ ok: true, cents: MIN_DONATION_CENTS });
  });

  it("explains format, maximum and minimum problems", () => {
    expect(checkOtherAmount("12.345", 1400)).toEqual({ ok: false, error: FORMAT_ERROR });
    expect(checkOtherAmount("14.01", 1400)).toEqual({ ok: false, error: "The most you can give here is $14.00." });
    expect(checkOtherAmount("0.99", 1400)).toEqual({ ok: false, error: MIN_ERROR });
    expect(MIN_ERROR).toBe("The minimum is $1.00.");
    expect(checkOtherAmount("99999999999999999999", 1400)).toEqual({
      ok: false,
      error: "The most you can give here is $14.00.",
    });
  });

  it("caps at the per-checkout maximum when more than that is left", () => {
    expect(checkOtherAmount("1000.01", 500_000)).toEqual({
      ok: false,
      error: "The most you can give here is $1,000.00.",
    });
    expect(checkOtherAmount("1000", 500_000)).toEqual({ ok: true, cents: MAX_DONATION_CENTS });
  });

  it("says nothing yet about an empty field", () => {
    expect(checkOtherAmount("", 1400)).toEqual({ ok: false, error: null });
  });
});

describe("gift choices", () => {
  it("hides presets at or above what's left", () => {
    expect(presetsFor(1400)).toEqual([1000]);
    expect(presetsFor(2500)).toEqual([1000]);
    expect(presetsFor(5600)).toEqual([1000, 2500, 5000]);
    expect(presetsFor(900)).toEqual([]);
  });

  it("starts on Fund the rest up to $25 left, otherwise on $25", () => {
    expect(defaultChoice(1400)).toEqual({ kind: "rest" });
    expect(defaultChoice(2500)).toEqual({ kind: "rest" });
    expect(defaultChoice(2501)).toEqual({ kind: "preset", cents: 2500 });
  });

  it("asks for exactly what's left with Fund the rest", () => {
    expect(resolveGift({ kind: "rest" }, "", 1400)).toEqual({ requestCents: 1400, displayCents: 1400 });
  });

  it("asks for the minimum when less than that is left, so the server clamps it to the remainder", () => {
    expect(resolveGift({ kind: "rest" }, "", 60)).toEqual({ requestCents: MIN_DONATION_CENTS, displayCents: 60 });
    expect(isOffered({ kind: "other" }, 60)).toBe(false);
    expect(isOffered({ kind: "preset", cents: 1000 }, 60)).toBe(false);
  });

  it("offers no Fund the rest above the per-checkout maximum", () => {
    expect(isOffered({ kind: "rest" }, MAX_DONATION_CENTS + 1)).toBe(false);
    expect(isOffered({ kind: "rest" }, MAX_DONATION_CENTS)).toBe(true);
  });

  it("resolves presets and valid Other amounts, and nothing for an invalid one", () => {
    expect(resolveGift({ kind: "preset", cents: 1000 }, "", 1400)).toEqual({ requestCents: 1000, displayCents: 1000 });
    expect(resolveGift({ kind: "preset", cents: 2500 }, "", 1400)).toBeNull();
    expect(resolveGift({ kind: "other" }, "7.25", 1400)).toEqual({ requestCents: 725, displayCents: 725 });
    expect(resolveGift({ kind: "other" }, "7.255", 1400)).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDeadline, formatNeededBy, formatShortDate, formatUsd, formatUsdShort, percentOf } from "@/lib/format";

describe("formatUsdShort", () => {
  it("drops .00 for whole dollars", () => {
    expect(formatUsdShort(1400)).toBe("$14");
    expect(formatUsdShort(0)).toBe("$0");
    expect(formatUsdShort(128_400)).toBe("$1,284");
  });

  it("keeps cents otherwise", () => {
    expect(formatUsdShort(1450)).toBe("$14.50");
    expect(formatUsdShort(1)).toBe("$0.01");
    expect(formatUsdShort(128_405)).toBe("$1,284.05");
  });

  it("matches formatUsd when there are cents", () => {
    expect(formatUsdShort(999)).toBe(formatUsd(999));
  });
});

describe("percentOf", () => {
  it("rounds and clamps to 0–100", () => {
    expect(percentOf(7000, 8400)).toBe(83);
    expect(percentOf(9000, 8400)).toBe(100);
    expect(percentOf(5, 0)).toBe(0);
  });
});

describe("dates", () => {
  // Pin the clock (Date only) so date text never depends on when the tests run.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T12:00:00.000Z")); // a Thursday
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats short dates in UTC", () => {
    expect(formatShortDate("2026-10-24T23:30:00.000Z")).toBe("Oct 24");
  });

  it("uses the weekday for deadlines in the next 6 days, else the date", () => {
    expect(formatDeadline("2026-10-30T21:00:00.000Z")).toBe("Fri");
    expect(formatDeadline("2026-11-14T21:00:00.000Z")).toBe("Nov 14");
    expect(formatDeadline("2026-10-20T21:00:00.000Z")).toBe("Oct 20");
  });

  it("hides deadlines that are missing or already passed", () => {
    expect(formatNeededBy("2026-10-30T21:00:00.000Z")).toBe("Fri");
    expect(formatNeededBy("2026-10-29T11:59:00.000Z")).toBeNull();
    expect(formatNeededBy(null)).toBeNull();
  });
});

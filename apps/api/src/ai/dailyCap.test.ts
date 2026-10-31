import { afterEach, describe, expect, it } from "vitest";
import { DAILY_CAPS, DailyCap, pacificDay, resetDailyCaps, takeDailyBudget } from "./dailyCap";
import { AI_RESTING } from "./models";

afterEach(() => resetDailyCaps());

describe("pacificDay", () => {
  it("uses the Pacific calendar day, not UTC", () => {
    // 2026-11-02 06:30 UTC is still Nov 1 in Los Angeles (UTC−8 after the DST change).
    expect(pacificDay(new Date("2026-11-02T06:30:00Z"))).toBe("2026-11-01");
    expect(pacificDay(new Date("2026-11-02T08:30:00Z"))).toBe("2026-11-02");
  });
});

describe("DailyCap", () => {
  it("allows max requests per Pacific day, then refuses, then resets the next day", () => {
    let now = new Date("2026-12-01T18:00:00Z");
    const cap = new DailyCap(3, () => now);
    expect([cap.take(), cap.take(), cap.take(), cap.take()]).toEqual([true, true, true, false]);
    expect(cap.remaining).toBe(0);
    now = new Date("2026-12-02T09:00:00Z"); // next Pacific day
    expect(cap.remaining).toBe(3);
    expect(cap.take()).toBe(true);
    expect(cap.remaining).toBe(2);
  });
});

describe("takeDailyBudget", () => {
  it("throws 503 UPSTREAM with the resting message once the feature's cap is used up", () => {
    for (let i = 0; i < DAILY_CAPS.match; i++) takeDailyBudget("match");
    let err: unknown;
    try {
      takeDailyBudget("match");
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ status: 503, code: "UPSTREAM", message: AI_RESTING });
    // Other features have their own counter.
    expect(() => takeDailyBudget("dashboard")).not.toThrow();
  });
});

import { ApiError, MatchRes, paths, type NeedCard } from "@needgrid/shared";
import { describe, expect, it } from "vitest";
import { MAX_MATCHES, matchReason, mockMatch, REASON_MAX, RESTING_MESSAGE } from "@/mocks/match";
import { MATCH_REQUESTS_PER_MINUTE, mockDb } from "@/mocks/mockDb";

const API = "http://api.test";

const titles = (res: MatchRes) => res.matches.map((m) => m.need.title);

async function post(body: unknown) {
  const res = await fetch(`${API}${paths.match}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as unknown };
}

describe("mock Match me rules (B §9.5)", () => {
  it("prefers needs the budget finishes (most similar first), then fills with the closest above it", () => {
    const res = mockMatch({ text: "diapers and food for families", budgetCents: 2500 });
    expect(titles(res)).toEqual(["Diapers, size 4", "Canned tuna, 5 oz", "Canned chicken, 12.5 oz"]);
    expect(res.matches.map((m) => m.reason)).toEqual([
      "Your $25 covers the last of Diapers, size 4 at Harbor Food Bank",
      "Your $25 covers the last of Canned tuna, 5 oz at Harbor Food Bank",
      "Your $25 goes toward Canned chicken, 12.5 oz at Harbor Food Bank",
    ]);
  });

  it("fills with needs above the budget, closest remaining first among equally similar ones", () => {
    const res = mockMatch({ text: "food", budgetCents: 2500 });
    // Only the tuna ($5 more) fits $25; the chicken ($26 left) is closer than the puppy food ($27 left).
    expect(titles(res)).toEqual(["Canned tuna, 5 oz", "Canned chicken, 12.5 oz", "Puppy food, 30 lb bag"]);
    expect(res.matches[0]?.need.remainingCents).toBeLessThanOrEqual(2500);
    expect(res.matches.slice(1).every((m) => m.need.remainingCents > 2500)).toBe(true);
    expect(res.matches[1]?.reason).toBe("Your $25 goes toward Canned chicken, 12.5 oz at Harbor Food Bank");
  });

  it("among needs that fit, ties go to the most urgent", () => {
    const res = mockMatch({ text: "food", budgetCents: 3000 });
    expect(titles(res)).toEqual(["Puppy food, 30 lb bag", "Canned chicken, 12.5 oz", "Canned tuna, 5 oz"]);
  });

  it("only suggests needs taking donations with something left, at most 3, valid MatchRes", () => {
    for (const text of ["diapers", "winter coats for kids", "puppy food and cat litter", "school pencils markers"]) {
      const res = MatchRes.parse(mockMatch({ text, budgetCents: 2500 }));
      expect(res.matches.length).toBeLessThanOrEqual(MAX_MATCHES);
      for (const { need } of res.matches) {
        expect(["open", "topping_up"]).toContain(need.status);
        expect(need.remainingCents).toBeGreaterThan(0);
      }
    }
    // Delivered diapers (size 3) never show; the markers are fully held by a sponsor invoice.
    expect(titles(mockMatch({ text: "diapers", budgetCents: 2500 }))).not.toContain("Diapers, size 3");
    expect(mockMatch({ text: "dry-erase markers", budgetCents: 2500 }).matches).toEqual([]);
  });

  it("nothing in common → no matches", () => {
    expect(mockMatch({ text: "spaceship parts", budgetCents: 5000 }).matches).toEqual([]);
  });

  it("every reason is at most 90 characters, even for long titles and names", () => {
    for (const text of ["diapers for babies", "kids winter coats", "pet food", "school supplies"]) {
      for (const { reason } of mockMatch({ text, budgetCents: 1000 }).matches) {
        expect(reason.length).toBeLessThanOrEqual(REASON_MAX);
      }
    }
    const [first] = mockDb.matchCandidates();
    if (!first) throw new Error("expected a candidate");
    const long: NeedCard = { ...first.need, title: "Extra-large heavy-duty weatherproof winter parka ".repeat(3) };
    const reason = matchReason(long, "A Charity With A Remarkably Long Name Indeed", 2500);
    expect(reason.length).toBeLessThanOrEqual(REASON_MAX);
    expect(reason.endsWith("…")).toBe(true);
  });
});

describe("mock POST /api/match", () => {
  it("answers a valid MatchReq with MatchRes", async () => {
    const res = await post({ text: "diapers and food for families", budgetCents: 2500 });
    expect(res.status).toBe(200);
    expect(MatchRes.parse(res.json).matches).toHaveLength(3);
  });

  it("400 VALIDATION for anything that isn't MatchReq", async () => {
    for (const body of [
      { text: "hi", budgetCents: 2500 },
      { text: "x".repeat(301), budgetCents: 2500 },
      { text: "diapers", budgetCents: 50 },
      { text: "diapers", budgetCents: 100_001 },
      { text: "diapers" },
    ]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(ApiError.parse(res.json).error.code).toBe("VALIDATION");
    }
  });

  it("429 after 10 requests a minute, and fine again a minute later", async () => {
    for (let i = 0; i < MATCH_REQUESTS_PER_MINUTE; i += 1) {
      expect((await post({ text: "diapers", budgetCents: 2500 })).status).toBe(200);
    }
    const limited = await post({ text: "diapers", budgetCents: 2500 });
    expect(limited.status).toBe(429);
    expect(ApiError.parse(limited.json).error.code).toBe("RATE_LIMITED");
    expect(mockDb.takeMatchRequest(Date.now() + 60_001)).toBe(true);
  });

  it("?mock=matchResting answers once like B's free-tier guard: 503 UPSTREAM, 'The AI is resting…'", async () => {
    mockDb.armScenario("matchResting");
    const resting = await post({ text: "diapers", budgetCents: 2500 });
    expect(resting.status).toBe(503);
    expect(ApiError.parse(resting.json).error).toMatchObject({ code: "UPSTREAM", message: RESTING_MESSAGE });
    expect((await post({ text: "diapers", budgetCents: 2500 })).status).toBe(200);
  });
});

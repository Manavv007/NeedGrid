import { ApiError, MatchRes, type NeedCard } from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { setNeedEmbedding } from "../core";
import { closeDb } from "../db/client";
import { createTestDb, hasTestDb, migrateTestDb, truncateAll, type TestDb } from "../test/db";
import { demoProduct, nextIp, seedNeed, seedOrg } from "../test/fixtures";
import { scriptedModel } from "./__fakes__";
import { DAILY_CAPS, resetDailyCaps, takeDailyBudget } from "./dailyCap";
import { EMBEDDING_DIMENSIONS } from "./embeddings";
import {
  dbMatchDeps,
  keywordRank,
  matchNeeds,
  pickMatches,
  plainReason,
  rankCandidates,
  usdShort,
  type MatchDeps,
} from "./match";
import { setAiModels } from "./models";

const ORG = "6f1c1d1e-2b3c-4d5e-8f90-0000000000aa";
const id = (n: number) => `6f1c1d1e-2b3c-4d5e-8f90-${String(n).padStart(12, "0")}`;
const card = (n: number, title: string, remainingCents: number, over: Partial<NeedCard> = {}): NeedCard => ({
  id: id(n),
  orgId: ORG,
  orgSlug: "harbor-food-bank",
  title,
  description: "",
  category: "baby",
  urgency: 2,
  quantity: 1,
  unit: "pack",
  status: "open",
  targetCents: remainingCents + 1000,
  fundedCents: 1000,
  heldCents: 0,
  remainingCents,
  donorCount: 1,
  product: demoProduct(),
  deadlineAt: null,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
  ...over,
});

const diapers = card(1, "Diapers, size 4", 1400, { urgency: 3 });
const wipes = card(2, "Baby wipes", 2500);
const formula = card(3, "Infant formula", 9000, { urgency: 3 });
const crayons = card(4, "Crayons, 24 pack", 800, { category: "school" });
const funded = card(5, "Baby wash", 0, { status: "funded" });

function fakeDeps(over: Partial<MatchDeps> = {}): MatchDeps & { calls: string[] } {
  const all = [diapers, wipes, formula, crayons, funded];
  const calls: string[] = [];
  return {
    calls,
    embedQuery: async () => (calls.push("embed"), [1, 0]),
    nearest: async () => [
      { id: wipes.id, distance: 0.1 },
      { id: diapers.id, distance: 0.11 },
      { id: funded.id, distance: 0.12 },
      { id: formula.id, distance: 0.2 },
      { id: crayons.id, distance: 0.6 },
    ],
    donatable: async () => (calls.push("donatable"), [diapers, formula, wipes, crayons]),
    needCards: async (ids) => ids.flatMap((i) => all.filter((n) => n.id === i)),
    orgNames: async () => new Map([[ORG, "Harbor Food Bank"]]),
    ...over,
  };
}

afterEach(() => {
  setAiModels(null);
  resetDailyCaps();
});

describe("ranking", () => {
  it("similarity first, urgency breaks near-ties (weight per urgency level)", () => {
    const ranked = rankCandidates([
      { need: wipes, similarity: 0.9 }, // urgency 2: 0.92
      { need: diapers, similarity: 0.895 }, // urgency 3: 0.935
      { need: formula, similarity: 0.7 }, // urgency 3, but much further away
    ]);
    expect(ranked.map((c) => c.need.title)).toEqual(["Diapers, size 4", "Baby wipes", "Infant formula"]);
  });

  it("gifts that finish a need first; partial gifts only fill up to 3", () => {
    const picks = pickMatches(
      [formula, diapers, crayons].map((need) => ({ need, similarity: 0.8 })),
      2500,
    );
    expect(picks.map((p) => [p.need.title, p.partial, p.giftCents])).toEqual([
      ["Diapers, size 4", false, 1400],
      ["Crayons, 24 pack", false, 800],
      ["Infant formula", true, 2500],
    ]);
  });

  it("relevant needs first: a gift that fits a far-off need doesn't beat the close matches", () => {
    const coats = card(10, "Winter coats, size 8", 11100, { category: "clothing" });
    const glue = card(11, "Glue sticks", 2900, { category: "school" });
    const picks = pickMatches(
      [
        { need: coats, similarity: 0.75 },
        { need: glue, similarity: 0.61 },
      ],
      3000,
    );
    expect(picks.map((p) => [p.need.title, p.partial])).toEqual([
      ["Winter coats, size 8", true],
      ["Glue sticks", false],
    ]);
  });

  it("keyword fallback: more shared words first, otherwise the given (most urgent) order", () => {
    expect(
      keywordRank([formula, wipes, diapers], "I'd like to buy diapers for babies").map((c) => c.need.title),
    ).toEqual(["Diapers, size 4", "Infant formula", "Baby wipes"]);
  });

  it("plain reasons", () => {
    expect(usdShort(2500)).toBe("$25");
    expect(usdShort(1450)).toBe("$14.50");
    const [p] = pickMatches([{ need: diapers, similarity: 1 }], 2500);
    expect(plainReason(p!, "Harbor Food Bank")).toBe("Your $14 covers the last of Diapers, size 4 at Harbor Food Bank");
    const [q] = pickMatches([{ need: formula, similarity: 1 }], 2500);
    expect(plainReason(q!, "Harbor Food Bank")).toBe("Your $25 goes toward Infant formula at Harbor Food Bank");
  });
});

describe("matchNeeds", () => {
  it("vector path: skips non-donatable needs, picks 3, plain reasons without an AI key", async () => {
    const deps = fakeDeps();
    const res = MatchRes.parse(await matchNeeds({ text: "babies", budgetCents: 2500 }, deps));
    expect(res.matches.map((m) => m.need.title)).toEqual(["Diapers, size 4", "Baby wipes", "Crayons, 24 pack"]);
    expect(res.matches[0]).toMatchObject({
      orgName: "Harbor Food Bank",
      reason: "Your $14 covers the last of Diapers, size 4 at Harbor Food Bank",
    });
    expect(deps.calls).toEqual(["embed"]);
  });

  it("no embedding (no key / quota) → keyword + urgency fallback", async () => {
    const deps = fakeDeps({ embedQuery: async () => null });
    const res = await matchNeeds({ text: "school supplies like crayons", budgetCents: 1000 }, deps);
    expect(res.matches.map((m) => m.need.title)).toEqual(["Crayons, 24 pack", "Diapers, size 4", "Infant formula"]);
    expect(res.matches.map((m) => m.reason.startsWith("Your $10 goes toward") || m.reason.includes("covers"))).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("uses the model's reasons, unless one invents or misquotes an amount, overclaims or is too long", async () => {
    const model = scriptedModel(() => ({
      reasons: [
        { index: 0, reason: "Your $14 finishes the size 4 diapers families asked for!" },
        { index: 1, reason: "Your $50 buys wipes for a month" },
        { index: 2, reason: "x".repeat(120) },
      ],
    }));
    setAiModels({ language: model });
    const res = await matchNeeds({ text: "babies", budgetCents: 2500 }, fakeDeps());
    expect(res.matches.map((m) => m.reason)).toEqual([
      "Your $14 finishes the size 4 diapers families asked for.",
      "Your $25 covers the last of Baby wipes at Harbor Food Bank",
      "Your $8 covers the last of Crayons, 24 pack at Harbor Food Bank",
    ]);
    expect(model.calls[0]!.promptJson).toContain("<untrusted_donor_text>");

    // The budget isn't what a finished need takes; a partial gift can't "finish" anything.
    setAiModels({
      language: scriptedModel(() => ({
        reasons: [
          { index: 0, reason: "Your $25 gift finishes the size 4 diapers" },
          { index: 1, reason: "Your $25 finishes the wipes" },
          { index: 2, reason: "Your $25 completes the formula" },
        ],
      })),
    });
    const strict = await matchNeeds(
      { text: "babies", budgetCents: 2500 },
      fakeDeps({
        nearest: async () => [
          { id: diapers.id, distance: 0.1 },
          { id: wipes.id, distance: 0.1 },
          { id: formula.id, distance: 0.1 },
        ],
      }),
    );
    expect(strict.matches.map((m) => m.reason)).toEqual([
      "Your $14 covers the last of Diapers, size 4 at Harbor Food Bank",
      "Your $25 finishes the wipes",
      "Your $25 goes toward Infant formula at Harbor Food Bank",
    ]);
  });

  it("a failing reasons call keeps the plain reasons", async () => {
    setAiModels({
      language: scriptedModel(() => {
        throw new Error("model exploded");
      }),
    });
    const res = await matchNeeds({ text: "babies", budgetCents: 2500 }, fakeDeps());
    expect(res.matches[0]!.reason).toBe("Your $14 covers the last of Diapers, size 4 at Harbor Food Bank");
  });
});

describe("POST /api/match", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  const post = (body: unknown) =>
    app.inject({
      method: "POST",
      url: "/api/match",
      headers: { "x-forwarded-for": nextIp(), "content-type": "application/json" },
      payload: JSON.stringify(body),
    });

  it("400 for a bad body; 503 'resting' once today's cap is used (before any DB or model work)", async () => {
    expect((await post({ text: "hi", budgetCents: 2500 })).statusCode).toBe(400);
    expect((await post({ text: "babies", budgetCents: 50 })).statusCode).toBe(400);
    for (let i = 0; i < DAILY_CAPS.match; i++) takeDailyBudget("match");
    const res = await post({ text: "babies", budgetCents: 2500 });
    expect(res.statusCode).toBe(503);
    expect(ApiError.parse(res.json()).error.message).toBe("The AI is resting, try again tomorrow");
  });
});

describe.skipIf(!hasTestDb)("dbMatchDeps.nearest (pgvector, TEST_DATABASE_URL)", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = createTestDb();
    await migrateTestDb(t);
  });
  beforeEach(async () => {
    await truncateAll(t);
  });
  afterAll(async () => {
    await t?.pool.end();
    await closeDb();
  });

  const axis = (i: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, k) => (k === i ? 1 : 0));
  const mix = (a: number, b: number, wa: number) => {
    const v = axis(a).map((x, k) => x * wa + axis(b)[k]! * (1 - wa));
    const n = Math.hypot(...v);
    return v.map((x) => x / n);
  };

  it("orders donatable needs with an embedding by cosine distance; skips funded, drafts and needs without one", async () => {
    const org = await seedOrg(t);
    const near = await seedNeed(t, org.id, { title: "Diapers", targetCents: 5000 });
    const mid = await seedNeed(t, org.id, { title: "Wipes", targetCents: 5000, status: "topping_up" });
    const fundedNeed = await seedNeed(t, org.id, {
      title: "Formula",
      targetCents: 5000,
      fundedCents: 5000,
      status: "funded",
    });
    const draft = await seedNeed(t, org.id, { title: "Draft", targetCents: 5000, status: "draft" });
    await seedNeed(t, org.id, { title: "No embedding", targetCents: 5000 });
    await setNeedEmbedding(near.id, mix(0, 1, 0.95));
    await setNeedEmbedding(mid.id, mix(0, 1, 0.5));
    await setNeedEmbedding(fundedNeed.id, axis(0));
    await setNeedEmbedding(draft.id, axis(0));

    const rows = await dbMatchDeps.nearest(axis(0), 10);
    expect(rows.map((r) => r.id)).toEqual([near.id, mid.id]);
    expect(rows[0]!.distance).toBeLessThan(rows[1]!.distance);
    expect(rows[0]!.distance).toBeGreaterThanOrEqual(0);

    // End to end with the real DB reads (no AI key: plain reasons).
    const res = await matchNeeds(
      { text: "diapers", budgetCents: 10_000 },
      { ...dbMatchDeps, embedQuery: async () => axis(0) },
    );
    expect(res.matches.map((m) => [m.need.title, m.orgName])).toEqual([
      ["Diapers", "Org harbor-food-bank"],
      ["Wipes", "Org harbor-food-bank"],
    ]);
  });
});

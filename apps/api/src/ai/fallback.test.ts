import { APICallError, generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it } from "vitest";
import {
  AI_BUSY_MINUTE,
  AI_RESTING,
  callModel,
  googleOptions,
  modelChainIds,
  msUntilPacificMidnight,
  quotaKind,
  setAiModels,
} from "./models";

afterEach(() => setAiModels(null));

const quota429 = (daily: boolean) =>
  new APICallError({
    message: "You exceeded your current quota",
    url: "https://generativelanguage.googleapis.com",
    requestBodyValues: {},
    statusCode: 429,
    responseBody: daily
      ? '{"error":{"details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}}'
      : '{"error":{"details":[{"violations":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]}]}}',
  });
const server500 = () =>
  new APICallError({ message: "internal", url: "https://x", requestBodyValues: {}, statusCode: 500 });

/** A mock model that throws `fail()` while it returns an error, else answers `id`. `.count.n` counts calls. */
function model(id: string, fail: () => Error | null = () => null) {
  const count = { n: 0 };
  const m = new MockLanguageModelV4({
    modelId: id,
    doGenerate: async () => {
      count.n++;
      const e = fail();
      if (e) throw e;
      return {
        content: [{ type: "text", text: id }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return Object.assign(m, { count });
}

const ask = () =>
  callModel(
    async ({ model, signal, providerOptions }) =>
      (await generateText({ model, prompt: "hi", maxRetries: 0, abortSignal: signal, providerOptions })).text,
    { label: "test", thinkingBudget: 0, baseDelayMs: 0 },
  );

describe("callModel fallback chain", () => {
  it("uses the primary model when it works", async () => {
    const a = model("a");
    const b = model("b");
    setAiModels({ language: [a, b] });
    expect(await ask()).toBe("a");
    expect([a.count.n, b.count.n]).toEqual([1, 0]);
  });

  it("a daily-quota 429 moves straight to the next model, and the exhausted one is skipped afterwards", async () => {
    const a = model("a", () => quota429(true));
    const b = model("b");
    setAiModels({ language: [a, b] });
    expect(await ask()).toBe("b");
    expect(await ask()).toBe("b");
    expect([a.count.n, b.count.n]).toEqual([1, 2]); // a was tried once, then skipped
  });

  it("5xx is retried on the same model, then the next model is tried", async () => {
    const a = model("a", () => server500());
    const b = model("b");
    setAiModels({ language: [a, b] });
    expect(await ask()).toBe("b");
    expect(a.count.n).toBe(2);
  });

  it("every model out of daily quota → 503 'resting, try again tomorrow'", async () => {
    setAiModels({ language: [model("a", () => quota429(true)), model("b", () => quota429(true))] });
    await expect(ask()).rejects.toMatchObject({ status: 503, code: "UPSTREAM", message: AI_RESTING });
    // Already-exhausted models aren't called again: same answer, no new requests.
    await expect(ask()).rejects.toMatchObject({ status: 503, message: AI_RESTING });
  });

  it("every model out of per-minute quota → 503 'try again in a minute'", async () => {
    setAiModels({ language: [model("a", () => quota429(false))] });
    await expect(ask()).rejects.toMatchObject({ status: 503, message: AI_BUSY_MINUTE });
  });

  it("a non-retryable error fails at once with 502, without trying other models", async () => {
    const b = model("b");
    setAiModels({ language: [model("a", () => new Error("bad output")), b] });
    await expect(ask()).rejects.toMatchObject({ status: 502, code: "UPSTREAM" });
    expect(b.count.n).toBe(0);
  });
});

describe("helpers", () => {
  it("quotaKind tells daily from per-minute 429s and ignores other errors", () => {
    expect(quotaKind(quota429(true))).toBe("daily");
    expect(quotaKind(quota429(false))).toBe("minute");
    expect(quotaKind(server500())).toBeNull();
    expect(quotaKind(new Error("x"))).toBeNull();
  });

  it("the chain starts with GEMINI_MODEL and has no duplicates", () => {
    expect(modelChainIds("gemini-2.5-flash-lite")).toEqual([
      "gemini-2.5-flash-lite",
      "gemini-2.5-flash",
      "gemini-3-flash-preview",
    ]);
    expect(modelChainIds("gemini-2.5-flash")[0]).toBe("gemini-2.5-flash");
    expect(new Set(modelChainIds("gemini-2.5-flash")).size).toBe(3);
  });

  it("Gemini 3 gets a thinking level, 2.5 models a token budget", () => {
    expect(googleOptions(0, "gemini-3-flash-preview")).toEqual({
      google: { thinkingConfig: { thinkingLevel: "minimal" } },
    });
    expect(googleOptions(1024, "gemini-3-flash-preview")).toEqual({
      google: { thinkingConfig: { thinkingLevel: "low" } },
    });
    expect(googleOptions(1024, "gemini-2.5-flash-lite")).toEqual({
      google: { thinkingConfig: { thinkingBudget: 1024 } },
    });
  });

  it("msUntilPacificMidnight counts to the next Los Angeles midnight", () => {
    // 2026-12-01 20:00 UTC = 12:00 noon PST → 12 h to midnight.
    expect(msUntilPacificMidnight(new Date("2026-12-01T20:00:00Z"))).toBe(12 * 3_600_000);
  });
});

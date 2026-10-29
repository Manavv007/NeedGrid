import { MockEmbeddingModelV4 } from "ai/test";
import { afterEach, describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS as DB_DIMENSIONS } from "../db/schema";
import { cleanForEmbedding, EMBEDDING_DIMENSIONS, embedText, normalizeVector } from "./embeddings";
import { embedNeedText } from "./index";
import { setAiModels } from "./models";

afterEach(() => setAiModels(null));

const need = { title: "Diapers, size 4", description: "For infants", category: "baby" as const, unit: "pack of 150" };

/** A mock embedding model returning `vector` for every value; records what the SDK sent. */
function mockEmbedding(vector: number[] | (() => number[])) {
  return new MockEmbeddingModelV4({
    maxEmbeddingsPerCall: 100,
    supportsParallelCalls: true,
    doEmbed: async ({ values }) => ({
      embeddings: values.map(() => (typeof vector === "function" ? vector() : vector)),
      usage: { tokens: 5 },
      warnings: [],
    }),
  });
}

const vec = (n: number, fill = 0.5) => Array.from({ length: n }, () => fill);
const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

it("matches the database column size", () => {
  expect(EMBEDDING_DIMENSIONS).toBe(DB_DIMENSIONS);
});

describe("embedNeedText", () => {
  it("returns a 768-dimension unit vector and asks Google for exactly that", async () => {
    const model = mockEmbedding(vec(768, 3));
    setAiModels({ embedding: model });
    const out = await embedNeedText(need);
    expect(out).toHaveLength(768);
    expect(norm(out!)).toBeCloseTo(1, 6);
    expect(model.doEmbedCalls).toHaveLength(1);
    expect(model.doEmbedCalls[0]!.values).toEqual(["Diapers, size 4. pack of 150. Category: baby. For infants"]);
    expect(model.doEmbedCalls[0]!.providerOptions).toEqual({
      google: { outputDimensionality: 768, taskType: "RETRIEVAL_DOCUMENT" },
    });
  });

  it("returns null (never throws) when the provider fails", async () => {
    setAiModels({
      embedding: new MockEmbeddingModelV4({
        maxEmbeddingsPerCall: 100,
        doEmbed: async () => {
          throw new Error("provider exploded");
        },
      }),
    });
    await expect(embedNeedText(need)).resolves.toBeNull();
  });

  it("returns null for a wrong-sized vector (it would break the vector(768) column)", async () => {
    setAiModels({ embedding: mockEmbedding(vec(3072)) });
    await expect(embedNeedText(need)).resolves.toBeNull();
  });

  it("returns null for a zero or non-finite vector", async () => {
    setAiModels({ embedding: mockEmbedding(vec(768, 0)) });
    await expect(embedNeedText(need)).resolves.toBeNull();
    setAiModels({ embedding: mockEmbedding(() => [...vec(767), Number.NaN]) });
    await expect(embedNeedText(need)).resolves.toBeNull();
  });

  it("returns null when AI isn't configured (tests have no Gemini key)", async () => {
    await expect(embedNeedText(need)).resolves.toBeNull();
  });

  it("cleans control characters and caps the text it sends", async () => {
    const model = mockEmbedding(vec(768));
    setAiModels({ embedding: model });
    await embedNeedText({ ...need, description: `line1\u0000\n\n  line2 ${"x".repeat(5000)}` });
    const sent = model.doEmbedCalls[0]!.values[0] as string;
    expect(sent.length).toBe(2000);
    expect([...sent].some((ch) => ch.charCodeAt(0) < 32)).toBe(false);
    expect(sent).toContain("line1 line2");
  });
});

describe("embedText", () => {
  it("uses the query task for donor text", async () => {
    const model = mockEmbedding(vec(768));
    setAiModels({ embedding: model });
    await embedText("keep kids warm", "RETRIEVAL_QUERY");
    expect(model.doEmbedCalls[0]!.providerOptions).toEqual({
      google: { outputDimensionality: 768, taskType: "RETRIEVAL_QUERY" },
    });
  });

  it("rejects empty text before calling the provider", async () => {
    const model = mockEmbedding(vec(768));
    setAiModels({ embedding: model });
    await expect(embedText(" \u0000 ", "RETRIEVAL_QUERY")).rejects.toThrow("nothing to embed");
    expect(model.doEmbedCalls).toHaveLength(0);
  });
});

describe("helpers", () => {
  it("normalizeVector scales to length 1 and rejects bad input", () => {
    expect(normalizeVector([3, 4])).toEqual([0.6, 0.8]);
    expect(normalizeVector([0, 0])).toBeNull();
    expect(normalizeVector([1, Number.POSITIVE_INFINITY])).toBeNull();
  });
  it("cleanForEmbedding collapses whitespace", () => {
    expect(cleanForEmbedding("  a\t\n b  ")).toBe("a b");
  });
});

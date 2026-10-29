/**
 * Text embeddings for Match me (AGENT_B_AI_DATA.md §9.5). 768 dimensions to match the `needs.embedding vector(768)` column.
 *
 * Google only returns unit-length vectors at the default size; for 768 dimensions we normalise ourselves
 * (cosine distance doesn't need it, but it keeps dot-product comparisons correct too).
 * This file must not import from ../core (core/needs.ts imports ai/index.ts → import cycle).
 */
import { embed } from "ai";
import { embeddingModel, withRetry } from "./models";
import { stripControlChars } from "./untrusted";

/** Must equal EMBEDDING_DIMENSIONS in db/schema.ts (checked by a test). */
export const EMBEDDING_DIMENSIONS = 768;
const MAX_CHARS = 2000;
/**
 * Publishing a need awaits its embedding, so keep the worst case short: 2 attempts × 8 s,
 * not the 3 × 25 s used for chat-sized calls.
 */
const EMBED_RETRY = { attempts: 2, timeoutMs: 8_000, label: "embedding" } as const;

/** "document" = a need being stored; "query" = what a donor typed (Match me). */
export type EmbeddingTask = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

/** Scales to length 1. null for a zero or non-finite vector. */
export function normalizeVector(v: readonly number[]): number[] | null {
  let sum = 0;
  for (const x of v) {
    if (!Number.isFinite(x)) return null;
    sum += x * x;
  }
  const norm = Math.sqrt(sum);
  return norm > 0 ? v.map((x) => x / norm) : null;
}

/** Control characters out, whitespace collapsed, capped. */
export function cleanForEmbedding(text: string): string {
  return stripControlChars(text).replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
}

/**
 * One 768-dimension unit vector. Throws HttpError (503 not configured, 502 provider failure) or Error
 * if the provider returns the wrong size. Callers that must not fail wrap this (see embedNeedText).
 */
export async function embedText(text: string, task: EmbeddingTask): Promise<number[]> {
  const value = cleanForEmbedding(text);
  if (value.length === 0) throw new Error("nothing to embed");
  const { embedding } = await withRetry(
    (signal) =>
      embed({
        model: embeddingModel(),
        value,
        maxRetries: 0,
        abortSignal: signal,
        providerOptions: { google: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType: task } },
      }),
    EMBED_RETRY,
  );
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`embedding has ${embedding.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`);
  }
  const unit = normalizeVector(embedding);
  if (!unit) throw new Error("embedding is empty or not finite");
  return unit;
}

/**
 * Gemini handles, retry/backoff, timeouts and the AI result cache (AGENT_B_AI_DATA.md §8).
 *
 * AI SDK v7 facts (checked against the installed package + its docs):
 * - structured output: `generateText({ output: Output.object({ schema }) })` → `result.output`
 *   (generateObject is deprecated); the system prompt option is `instructions` (`system` is deprecated).
 * - Gemini provider: `createGoogle({ apiKey })`; embeddings via `.embeddingModel(id)` with
 *   `providerOptions.google.outputDimensionality`.
 *
 * Tests swap the models with setAiModels() (MockLanguageModelV4 / MockEmbeddingModelV4 from "ai/test").
 * This file must not import from ../core (core/needs.ts imports ai/index.ts → import cycle).
 */
import { createHash } from "node:crypto";
import { createGoogle } from "@ai-sdk/google";
import { APICallError, type EmbeddingModel, type LanguageModel } from "ai";
import { TtlCache } from "../channel3/client";
import { env } from "../env";
import { HttpError } from "../lib/http";

export const AI_NOT_CONFIGURED = "AI is not configured";
const CALL_TIMEOUT_MS = 25_000;

interface Models {
  language: LanguageModel;
  embedding: EmbeddingModel;
}

let override: Partial<Models> | null = null;
let real: Models | null = null;

function realModels(): Models {
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY) throw new HttpError(503, "UPSTREAM", AI_NOT_CONFIGURED);
  if (!real) {
    const google = createGoogle({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY });
    real = { language: google(env.GEMINI_MODEL), embedding: google.embeddingModel(env.GEMINI_EMBEDDING_MODEL) };
  }
  return real;
}

/** Vision-capable Flash model used for every text/vision feature. 503 UPSTREAM when the key is missing. */
export function languageModel(): LanguageModel {
  return override?.language ?? realModels().language;
}

export function embeddingModel(): EmbeddingModel {
  return override?.embedding ?? realModels().embedding;
}

export const isAiConfigured = (): boolean => Boolean(override?.language) || Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY);

/** Tests: swap in mock models (null restores Gemini). Also clears the result cache. */
export function setAiModels(models: Partial<Models> | null): void {
  override = models;
  aiCache.clear();
}

/** Model id for cache keys (so changing GEMINI_MODEL never serves stale results). */
export function modelId(): string {
  const m = override?.language ?? null;
  if (m && typeof m === "object" && "modelId" in m) return `mock:${String(m.modelId)}`;
  return env.GEMINI_MODEL;
}

/** Gemini provider options. Thinking costs latency; extraction gets a little, ranking/notes none. */
export function googleOptions(thinkingBudget: number) {
  return { google: { thinkingConfig: { thinkingBudget } } };
}

// ---------------------------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------------------------

function isRetryable(err: unknown): boolean {
  if (APICallError.isInstance(err)) {
    const s = err.statusCode;
    return err.isRetryable || s === 429 || (s !== undefined && s >= 500);
  }
  const name = (err as Error)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RetryOptions {
  attempts?: number;
  timeoutMs?: number;
  /** Test hook: 0 disables backoff waits. */
  baseDelayMs?: number;
  /** What the failure log line calls this call. */
  label?: string;
}

/**
 * 3 attempts on 429/5xx/timeouts, 500 ms × 2ⁿ + jitter, 25 s per attempt (passed to fn as an AbortSignal).
 * Non-retryable errors (e.g. the model's JSON didn't match the schema) fail at once.
 * Final failure → HttpError(502, "UPSTREAM", "The AI service is busy, try again"). HttpErrors pass through.
 */
export async function withRetry<T>(fn: (signal: AbortSignal) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 500;
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(AbortSignal.timeout(opts.timeoutMs ?? CALL_TIMEOUT_MS));
    } catch (err) {
      if (err instanceof HttpError) throw err;
      last = err;
      if (!isRetryable(err) || i === attempts - 1) break;
      await sleep(base * 2 ** i + Math.random() * base);
    }
  }
  // Never log prompts or model output (may contain user data); status + message only.
  const status = APICallError.isInstance(last) ? last.statusCode : undefined;
  console.error(`[ai] ${opts.label ?? "call"} failed`, { status, message: (last as Error)?.message?.slice(0, 300) });
  throw new HttpError(502, "UPSTREAM", "The AI service is busy, try again");
}

// ---------------------------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------------------------

/** 500 entries, 24 h. Same photo/text → instant second intake (demo safety). Failures are not cached. */
const aiCache = new TtlCache<unknown>(500, 24 * 60 * 60 * 1000);

export function cacheKey(feature: string, input: unknown): string {
  return createHash("sha256")
    .update(`${feature}\u0000${modelId()}\u0000${JSON.stringify(input)}`)
    .digest("hex");
}

export function cached<T>(feature: string, input: unknown, load: () => Promise<T>): Promise<T> {
  return aiCache.getOrLoad(cacheKey(feature, input), load) as Promise<T>;
}

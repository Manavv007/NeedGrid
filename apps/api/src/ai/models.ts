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
/** Same wording as the public daily caps (ai/dailyCap.ts), so the UI shows one message for "out of AI for today". */
export const AI_RESTING = "The AI is resting, try again tomorrow";
export const AI_BUSY_MINUTE = "The AI is busy, try again in a minute";
const CALL_TIMEOUT_MS = 25_000;

/**
 * Free tier only (team decision, HANDOFF 2026-10-30): every Gemini model has its own small daily request
 * allowance on the same key, so on a quota 429 we move to the next model instead of failing. Order after
 * GEMINI_MODEL: cheapest/most generous first. All three accept images and structured output.
 * (`gemini-flash-latest` was left out: slower than our 25 s timeout on a photo, Oct 29.)
 */
export const FALLBACK_MODEL_IDS = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-3-flash-preview"] as const;

/** GEMINI_MODEL first, then the fallbacks, without duplicates. */
export function modelChainIds(primary: string = env.GEMINI_MODEL): string[] {
  return [...new Set([primary, ...FALLBACK_MODEL_IDS])];
}

interface Models {
  /** One model, or a fallback chain (tests). */
  language: LanguageModel | LanguageModel[];
  embedding: EmbeddingModel;
}

let override: Partial<Models> | null = null;
let real: { language: LanguageModel[]; embedding: EmbeddingModel } | null = null;

function realModels() {
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY) throw new HttpError(503, "UPSTREAM", AI_NOT_CONFIGURED);
  if (!real) {
    const google = createGoogle({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY });
    real = {
      language: modelChainIds().map((id) => google(id)),
      embedding: google.embeddingModel(env.GEMINI_EMBEDDING_MODEL),
    };
  }
  return real;
}

/** The language-model fallback chain, primary first. 503 UPSTREAM when the key is missing. */
export function languageModels(): LanguageModel[] {
  const o = override?.language;
  if (o) return Array.isArray(o) ? o : [o];
  return realModels().language;
}

/** The primary model (first in the chain). Prefer callModel(), which falls back on quota errors. */
export function languageModel(): LanguageModel {
  return languageModels()[0]!;
}

export function embeddingModel(): EmbeddingModel {
  return override?.embedding ?? realModels().embedding;
}

export const isAiConfigured = (): boolean => Boolean(override?.language) || Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY);

export const isEmbeddingConfigured = (): boolean =>
  Boolean(override?.embedding) || Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY);

/** Tests: swap in mock models (null restores Gemini). Also clears the result cache and model cooldowns. */
export function setAiModels(models: Partial<Models> | null): void {
  override = models;
  aiCache.clear();
  cooldownUntil.clear();
}

const idOf = (m: LanguageModel): string => (typeof m === "string" ? m : m.modelId);

/** Model id for cache keys: the PRIMARY model, so a result is reused whichever fallback produced it. */
export function modelId(): string {
  const o = override?.language;
  if (o) return `mock:${idOf(Array.isArray(o) ? o[0]! : o)}`;
  return env.GEMINI_MODEL;
}

/**
 * Gemini provider options. Thinking costs latency and counts against quota: extraction gets a little,
 * ranking/notes none. Gemini 3 models take a thinking *level* instead of a token budget.
 */
export function googleOptions(thinkingBudget: number, model: string = env.GEMINI_MODEL) {
  if (model.startsWith("gemini-3")) {
    return {
      google: { thinkingConfig: { thinkingLevel: thinkingBudget === 0 ? ("minimal" as const) : ("low" as const) } },
    };
  }
  return { google: { thinkingConfig: { thinkingBudget } } };
}

// ---------------------------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------------------------

/** generateText may wrap the provider error in a RetryError; look inside it. */
function unwrap(err: unknown): unknown {
  const e = err as { name?: string; lastError?: unknown };
  return e?.name === "AI_RetryError" && e.lastError !== undefined ? e.lastError : err;
}

function isRetryable(err: unknown): boolean {
  err = unwrap(err);
  if (APICallError.isInstance(err)) {
    const s = err.statusCode;
    return err.isRetryable || s === 429 || (s !== undefined && s >= 500);
  }
  const name = (err as Error)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/** A 429 from Google = this model's quota (per minute or per day) is used up on our key. */
export function quotaKind(err: unknown): "daily" | "minute" | null {
  err = unwrap(err);
  if (!APICallError.isInstance(err) || err.statusCode !== 429) return null;
  const text = `${err.responseBody ?? ""} ${err.message}`;
  return /PerDay|per day/i.test(text) ? "daily" : "minute";
}

/** Milliseconds until the next midnight in Pacific time, when Google resets the daily free quota. */
export function msUntilPacificMidnight(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const elapsed = (get("hour") * 3600 + get("minute") * 60 + get("second")) * 1000 + now.getMilliseconds();
  return Math.max(60_000, 86_400_000 - elapsed);
}

/** Model → time until which it's skipped (quota exhausted). In-memory: a restart forgets, which is harmless. */
const cooldownUntil = new Map<LanguageModel, number>();

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

export interface ModelCall {
  model: LanguageModel;
  /** Times out this attempt (25 s by default). */
  signal: AbortSignal;
  providerOptions: ReturnType<typeof googleOptions>;
}

export interface CallModelOptions {
  label: string;
  /** Thinking tokens for 2.5 models (0 = none); mapped to a thinking level for Gemini 3. */
  thinkingBudget: number;
  /** Attempts per model for 5xx / timeouts (default 2). */
  attempts?: number;
  timeoutMs?: number;
  /** Test hook: 0 disables backoff waits. */
  baseDelayMs?: number;
}

/**
 * Runs `fn` against the model chain:
 * - 429 (quota): that model is skipped until its quota resets (next Pacific midnight for daily, 60 s for per-minute)
 *   and the NEXT model is tried at once, no waiting.
 * - 5xx / timeout: retried on the same model with backoff, then the next model.
 * - anything else (e.g. output didn't match the schema): fails at once.
 * Final failure: 503 AI_RESTING / AI_BUSY_MINUTE when every model is out of quota, else 502 "busy". HttpErrors pass through.
 */
export async function callModel<T>(fn: (call: ModelCall) => Promise<T>, opts: CallModelOptions): Promise<T> {
  const chain = languageModels();
  const attempts = opts.attempts ?? 2;
  const base = opts.baseDelayMs ?? 500;
  let last: unknown;
  let tried = 0;
  for (const model of chain) {
    if ((cooldownUntil.get(model) ?? 0) > Date.now()) continue;
    tried++;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn({
          model,
          signal: AbortSignal.timeout(opts.timeoutMs ?? CALL_TIMEOUT_MS),
          providerOptions: googleOptions(opts.thinkingBudget, idOf(model)),
        });
      } catch (err) {
        if (err instanceof HttpError) throw err;
        last = err;
        const quota = quotaKind(err);
        if (quota) {
          cooldownUntil.set(model, Date.now() + (quota === "daily" ? msUntilPacificMidnight() : 60_000));
          console.warn(`[ai] ${opts.label}: ${idOf(model)} hit its ${quota} quota, trying the next model`);
          break;
        }
        if (!isRetryable(err)) {
          logFailure(opts.label, err);
          throw new HttpError(502, "UPSTREAM", "The AI service is busy, try again");
        }
        if (i < attempts - 1) await sleep(base * 2 ** i + Math.random() * base);
      }
    }
  }
  logFailure(opts.label, last ?? new Error(tried === 0 ? "every model is cooling down" : "no attempt succeeded"));
  const soonest = Math.min(...chain.map((m) => cooldownUntil.get(m) ?? 0)) - Date.now();
  if (chain.every((m) => (cooldownUntil.get(m) ?? 0) > Date.now())) {
    throw new HttpError(503, "UPSTREAM", soonest < 5 * 60_000 ? AI_BUSY_MINUTE : AI_RESTING);
  }
  throw new HttpError(502, "UPSTREAM", "The AI service is busy, try again");
}

function logFailure(label: string, err: unknown) {
  const e = unwrap(err);
  const status = APICallError.isInstance(e) ? e.statusCode : undefined;
  console.error(`[ai] ${label} failed`, { status, message: (e as Error)?.message?.slice(0, 300) });
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

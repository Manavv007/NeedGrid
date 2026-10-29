/**
 * Product ranking for intake (AGENT_B_AI_DATA.md §9.2). The model only scores fit; ordering, pack math and every
 * number are deterministic. If the model call fails, intake still works: fallback = price order.
 *
 * All items of one intake are ranked in ONE model call (in chunks of RANK_CHUNK items): one call per item hit
 * Gemini's free-tier request quota (429) on a 5-item list.
 */
import { formatUsd, type ExtractedNeed, type ProductOption, type ProductSnapshot } from "@needgrid/shared";
import { generateText, Output } from "ai";
import { z } from "zod";
import { cached, googleOptions, languageModel, withRetry } from "./models";
import { RANK_SYSTEM } from "./prompts/rank";
import { wrapUntrusted } from "./untrusted";

export const MAX_CANDIDATES = 8;
export const MAX_OPTIONS = 3;
/** The prompt scores wrong products 0.2 or lower and related-but-different ones 0.4 or lower; those aren't shown. */
export const MIN_FIT = 0.5;
const MAX_REASON = 120;
const RANK_CHUNK = 8;

const RankModelSchema = z.object({
  items: z.array(
    z.object({
      item: z.number(),
      rankings: z.array(z.object({ index: z.number(), fitScore: z.number(), fitReason: z.string() })),
    }),
  ),
});

export interface RankInput {
  extracted: ExtractedNeed;
  /** "300 diapers" style: prefer products whose pack count is known. */
  quantityIsLooseItems?: boolean;
}

export interface RankJob {
  input: RankInput;
  candidates: readonly ProductSnapshot[];
}

export function pricePerItemCents(p: Pick<ProductSnapshot, "unitPriceCents" | "packSize">): number | null {
  return p.packSize ? Math.round(p.unitPriceCents / p.packSize) : null;
}

/** Drop out-of-stock candidates if at least 3 in-stock ones exist; cap at MAX_CANDIDATES. */
export function prefilter(candidates: readonly ProductSnapshot[]): ProductSnapshot[] {
  const inStock = candidates.filter((c) => c.inStock !== false);
  return (inStock.length >= 3 ? inStock : [...candidates]).slice(0, MAX_CANDIDATES);
}

const nullsLast = (a: number | null, b: number | null) =>
  a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : a - b;

/** fitScore desc, then price per item asc (unknown last), then unit price asc, then id (stable). */
export function sortOptions(options: ProductOption[]): ProductOption[] {
  return [...options].sort(
    (a, b) =>
      b.fitScore - a.fitScore ||
      nullsLast(a.pricePerItemCents, b.pricePerItemCents) ||
      a.unitPriceCents - b.unitPriceCents ||
      a.channel3Id.localeCompare(b.channel3Id),
  );
}

export function fallbackOptions(candidates: readonly ProductSnapshot[]): ProductOption[] {
  return sortOptions(
    prefilter(candidates).map((c) => ({
      ...c,
      fitScore: 0.5,
      fitReason: "Ranked by price",
      pricePerItemCents: pricePerItemCents(c),
    })),
  ).slice(0, MAX_OPTIONS);
}

function describeJob(j: number, { input, candidates }: RankJob): string {
  const e = input.extracted;
  const head = [
    `## Item ${j}`,
    `Needed: ${wrapUntrusted("need_title", e.title, 200)}`,
    `Quantity: ${e.quantity} ${wrapUntrusted("need_unit", e.unit, 40)}${input.quantityIsLooseItems ? " (counted in loose pieces)" : ""}`,
    `Category: ${e.category}`,
    e.notes ? `Notes: ${wrapUntrusted("need_notes", e.notes, 300)}` : null,
    "Candidates:",
  ];
  const lines = candidates.map((c, i) => {
    const count = c.packSize ? `${c.packSize} per pack` : "count per pack unknown";
    const stock = c.inStock === false ? ", out of stock" : "";
    return `[${i}] ${wrapUntrusted("product_title", c.title, 300)}\n    ${formatUsd(c.unitPriceCents)} at ${c.retailer}, ${count}${stock}`;
  });
  return [...head.filter(Boolean), ...lines].join("\n");
}

type Scores = Map<number, { fitScore: number; fitReason: string }>;

/** One model call for up to RANK_CHUNK jobs. Returns validated scores per job index (missing = model skipped it). */
async function scoreChunk(jobs: readonly RankJob[]): Promise<Map<number, Scores>> {
  const key = jobs.map((j) => ({
    need: j.input,
    ids: j.candidates.map((c) => [c.channel3Id, c.unitPriceCents, c.packSize]),
  }));
  const items = await cached("rank", key, () =>
    withRetry(
      async (signal) => {
        const { output } = await generateText({
          model: languageModel(),
          instructions: RANK_SYSTEM,
          prompt: jobs.map((j, i) => describeJob(i, j)).join("\n\n"),
          output: Output.object({ schema: RankModelSchema }),
          temperature: 0,
          maxRetries: 0,
          abortSignal: signal,
          providerOptions: googleOptions(0),
        });
        return output.items;
      },
      { label: "rank" },
    ),
  );
  const out = new Map<number, Scores>();
  for (const it of items) {
    const j = Math.trunc(it.item);
    const job = jobs[j];
    if (!job || out.has(j)) continue;
    const scores: Scores = new Map();
    for (const r of it.rankings) {
      const i = Math.trunc(r.index);
      if (i < 0 || i >= job.candidates.length || scores.has(i) || !Number.isFinite(r.fitScore)) continue;
      scores.set(i, {
        fitScore: Math.min(1, Math.max(0, r.fitScore)),
        fitReason: r.fitReason.trim().slice(0, MAX_REASON) || "Matches the request",
      });
    }
    if (scores.size > 0) out.set(j, scores);
  }
  return out;
}

function toOptions(job: RankJob, scores: Scores): ProductOption[] {
  const options: ProductOption[] = [];
  job.candidates.forEach((c, i) => {
    const s = scores.get(i);
    if (!s || s.fitScore < MIN_FIT) return; // unscored or clearly wrong: not shown
    options.push({ ...c, ...s, pricePerItemCents: pricePerItemCents(c) });
  });
  return sortOptions(options).slice(0, MAX_OPTIONS);
}

/** Top 3 ProductOptions for each job, in job order. Never throws: a failed chunk falls back to price order. */
export async function rankMany(jobs: readonly RankJob[]): Promise<ProductOption[][]> {
  const prepared = jobs.map((j) => ({ ...j, candidates: prefilter(j.candidates) }));
  const results: ProductOption[][] = prepared.map(() => []);
  const todo = prepared.map((job, i) => ({ job, i })).filter((x) => x.job.candidates.length > 0);

  const chunks: (typeof todo)[] = [];
  for (let k = 0; k < todo.length; k += RANK_CHUNK) chunks.push(todo.slice(k, k + RANK_CHUNK));

  await Promise.all(
    chunks.map(async (chunk) => {
      let scored: Map<number, Scores>;
      try {
        scored = await scoreChunk(chunk.map((x) => x.job));
      } catch (err) {
        console.warn("[ai] ranking fell back to price order:", (err as Error).message);
        scored = new Map();
      }
      chunk.forEach(({ job, i }, j) => {
        const s = scored.get(j);
        results[i] = s ? toOptions(job, s) : fallbackOptions(job.candidates);
      });
    }),
  );
  return results;
}

/** Top 3 ProductOptions for one extracted need (§9.2 signature). Never throws. */
export async function rankOptions(
  input: RankInput | ExtractedNeed,
  candidates: readonly ProductSnapshot[],
): Promise<ProductOption[]> {
  const rankInput: RankInput = "extracted" in input ? input : { extracted: input };
  return (await rankMany([{ input: rankInput, candidates }]))[0]!;
}

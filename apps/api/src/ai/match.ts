/**
 * Match me (AGENT_B_AI_DATA.md §9.5, P1): a donor says what they care about and how much they want to give; we
 * suggest 3 needs. Retrieval and ranking are deterministic (pgvector cosine distance, then urgency); the model only
 * writes the 3 one-line reasons, and a reason quoting an amount that isn't in the facts is replaced by a plain one.
 *
 * Free tier: if the donor's text can't be embedded (no key, quota), we fall back to keyword + urgency ranking, so the
 * box still answers. Reads only (needs, organizations); no writes.
 */
import { DONATABLE_STATUSES, formatUsd, type MatchReq, type MatchRes, type NeedCard } from "@needgrid/shared";
import { generateText, Output } from "ai";
import { and, cosineDistance, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import * as core from "../core";
import { queryTokens } from "./assistant/tools";
import { embedText } from "./embeddings";
import { cached, callModel, isAiConfigured, isEmbeddingConfigured } from "./models";
import { MATCH_REASONS_SYSTEM } from "./prompts/match";
import { wrapUntrusted } from "./untrusted";

export const MATCH_COUNT = 3;
const CANDIDATES = 40;
const MAX_REASON = 90;
/**
 * "Similarity first, urgency second": each urgency level adds this much to the similarity, so urgency only decides
 * between needs that are about equally close (Gemini similarities for related items differ by ~0.05–0.1). A weight
 * instead of similarity buckets: buckets put 0.900 and 0.895 in different buckets (tried, Nov 1).
 */
export const URGENCY_WEIGHT = 0.02;
/** Candidates this close to the best similarity count as relevant (Gemini text-embedding, live Nov 1: the right
 * items sit ~0.05 above the rest). */
export const RELEVANCE_MARGIN = 0.05;
/** A reason for a partial gift must not claim it finishes the need. */
const FINISH_WORDS = /\b(finish|finishes|complete|completes|covers the last|covers the rest|fully fund)/i;

export interface Candidate {
  need: NeedCard;
  /** Cosine similarity 0–1 (1 = same meaning); null in the keyword fallback. */
  similarity: number | null;
}

export interface Pick extends Candidate {
  /** The gift doesn't finish the need: remaining > budget. */
  partial: boolean;
  /** What the gift would add: min(budget, remaining) (the server clamps donations the same way). */
  giftCents: number;
}

export interface MatchDeps {
  embedQuery(text: string): Promise<number[] | null>;
  nearest(vector: number[], limit: number): Promise<Array<{ id: string; distance: number }>>;
  donatable(limit: number): Promise<NeedCard[]>;
  needCards(ids: string[]): Promise<NeedCard[]>;
  orgNames(orgIds: string[]): Promise<Map<string, string>>;
}

const isDonatable = (n: NeedCard) =>
  (DONATABLE_STATUSES as readonly string[]).includes(n.status) && n.remainingCents > 0;

export const dbMatchDeps: MatchDeps = {
  async embedQuery(text) {
    if (!isEmbeddingConfigured()) return null;
    try {
      return await embedText(text, "RETRIEVAL_QUERY");
    } catch (err) {
      console.warn("[match] embedding failed, using keyword ranking:", (err as Error).message?.slice(0, 200));
      return null;
    }
  },
  async nearest(vector, limit) {
    const { needs } = core.schema;
    const distance = cosineDistance(needs.embedding, vector);
    return core.db
      .select({ id: needs.id, distance: sql<number>`${distance}` })
      .from(needs)
      .where(
        and(
          inArray(needs.status, [...DONATABLE_STATUSES]),
          isNotNull(needs.embedding),
          sql`${needs.targetCents} > ${needs.fundedCents}`,
        ),
      )
      .orderBy(distance)
      .limit(limit);
  },
  donatable: (limit) => core.listDonatableNeeds({ limit }),
  needCards: (ids) => core.getNeedCards(ids),
  async orgNames(orgIds) {
    if (orgIds.length === 0) return new Map();
    const { organizations } = core.schema;
    const rows = await core.db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(inArray(organizations.id, orgIds));
    return new Map(rows.map((r) => [r.id, r.name]));
  },
};

const score = (c: Candidate) => (c.similarity ?? 0) + URGENCY_WEIGHT * (c.need.urgency - 1);

/** Similarity plus a small urgency weight, then less left to raise. Stable. */
export function rankCandidates(cands: readonly Candidate[]): Candidate[] {
  return [...cands].sort((a, b) => score(b) - score(a) || a.need.remainingCents - b.need.remainingCents);
}

/**
 * Top 3. Among RELEVANT candidates (similarity within RELEVANCE_MARGIN of the best one) the gift finishing a need
 * comes first; only then the less relevant ones. Live (Nov 1): without the margin, "kids at school who need warm
 * clothes" ($30) returned glue sticks and index cards (similarity ~0.6, fits $30) instead of the winter coats (0.75).
 */
export function pickMatches(ranked: readonly Candidate[], budgetCents: number): Pick[] {
  const toPick = (c: Candidate): Pick => ({
    ...c,
    partial: c.need.remainingCents > budgetCents,
    giftCents: Math.min(budgetCents, c.need.remainingCents),
  });
  const best = Math.max(...ranked.map((c) => c.similarity ?? -Infinity));
  const relevant = (c: Candidate) => c.similarity === null || c.similarity >= best - RELEVANCE_MARGIN;
  const fits = (c: Candidate) => c.need.remainingCents <= budgetCents;
  const order = [
    ranked.filter((c) => relevant(c) && fits(c)),
    ranked.filter((c) => relevant(c) && !fits(c)),
    ranked.filter((c) => !relevant(c) && fits(c)),
    ranked.filter((c) => !relevant(c) && !fits(c)),
  ].flat();
  return order.slice(0, MATCH_COUNT).map(toPick);
}

/** Keyword fallback: needs sharing more of the donor's words first; the list is already most-urgent-first. */
export function keywordRank(needs: readonly NeedCard[], text: string): Candidate[] {
  const tokens = queryTokens(text);
  const hits = (n: NeedCard) => {
    const hay = `${n.title} ${n.description} ${n.category}`.toLowerCase();
    return tokens.filter((t) => hay.includes(t)).length;
  };
  return needs
    .map((need, i) => ({ need, i, h: hits(need) }))
    .sort((a, b) => b.h - a.h || a.i - b.i)
    .map(({ need }) => ({ need, similarity: null }));
}

/** "$25" for whole dollars, else "$25.50". */
export const usdShort = (cents: number) => formatUsd(cents).replace(/\.00$/, "");

const clip = (s: string) => (s.length > MAX_REASON ? `${s.slice(0, MAX_REASON - 1).trimEnd()}…` : s);

export function plainReason(p: Pick, orgName: string): string {
  return clip(
    p.partial
      ? `Your ${usdShort(p.giftCents)} goes toward ${p.need.title} at ${orgName}`
      : `Your ${usdShort(p.giftCents)} covers the last of ${p.need.title} at ${orgName}`,
  );
}

/** Dollar amounts in a text, as cents ("$25" and "$25.00" are the same). */
function amountsIn(text: string): number[] {
  return [...text.matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g)].map((m) =>
    Math.round(Number(m[1]!.replace(/,/g, "")) * 100),
  );
}

const ReasonsSchema = z.object({ reasons: z.array(z.object({ index: z.number(), reason: z.string() })) });

/** One model call for all reasons. Never throws: any failure or invented amount → the plain reason. */
export async function writeReasons(text: string, budgetCents: number, picks: Pick[], orgName: (p: Pick) => string) {
  const plain = picks.map((p) => plainReason(p, orgName(p)));
  if (!isAiConfigured() || picks.length === 0) return plain;
  const facts = [
    `Donor cares about: ${wrapUntrusted("donor_text", text, 300)}`,
    `Gift: ${usdShort(budgetCents)}`,
    ...picks.map(
      (p, i) =>
        `[${i}] ${wrapUntrusted("need_title", p.need.title, 200)} at ${wrapUntrusted("org_name", orgName(p), 100)}; ` +
        `category ${p.need.category}; ${usdShort(p.need.remainingCents)} still needed; ` +
        (p.partial
          ? `partial: the ${usdShort(budgetCents)} gift helps toward it`
          : `a gift of ${usdShort(p.giftCents)} finishes it`),
    ),
  ].join("\n");
  try {
    const out = await cached("match-reasons", facts, () =>
      callModel(
        async ({ model, signal, providerOptions }) => {
          const { output } = await generateText({
            model,
            instructions: MATCH_REASONS_SYSTEM,
            prompt: facts,
            output: Output.object({ schema: ReasonsSchema }),
            temperature: 0.3,
            maxRetries: 0,
            abortSignal: signal,
            providerOptions,
          });
          return output.reasons;
        },
        { label: "match", thinkingBudget: 0 },
      ),
    );
    return picks.map((p, i) => {
      const r = out
        .find((x) => Math.trunc(x.index) === i)
        ?.reason.replace(/\s+/g, " ")
        .replace(/!+/g, ".")
        .trim();
      // A finished need takes only what's left (the server clamps the donation), so its reason quotes that, not the
      // budget. Live (Nov 1): "Your $25 gift finishes … size 4 diapers" when $14 was left.
      const allowed = new Set(p.partial ? [budgetCents, p.need.remainingCents] : [p.giftCents]);
      if (!r || r.length > MAX_REASON || amountsIn(r).some((a) => !allowed.has(a))) return plain[i]!;
      if (p.partial && FINISH_WORDS.test(r)) return plain[i]!;
      return r;
    });
  } catch (err) {
    console.warn("[match] reasons fell back to plain text:", (err as Error).message?.slice(0, 200));
    return plain;
  }
}

export async function matchNeeds(req: MatchReq, deps: MatchDeps = dbMatchDeps): Promise<MatchRes> {
  const vector = await deps.embedQuery(req.text);
  let candidates: Candidate[];
  if (vector) {
    const near = await deps.nearest(vector, CANDIDATES);
    const distance = new Map(near.map((n) => [n.id, n.distance]));
    const cards = await deps.needCards(near.map((n) => n.id));
    candidates = rankCandidates(
      cards.filter(isDonatable).map((need) => ({ need, similarity: 1 - (distance.get(need.id) ?? 1) })),
    );
  } else {
    candidates = keywordRank((await deps.donatable(CANDIDATES)).filter(isDonatable), req.text);
  }
  const picks = pickMatches(candidates, req.budgetCents);
  const names = await deps.orgNames([...new Set(picks.map((p) => p.need.orgId))]);
  const orgName = (p: Pick) => names.get(p.need.orgId) ?? p.need.orgSlug;
  const reasons = await writeReasons(req.text, req.budgetCents, picks, orgName);
  return { matches: picks.map((p, i) => ({ need: p.need, orgName: orgName(p), reason: reasons[i]! })) };
}

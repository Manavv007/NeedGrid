/**
 * Mock Match me (B's `POST /api/match`, AGENT_B_AI_DATA.md §9.5, not built yet). Like B's route: the
 * body must be `MatchReq` (else 400), 10 requests a minute (else 429), and up to 3 needs that still
 * take donations and have something left, each with one reason of at most 90 characters.
 *
 * B ranks by embedding similarity; the mock uses plain keyword overlap with the need's title and
 * category (worth 2) or description (worth 1). Needs whose remaining fits the budget come first (most
 * similar, then most urgent), then the closest needs above the budget fill up to 3 as partial gifts.
 * A need that shares no word with the request is never suggested, so "nothing fits" can happen.
 * B writes the reasons with one LLM call; the mock builds them from the facts only.
 *
 * `?mock=matchResting` makes the next request answer like B's free-tier guard when every model is
 * out: `503 UPSTREAM` "The AI is resting, try again tomorrow". About 1.5 s of latency in the browser.
 */
import { MatchReq, MatchRes, type NeedCard } from "@needgrid/shared";
import { http, HttpResponse } from "msw";
import { compareMostUrgent } from "@/features/tiles/filterNeeds";
import { CATEGORY_LABELS, formatUsdShort } from "@/lib/format";
import { mockDb } from "./mockDb";
import { apiError, browserDelay, readJson, validation } from "./respond";

/** B's ranking takes a few seconds; the mock waits this long so the loading state shows. */
const MATCH_LATENCY_MS = 1_500;
export const MAX_MATCHES = 3;
/** B's limit for each reason (§9.5). */
export const REASON_MAX = 90;
/** B's free-tier message when every model is out for the day (NOTES.md §15). */
export const RESTING_MESSAGE = "The AI is resting, try again tomorrow";

/** Words that say nothing about what a donor cares about. */
const STOP_WORDS = new Set(
  (
    "about all and any are buy can care for from fund get give help helping helps into just like love more most " +
    "much need needs our out please really some something stuff that the their them they thing things this " +
    "very want what who will with would you your"
  ).split(" "),
);

/** "babies" → "baby", "brushes" → "brush", "diapers" → "diaper". Enough for keyword overlap. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** The meaningful words of `text`: lowercase, 3+ letters, no stop words, stemmed. */
export function keywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  return new Set(words.map(stem));
}

/** Each of the donor's words counts once, at its best place: title or category 2, description 1. */
function similarity(query: ReadonlySet<string>, need: NeedCard): number {
  const strong = keywords(`${need.title} ${need.category} ${CATEGORY_LABELS[need.category]}`);
  const weak = keywords(need.description);
  let score = 0;
  for (const word of query) score += strong.has(word) ? 2 : weak.has(word) ? 1 : 0;
  return score;
}

/**
 * "Your $25 covers the last of Diapers, size 4 at Harbor Food Bank" or "Your $10 goes toward …",
 * never longer than REASON_MAX (the org goes first, then the title is shortened).
 */
export function matchReason(need: NeedCard, orgName: string, budgetCents: number): string {
  const budget = formatUsdShort(budgetCents);
  const lead = need.remainingCents <= budgetCents ? `Your ${budget} covers the last of` : `Your ${budget} goes toward`;
  const full = `${lead} ${need.title} at ${orgName}`;
  if (full.length <= REASON_MAX) return full;
  const short = `${lead} ${need.title}`;
  return short.length <= REASON_MAX ? short : `${short.slice(0, REASON_MAX - 1).trimEnd()}…`;
}

type Candidate = { need: NeedCard; orgName: string; score: number };

/** The mock's answer to a valid request, validated like the real response. */
export function mockMatch(req: MatchReq): MatchRes {
  const query = keywords(req.text);
  const scored: Candidate[] = mockDb
    .matchCandidates()
    .map((candidate) => ({ ...candidate, score: similarity(query, candidate.need) }))
    .filter((candidate) => candidate.score > 0);
  const fits = scored
    .filter((c) => c.need.remainingCents <= req.budgetCents)
    .sort((a, b) => b.score - a.score || compareMostUrgent(a.need, b.need));
  const above = scored
    .filter((c) => c.need.remainingCents > req.budgetCents)
    .sort(
      (a, b) => b.score - a.score || a.need.remainingCents - b.need.remainingCents || compareMostUrgent(a.need, b.need),
    );
  const matches = [...fits, ...above].slice(0, MAX_MATCHES).map(({ need, orgName }) => ({
    need,
    orgName,
    reason: matchReason(need, orgName, req.budgetCents),
  }));
  return MatchRes.parse({ matches });
}

export const matchHandlers = [
  // Public: no staff key. Every request counts toward the limit, refused bodies too (like the API).
  http.post("*/api/match", async ({ request }) => {
    if (!mockDb.takeMatchRequest()) return apiError(429, "RATE_LIMITED", "Too many requests. Please wait a minute.");
    const body = MatchReq.safeParse(await readJson(request));
    if (!body.success) return validation(body.error);
    if (mockDb.takeScenario("matchResting")) return apiError(503, "UPSTREAM", RESTING_MESSAGE);
    await browserDelay(MATCH_LATENCY_MS);
    return HttpResponse.json(mockMatch(body.data));
  }),
];

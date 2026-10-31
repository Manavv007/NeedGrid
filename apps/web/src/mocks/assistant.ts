/**
 * Mock staff assistant (B's `POST /api/staff/agent/chat`, AGENT_B_AI_DATA.md §9.6 + §9.7) and A's
 * agent actions and invoices (AGENT_A_BACKEND.md §8.6, §8.7). The chat answers NDJSON, one shared
 * `AgentStreamEvent` per line (each validated before it's sent), with small delays in the browser,
 * and like B's model it reads and proposes but never runs a money action or states an amount:
 *
 * - "invoice …"                → text, list_needs, propose_invoice, `action_proposed` (a real
 *   `create_invoice` action from mockDb with every amount computed there), "please review the card".
 *   Needs: the caller's open ones matching the request ("winter coats", a category such as "hygiene"),
 *   otherwise the most urgent ones, at most 4. Recipient: the email in the request (no email → it asks).
 * - "mismatch"                 → reconcile with one payment missing in our records and one amount that differs.
 * - "check" / "reconcile" / "match" → reconcile: everything matches.
 * - "refund everyone"          → refuses bulk refunds, offers to list recent donations.
 * - "unfunded" / "urgent"      → list_needs, then the titles only.
 * - `?mock=assistantError`     → a few words, then `{ type: "error" }` and `done`.
 * - `?mock=assistantBadLine`   → a line that isn't JSON and one unknown event in the middle.
 *
 * Every stream ends with `done`. 401 without a staff key, 429 after 20 chats a minute per key.
 */
import {
  AGENT_ACTION_STATUSES,
  AgentActionListRes,
  AgentActionRes,
  AgentChatReq,
  AgentStreamEvent,
  CATEGORIES,
  ReconcileReport,
  SponsorInvoiceListRes,
  type NeedCard,
  type OrgPublic,
} from "@needgrid/shared";
import { http, HttpResponse } from "msw";
import { z } from "zod";
import { mockDb } from "./mockDb";
import {
  apiError,
  browserDelay,
  isUuid,
  latency,
  notFound,
  readJson,
  refusal,
  staffKeyOf,
  staffOrg,
  unauthorized,
  validation,
} from "./respond";

/** One line of a mock reply: an event (validated when sent) or, for the bad-line switch, raw text. */
type Step = { event: AgentStreamEvent; waitMs: number } | { raw: string; waitMs: number };

const WORD_MS = 45;
const TOOL_MS = 700;
/** A's approve runs PayPal (create, send, QR code): a short wait shows the card's pending state. */
const APPROVE_LATENCY_MS = 1_200;
const DAY_MS = 86_400_000;
/** PayPal's transaction search lags by up to ~3 hours (B §9.7). */
const PAYPAL_LAG_MS = 3 * 60 * 60_000;
const MAX_INVOICE_NEEDS = 4;
const MAX_LISTED_NEEDS = 6;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---------- reply building blocks ----------

/** Text in chunks of a few words, like a model's deltas. */
function* say(text: string): Generator<Step> {
  const words = text.match(/\S+\s*/g) ?? [];
  for (let i = 0; i < words.length; i += 3) {
    yield { event: { type: "text", delta: words.slice(i, i + 3).join("") }, waitMs: WORD_MS };
  }
}

const toolCall = (tool: string, summary: string): Step => ({
  event: { type: "tool_call", tool, summary },
  waitMs: 150,
});
const toolResult = (tool: string, summary: string, data?: unknown): Step => ({
  event: data === undefined ? { type: "tool_result", tool, summary } : { type: "tool_result", tool, summary, data },
  waitMs: TOOL_MS,
});
const DONE: Step = { event: { type: "done" }, waitMs: 0 };

// ---------- invoices ----------

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const RECIPIENT_NAME = /invoice\s+(.+?)\s*\(/i;

type Topic = { pattern: RegExp; matches: (need: NeedCard) => boolean };

const WINTER = /winter|coat/i;
const TOPICS: Topic[] = [
  { pattern: WINTER, matches: (need) => WINTER.test(`${need.title} ${need.description}`) },
  ...CATEGORIES.map((category) => ({
    pattern: new RegExp(`\\b${category}\\b`, "i"),
    matches: (need: NeedCard) => need.category === category,
  })),
];

/**
 * What the model would find with `list_needs`: the caller's open needs matching the request, most
 * urgent first. No topic in the request → the most urgent open needs.
 */
function needsFor(org: OrgPublic, text: string): { needs: NeedCard[]; topicMissing: boolean } {
  const open = mockDb.openNeedsFor(org.id);
  const topic = TOPICS.find((t) => t.pattern.test(text));
  const needs = (topic ? open.filter(topic.matches) : open).slice(0, MAX_INVOICE_NEEDS);
  return { needs, topicMissing: topic !== undefined && needs.length === 0 };
}

function* invoiceReply(org: OrgPublic, text: string): Generator<Step> {
  yield* say("Let me find the needs for that invoice.");
  yield toolCall("list_needs", "Looking up your needs…");
  const { needs, topicMissing } = needsFor(org, text);
  yield toolResult(
    "list_needs",
    needs.length > 0 ? `Looked up open needs · found ${plural(needs.length, "item", "items")}` : "Looked up open needs",
  );
  if (needs.length === 0) {
    yield* say(
      topicMissing
        ? `I couldn't find open needs at ${org.name} that match that. Try a category, for example "everything still needed in hygiene".`
        : "Every open need is already covered, so there's nothing to invoice right now.",
    );
    yield DONE;
    return;
  }

  const email = EMAIL.exec(text)?.[0];
  if (!email) {
    yield* say(
      `I found ${plural(needs.length, "item", "items")} for this invoice. Who should it go to? Please give me their email address.`,
    );
    yield DONE;
    return;
  }

  yield toolCall("propose_invoice", "Preparing an invoice for approval…");
  const name = RECIPIENT_NAME.exec(text)?.[1]?.trim().slice(0, 100);
  const proposed = mockDb.proposeInvoice(org.id, {
    needIds: needs.map((need) => need.id),
    recipientEmail: email,
    ...(name && !name.includes("@") ? { recipientName: name } : {}),
    send: true,
  });
  if (proposed.kind !== "ok") {
    yield toolResult("propose_invoice", "Couldn't prepare the invoice");
    yield* say(
      proposed.kind === "refused" ? `I couldn't prepare it: ${proposed.message}` : "I couldn't prepare that invoice.",
    );
    yield DONE;
    return;
  }
  yield toolResult("propose_invoice", "Prepared an invoice for your approval");
  yield { event: { type: "action_proposed", action: proposed.action }, waitMs: 100 };
  yield* say("I've prepared it, please review the approval card.");
  yield DONE;
}

// ---------- reconcile (B §9.7) ----------

const TXN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";

/** A PayPal-style 17-character transaction id. */
function newTransactionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(17));
  return Array.from(bytes, (b) => TXN_ALPHABET[b % TXN_ALPHABET.length]).join("");
}

/**
 * The mock's money check for the last 7 days. Mock "PayPal" holds the same payments as the ledger
 * (the fixture history stands in for this week's real payments); gifts from the last 3 hours are
 * left out as pending, like B's report. `withMismatches` adds one PayPal payment we have no record
 * of and makes one recorded gift's PayPal amount differ.
 */
export function mockReconcileReport(orgId: string, withMismatches: boolean, nowMs: number = Date.now()) {
  const startMs = nowMs - 7 * DAY_MS;
  const inPeriod = mockDb.ledgerSnapshot().donations.filter((d) => {
    const at = Date.parse(d.at);
    return d.orgId === orgId && at >= startMs && at <= nowMs;
  });
  const settled = inPeriod.filter((d) => Date.parse(d.at) < nowMs - PAYPAL_LAG_MS);
  const recordedTotalCents = settled.reduce((sum, d) => sum + d.amountCents, 0);
  let paypalTotalCents = recordedTotalCents;
  let matchedCount = settled.length;
  const mismatches: ReconcileReport["mismatches"] = [];

  if (withMismatches) {
    const unknownCents = 2_500;
    mismatches.push({
      kind: "missing_in_records",
      paypalTransactionId: newTransactionId(),
      donationId: null,
      paypalCents: unknownCents,
      recordedCents: null,
    });
    paypalTotalCents += unknownCents;
    const differs = settled.at(-1);
    if (differs) {
      const extraCents = 500;
      matchedCount -= 1;
      mismatches.push({
        kind: "amount_mismatch",
        paypalTransactionId: newTransactionId(),
        donationId: isUuid(differs.id) ? differs.id : null,
        paypalCents: differs.amountCents + extraCents,
        recordedCents: differs.amountCents,
      });
      paypalTotalCents += extraCents;
    }
  }

  const report = ReconcileReport.parse({
    periodStart: new Date(startMs).toISOString(),
    periodEnd: new Date(nowMs).toISOString(),
    paypalTotalCents,
    recordedTotalCents,
    matchedCount,
    mismatches,
    ok: mismatches.length === 0,
  });
  return { report, pending: inPeriod.length - settled.length };
}

function* reconcileReply(org: OrgPublic, withMismatches: boolean): Generator<Step> {
  yield* say("I'll compare this week's PayPal payments with our records.");
  yield toolCall("reconcile", "Checking PayPal transactions…");
  const { report, pending } = mockReconcileReport(org.id, withMismatches);
  yield toolResult("reconcile", "Checked PayPal transactions against NeedGrid records", report);
  const pendingNote =
    pending > 0
      ? ` ${plural(pending, "gift", "gifts")} from the last 3 hours ${pending === 1 ? "isn't" : "aren't"} in PayPal's report yet, so I'll count ${pending === 1 ? "it" : "them"} next time.`
      : "";
  if (report.ok) {
    yield* say(
      report.matchedCount === 0
        ? `There were no payments to compare this week.${pendingNote}`
        : `All ${report.matchedCount} payments this week match our records to the cent. Nothing needs fixing.${pendingNote}`,
    );
  } else {
    yield* say(
      `${plural(report.mismatches.length, "thing doesn't", "things don't")} match. They're listed in the table. I haven't changed anything; check them in PayPal before you fix the records.${pendingNote}`,
    );
  }
  yield DONE;
}

// ---------- other replies ----------

const URGENCY_WORDS: Readonly<Record<number, string>> = { 1: "low", 2: "medium", 3: "urgent" };

function* openNeedsReply(org: OrgPublic): Generator<Step> {
  yield toolCall("list_needs", "Looking up your needs…");
  const open = mockDb.openNeedsFor(org.id);
  yield toolResult("list_needs", `Looked up open needs · found ${plural(open.length, "item", "items")}`);
  if (open.length === 0) {
    yield* say("Everything you posted is covered right now. Nothing is waiting for donations.");
  } else {
    const lines = open
      .slice(0, MAX_LISTED_NEEDS)
      .map((need) => `• ${need.title} (${URGENCY_WORDS[need.urgency] ?? "open"})`);
    const more = open.length > MAX_LISTED_NEEDS ? `\n…and ${open.length - MAX_LISTED_NEEDS} more.` : "";
    yield* say(`These still need donations, most urgent first:\n${lines.join("\n")}${more}`);
  }
  yield DONE;
}

function* refuseBulkRefund(): Generator<Step> {
  yield* say(
    "I can't refund everyone at once. Refunds are proposed one donation at a time, and each one needs your approval. Would you like me to list recent donations so you can pick one?",
  );
  yield DONE;
}

function* helpReply(): Generator<Step> {
  yield* say(
    "I can prepare sponsor invoices, check PayPal against your records, and tell you what's still needed. Try one of the suggestions below the chat.",
  );
  yield DONE;
}

function* failingReply(): Generator<Step> {
  yield* say("Let me look into that for you.");
  yield { event: { type: "error", message: "Sorry, the assistant hit a problem and stopped." }, waitMs: 300 };
  yield DONE;
}

function* badLineReply(): Generator<Step> {
  yield* say("Checking that now.");
  yield { raw: '{"type":"text","delta":', waitMs: 100 };
  yield { raw: '{"type":"surprise","html":"<b>raw</b>"}', waitMs: 100 };
  yield* say("Done.");
  yield DONE;
}

/** The scripted reply to the newest staff message. */
function replyFor(org: OrgPublic, text: string): Generator<Step> {
  if (mockDb.takeScenario("assistantError")) return failingReply();
  if (mockDb.takeScenario("assistantBadLine")) return badLineReply();
  const lower = text.toLowerCase();
  if (/refund (everyone|everybody|all)/.test(lower)) return refuseBulkRefund();
  if (lower.includes("invoice")) return invoiceReply(org, text);
  if (lower.includes("mismatch")) return reconcileReply(org, true);
  if (/check|reconcile|match/.test(lower)) return reconcileReply(org, false);
  if (/unfunded|urgent/.test(lower)) return openNeedsReply(org);
  return helpReply();
}

/**
 * An `application/x-ndjson` body that plays the reply step by step. Steps run lazily, so an action is
 * only proposed when the reply reaches it; once the browser stops reading (Stop, the page closed),
 * the reply ends where it was.
 */
function ndjsonResponse(steps: Iterable<Step>, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const step of steps) {
        await browserDelay(step.waitMs);
        if (cancelled || signal.aborted) return;
        const line = "raw" in step ? step.raw : JSON.stringify(AgentStreamEvent.parse(step.event));
        controller.enqueue(encoder.encode(`${line}\n`));
      }
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return new HttpResponse(stream, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
  });
}

const ActionStatus = z.enum(AGENT_ACTION_STATUSES);

export const assistantHandlers = [
  http.post("*/api/staff/agent/chat", async ({ request }) => {
    const org = staffOrg(request);
    if (!org) return unauthorized();
    if (!mockDb.takeChatRequest(staffKeyOf(request) ?? "")) {
      return apiError(429, "RATE_LIMITED", "Too many requests. Please wait a minute.");
    }
    const body = AgentChatReq.safeParse(await readJson(request));
    if (!body.success) return validation(body.error);
    const last = body.data.messages.findLast((message) => message.role === "user");
    if (!last) return apiError(400, "VALIDATION", "Send at least one staff message");
    return ndjsonResponse(replyFor(org, last.content), request.signal);
  }),

  http.get("*/api/staff/agent/actions", async ({ request }) => {
    await latency();
    const org = staffOrg(request);
    if (!org) return unauthorized();
    const raw = new URL(request.url).searchParams.get("status");
    const status = raw === null ? undefined : ActionStatus.safeParse(raw);
    if (status && !status.success) return validation(status.error);
    return HttpResponse.json(AgentActionListRes.parse({ actions: mockDb.listAgentActions(org.id, status?.data) }));
  }),

  http.post("*/api/staff/agent/actions/:id/approve", async ({ request, params }) => {
    await latency();
    const org = staffOrg(request);
    if (!org) return unauthorized();
    const id = String(params.id);
    if (!isUuid(id)) return notFound("Action");
    await browserDelay(APPROVE_LATENCY_MS);
    const result = mockDb.approveAgentAction(org.id, id);
    if (result.kind === "notFound") return notFound("Action");
    if (result.kind === "refused") return refusal(result);
    return HttpResponse.json(AgentActionRes.parse({ action: result.action }));
  }),

  http.post("*/api/staff/agent/actions/:id/reject", async ({ request, params }) => {
    await latency();
    const org = staffOrg(request);
    if (!org) return unauthorized();
    const id = String(params.id);
    if (!isUuid(id)) return notFound("Action");
    const result = mockDb.rejectAgentAction(org.id, id);
    if (result.kind === "notFound") return notFound("Action");
    if (result.kind === "refused") return refusal(result);
    return HttpResponse.json(AgentActionRes.parse({ action: result.action }));
  }),

  http.get("*/api/staff/invoices", async ({ request }) => {
    await latency();
    const org = staffOrg(request);
    if (!org) return unauthorized();
    return HttpResponse.json(SponsorInvoiceListRes.parse({ invoices: mockDb.listSponsorInvoices(org.id) }));
  }),
];

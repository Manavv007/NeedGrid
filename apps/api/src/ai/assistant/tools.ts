/**
 * The staff assistant's COMPLETE tool allowlist (AGENT_B_AI_DATA.md §9.6). Read tools read this org's rows only;
 * propose tools call core.proposeAction and nothing else that writes. No tool takes an amount: A's proposeAction
 * computes every amount on the server, and execution only happens when staff click Approve (A's endpoint).
 *
 * The org always comes from the closure (the staff passcode), never from the model.
 *
 * Model-facing input schemas are deliberately plain (strings, no formats or regex patterns: Gemini's schema mode
 * rejects some); the shared contract schemas (CreateInvoiceArgs, …) validate the input before anything runs.
 */
import {
  AgentAction,
  CATEGORIES,
  centsToUsdNumber,
  CreateInvoiceArgs,
  NEED_STATUSES,
  SendInvoiceArgs,
  type MoneyTool,
} from "@needgrid/shared";
import { and, asc, desc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import * as core from "../../core";
import { HttpError } from "../../lib/http";

const { needs, sponsorInvoices } = core.schema;

export const MAX_LISTED_NEEDS = 50;
const MAX_LISTED_INVOICES = 20;

export interface ToolOutcome {
  /** What the model sees (JSON). */
  forModel: unknown;
  /** One line for the staff member ("Looked up your needs · found 4 items"). */
  summary: string;
  /** Only for tools C renders (none yet; `reconcile` in B-9). */
  data?: unknown;
  /** Set when a proposal was created: streamed as `action_proposed`. */
  action?: AgentAction;
}

export interface AssistantTool {
  kind: "read" | "propose";
  description: string;
  inputSchema: z.ZodType;
  /** Shown while the tool runs ("Looking up your needs…"). */
  startSummary: string;
  run(input: unknown): Promise<ToolOutcome>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const STOP_WORDS = new Set(["the", "and", "for", "all", "list", "whole", "need", "needs", "item", "items", "our"]);

/** "the winter-coats list" → ["winter", "coat"]: words of 3+ letters, no stop words, trailing "s" dropped. */
export function queryTokens(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
        .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w)),
    ),
  ];
}

/** A need matches when every token appears in its title, description or category. */
export function matchesQuery(need: { title: string; description: string; category: string }, tokens: string[]) {
  const text = `${need.title} ${need.description} ${need.category}`.toLowerCase();
  return tokens.every((t) => text.includes(t));
}

/** Zod issues → one short line for the model. */
const issuesText = (e: z.ZodError) =>
  e.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
    .join("; ");

const ListNeedsInput = z.object({
  status: z.enum(NEED_STATUSES).optional().describe("Only needs in this status"),
  category: z.enum(CATEGORIES).optional(),
  query: z.string().max(80).optional().describe('A few words from the need titles, e.g. "winter coats"'),
});

const ProposeInvoiceInput = z.object({
  needIds: z.array(z.string()).min(1).max(50).describe("Need ids from list_needs"),
  recipientEmail: z.string().max(200).describe("The sponsor's email address"),
  recipientName: z.string().max(100).optional().describe("The sponsor's name, e.g. a company"),
  note: z.string().max(500).optional().describe("A short note printed on the invoice"),
  send: z.boolean().optional().describe("Send it to the sponsor once approved (default true)"),
});

const ListInvoicesInput = z.object({ status: z.enum(["draft", "sent", "paid", "cancelled"]).optional() });
const ProposeSendInvoiceInput = z.object({ sponsorInvoiceId: z.string().describe("An invoice id from list_invoices") });

type InvoiceRow = typeof sponsorInvoices.$inferSelect;

/** The database reads and the one write (A's proposeAction), injectable for tests. Reads are scoped to one org. */
export interface ToolDeps {
  needIds(orgId: string, f: { status?: string; category?: string }): Promise<string[]>;
  invoices(orgId: string, f: { status?: string }): Promise<InvoiceRow[]>;
  propose: typeof core.proposeAction;
}

export const dbDeps: ToolDeps = {
  propose: (input) => core.proposeAction(input),
  async needIds(orgId, f) {
    const where: SQL[] = [eq(needs.orgId, orgId)];
    if (f.status) where.push(eq(needs.status, f.status));
    if (f.category) where.push(eq(needs.category, f.category));
    const rows = await core.db
      .select({ id: needs.id })
      .from(needs)
      .where(and(...where))
      .orderBy(desc(needs.urgency), asc(needs.createdAt))
      .limit(300);
    return rows.map((r) => r.id);
  },
  async invoices(orgId, f) {
    const where: SQL[] = [eq(sponsorInvoices.orgId, orgId)];
    if (f.status) where.push(eq(sponsorInvoices.status, f.status));
    return core.db
      .select()
      .from(sponsorInvoices)
      .where(and(...where))
      .orderBy(desc(sponsorInvoices.createdAt))
      .limit(MAX_LISTED_INVOICES);
  },
};

export function assistantTools(org: { id: string }, deps: ToolDeps = dbDeps): Record<string, AssistantTool> {
  async function propose(tool: MoneyTool, args: unknown, what: string): Promise<ToolOutcome> {
    try {
      const action = AgentAction.parse(await deps.propose({ orgId: org.id, tool, args, origin: "assistant" }));
      return {
        forModel: { actionId: action.id, status: "awaiting_human_approval", preview: action.preview },
        summary: `Prepared ${what} for your approval`,
        action,
      };
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      return { forModel: { error: err.message }, summary: `Couldn't prepare ${what}` };
    }
  }

  return {
    list_needs: {
      kind: "read",
      description:
        "List this charity's needs (max 50, most urgent first) with id, title, category, status and money raised/remaining in USD. Use it to find need ids before proposing an invoice.",
      inputSchema: ListNeedsInput,
      startSummary: "Looking up your needs…",
      async run(input) {
        const q = ListNeedsInput.parse(input);
        const ids = await deps.needIds(org.id, { status: q.status, category: q.category });
        const tokens = queryTokens(q.query ?? "");
        const cards = (await core.getNeedCards(ids)).filter((n) => n.orgId === org.id && matchesQuery(n, tokens));
        const shown = cards.slice(0, MAX_LISTED_NEEDS);
        return {
          forModel: {
            total: cards.length,
            needs: shown.map((n) => ({
              id: n.id,
              title: n.title,
              category: n.category,
              status: n.status,
              urgency: n.urgency,
              quantity: n.quantity,
              unit: n.unit,
              targetUsd: centsToUsdNumber(n.targetCents),
              fundedUsd: centsToUsdNumber(n.fundedCents),
              remainingUsd: centsToUsdNumber(n.remainingCents),
            })),
          },
          summary: `Looked up your needs · found ${plural(cards.length, "item", "items")}`,
        };
      },
    },

    list_invoices: {
      kind: "read",
      description: "List this charity's sponsor invoices (latest 20) with id, sponsor, status and amount in USD.",
      inputSchema: ListInvoicesInput,
      startSummary: "Looking up your invoices…",
      async run(input) {
        const q = ListInvoicesInput.parse(input);
        const rows = (await deps.invoices(org.id, { status: q.status })).filter((r) => r.orgId === org.id);
        return {
          forModel: {
            invoices: rows.map((r) => ({
              id: r.id,
              recipientName: r.recipientName,
              recipientEmail: r.recipientEmail,
              status: r.status,
              amountUsd: centsToUsdNumber(r.amountCents),
              needCount: r.needIds.length,
              createdAt: r.createdAt.toISOString(),
            })),
          },
          summary: `Looked up your invoices · found ${plural(rows.length, "invoice", "invoices")}`,
        };
      },
    },

    propose_invoice: {
      kind: "propose",
      description:
        "Propose a PayPal invoice to a sponsor for specific needs. It is NOT created until a staff member approves the card. The server computes the amount from the needs; never pass an amount.",
      inputSchema: ProposeInvoiceInput,
      startSummary: "Preparing an invoice for approval…",
      async run(input) {
        const args = CreateInvoiceArgs.safeParse(input);
        if (!args.success) {
          return {
            forModel: { error: `Invalid invoice details: ${issuesText(args.error)}` },
            summary: "Couldn't prepare the invoice",
          };
        }
        return propose("create_invoice", args.data, "an invoice");
      },
    },

    propose_send_invoice: {
      kind: "propose",
      description:
        "Propose sending an existing draft invoice to its sponsor. Nothing is sent until a staff member approves.",
      inputSchema: ProposeSendInvoiceInput,
      startSummary: "Preparing to send the invoice…",
      async run(input) {
        const args = SendInvoiceArgs.safeParse(input);
        if (!args.success) {
          return {
            forModel: { error: `Invalid invoice id: ${issuesText(args.error)}` },
            summary: "Couldn't prepare sending the invoice",
          };
        }
        return propose("send_invoice", args.data, "sending the invoice");
      },
    },
  };
}

/**
 * Money actions, step 1 of 3: PROPOSE (AGENT_A_BACKEND.md §8.7).
 *
 * proposeAction is the ONLY way an agent_actions row is created by the assistant. It:
 *   - validates the args with the shared MONEY_TOOL_ARGS schema
 *   - checks every id the args mention belongs to the caller's org
 *   - computes every amount on the server into `computed` (the AI never supplies amounts)
 *   - builds a human-readable `preview` showing every argument and every computed amount
 *   - inserts the row with status "proposed"
 * It NEVER calls PayPal. Approve/reject (Phase 8) run or discard the stored action with exactly these values.
 */
import {
  AgentAction,
  CreateInvoiceArgs,
  CreateRefundArgs,
  formatUsd,
  MONEY_TOOLS,
  SendInvoiceArgs,
  type ActionPreview,
  type MoneyTool,
} from "@needgrid/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { db } from "../db/client";
import { agentActions, allocations, donations, needs, sponsorInvoices, type AgentActionRow } from "../db/schema";
import { HttpError } from "../lib/http";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toAgentAction(r: AgentActionRow): AgentAction {
  return AgentAction.parse({
    id: r.id,
    tool: r.tool,
    args: r.args,
    computed: r.computed,
    preview: r.preview,
    status: r.status,
    origin: r.origin,
    result: r.result ?? null,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    decidedAt: iso(r.decidedAt),
    executedAt: iso(r.executedAt),
  });
}

const bad = (message: string) => new HttpError(400, "VALIDATION", message);

/** Zod issues → one short line (the assistant relays it to staff). */
const issues = (e: z.ZodError) =>
  e.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
    .join("; ");

interface Proposal {
  args: Record<string, unknown>;
  computed: Record<string, unknown>;
  preview: ActionPreview;
}

// ---------------------------------------------------------------------------------------------
// create_invoice: bill a sponsor for what's still needed on a list of needs
// ---------------------------------------------------------------------------------------------

async function planInvoice(orgId: string, raw: unknown): Promise<Proposal> {
  const parsed = CreateInvoiceArgs.safeParse(raw);
  if (!parsed.success) throw bad(`Invalid invoice details: ${issues(parsed.error)}`);
  const args = { ...parsed.data, needIds: [...new Set(parsed.data.needIds)] };

  const rows = await db
    .select({
      id: needs.id,
      title: needs.title,
      status: needs.status,
      // Written with explicit "needs"."id": in a single-table select drizzle prints ${needs.id} as a bare "id",
      // which inside this subquery would resolve to r.id and silently ignore every hold.
      remaining: sql<number>`greatest(0, "needs"."target_cents" - "needs"."funded_cents" - coalesce((
        select sum(r.amount_cents) from reservations r
        where r.need_id = "needs"."id" and r.status = 'active' and r.expires_at > now()
      ), 0))::int`,
    })
    .from(needs)
    .where(and(eq(needs.orgId, orgId), inArray(needs.id, args.needIds)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = args.needIds.filter((id) => !byId.has(id));
  if (missing.length) throw bad(`Not this charity's needs: ${missing.join(", ")}`);

  const notOpen = rows.filter((r) => r.status !== "open" && r.status !== "topping_up");
  if (notOpen.length) {
    throw bad(`These needs aren't taking donations: ${notOpen.map((r) => `"${r.title}" (${r.status})`).join(", ")}`);
  }

  // Keep the order staff asked for; skip needs that are already fully covered (by money or holds).
  const planned = args.needIds
    .map((id) => byId.get(id)!)
    .filter((r) => r.remaining > 0)
    .map((r) => ({ needId: r.id, title: r.title, amountCents: r.remaining }));
  const skipped = args.needIds.length - planned.length;
  if (planned.length === 0) throw bad("Every one of these needs is already fully funded or on hold");
  const totalCents = planned.reduce((s, p) => s + p.amountCents, 0);

  const sponsor = args.recipientName ? `${args.recipientName} (${args.recipientEmail})` : args.recipientEmail;
  const lines = [
    { label: "Sponsor", value: sponsor },
    ...planned.map((p) => ({ label: p.title, value: formatUsd(p.amountCents) })),
    ...(skipped ? [{ label: "Skipped", value: `${skipped} already covered` }] : []),
    { label: "Send to sponsor after approval", value: args.send ? "Yes" : "No, keep as draft" },
    ...(args.note ? [{ label: "Note on invoice", value: args.note }] : []),
    { label: "Total (computed by NeedGrid)", value: formatUsd(totalCents) },
  ];
  return {
    args,
    computed: { planned, totalCents },
    preview: {
      title: `Invoice ${args.recipientName ?? args.recipientEmail} for ${planned.length} item${planned.length === 1 ? "" : "s"}`,
      lines,
      totalCents,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// send_invoice: send an existing draft
// ---------------------------------------------------------------------------------------------

async function planSendInvoice(orgId: string, raw: unknown): Promise<Proposal> {
  const parsed = SendInvoiceArgs.safeParse(raw);
  if (!parsed.success) throw bad(`Invalid invoice id: ${issues(parsed.error)}`);
  const [inv] = await db
    .select()
    .from(sponsorInvoices)
    .where(and(eq(sponsorInvoices.id, parsed.data.sponsorInvoiceId), eq(sponsorInvoices.orgId, orgId)))
    .limit(1);
  if (!inv) throw bad("No such invoice for this charity");
  if (inv.status !== "draft") throw bad(`This invoice is already ${inv.status}`);
  const sponsor = inv.recipientName ? `${inv.recipientName} (${inv.recipientEmail})` : inv.recipientEmail;
  return {
    args: parsed.data,
    computed: { amountCents: inv.amountCents, recipientEmail: inv.recipientEmail },
    preview: {
      title: `Send the invoice to ${inv.recipientName ?? inv.recipientEmail}`,
      lines: [
        { label: "Sponsor", value: sponsor },
        { label: "Items", value: String(inv.needIds.length) },
        { label: "Amount", value: formatUsd(inv.amountCents) },
      ],
      totalCents: inv.amountCents,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// create_refund: give back what a donation can still give back
// ---------------------------------------------------------------------------------------------

/**
 * Refundable = unallocated money + the donation's net share of needs not yet bought (open/topping_up/funded).
 * Money on ordered/delivered needs has been spent and can't be refunded. Invoice donations are refunded by
 * the sponsor-invoice flow, not here.
 */
export async function refundableParts(donationId: string, ex: typeof db = db) {
  const [don] = await ex.select().from(donations).where(eq(donations.id, donationId)).limit(1);
  if (!don) return null;
  const perNeed = await ex
    .select({
      needId: allocations.needId,
      title: needs.title,
      status: needs.status,
      cents: sql<number>`sum(${allocations.amountCents})::int`,
    })
    .from(allocations)
    .innerJoin(needs, eq(needs.id, allocations.needId))
    .where(eq(allocations.donationId, donationId))
    .groupBy(allocations.needId, needs.title, needs.status)
    .having(sql`sum(${allocations.amountCents}) > 0`);
  const fromNeeds = perNeed
    .filter((p) => ["open", "topping_up", "funded"].includes(p.status))
    .map((p) => ({ kind: "need" as const, needId: p.needId, title: p.title, cents: p.cents }));
  const parts = [
    ...(don.unallocatedCents > 0 ? [{ kind: "unallocated" as const, cents: don.unallocatedCents }] : []),
    ...fromNeeds,
  ];
  return { donation: don, parts, refundCents: parts.reduce((s, p) => s + p.cents, 0) };
}

async function planRefund(orgId: string, raw: unknown): Promise<Proposal> {
  const parsed = CreateRefundArgs.safeParse(raw);
  if (!parsed.success) throw bad(`Invalid refund details: ${issues(parsed.error)}`);
  const found = await refundableParts(parsed.data.donationId);
  if (!found || found.donation.orgId !== orgId) throw bad("No such donation for this charity");
  const { donation, parts, refundCents } = found;
  if (donation.source !== "order" || !donation.captureId) {
    throw bad("Only PayPal checkout donations can be refunded here");
  }
  if (refundCents <= 0) throw bad("Nothing left to refund: this donation's items have already been bought");
  return {
    args: parsed.data,
    computed: { refundCents, captureId: donation.captureId, parts },
    preview: {
      title: `Refund ${formatUsd(refundCents)} to a donor`,
      lines: [
        {
          label: "Donation",
          value: `${formatUsd(donation.amountCents)} on ${donation.createdAt.toISOString().slice(0, 10)}`,
        },
        { label: "Reason", value: parsed.data.reason },
        ...parts.map((p) =>
          p.kind === "unallocated"
            ? { label: "Not yet assigned to an item", value: formatUsd(p.cents) }
            : { label: `From "${p.title}"`, value: formatUsd(p.cents) },
        ),
        { label: "Refund amount (computed by NeedGrid)", value: formatUsd(refundCents) },
      ],
      totalCents: refundCents,
    },
  };
}

// ---------------------------------------------------------------------------------------------

const PLANNERS: Record<MoneyTool, (orgId: string, args: unknown) => Promise<Proposal>> = {
  create_invoice: planInvoice,
  send_invoice: planSendInvoice,
  create_refund: planRefund,
};

export async function proposeAction(input: {
  orgId: string;
  tool: MoneyTool;
  args: unknown;
  origin: "assistant" | "system";
}): Promise<AgentAction> {
  if (!(MONEY_TOOLS as readonly string[]).includes(input.tool)) throw bad(`Unknown money tool ${input.tool}`);
  const p = await PLANNERS[input.tool](input.orgId, input.args);
  const [row] = await db
    .insert(agentActions)
    .values({
      orgId: input.orgId,
      tool: input.tool,
      args: p.args,
      computed: p.computed,
      preview: p.preview,
      status: "proposed",
      origin: input.origin,
    })
    .returning();
  return toAgentAction(row!);
}

export async function listAgentActions(orgId: string, status?: string): Promise<AgentAction[]> {
  const where = [eq(agentActions.orgId, orgId)];
  if (status) where.push(eq(agentActions.status, status));
  const rows = await db
    .select()
    .from(agentActions)
    .where(and(...where))
    .orderBy(desc(agentActions.createdAt))
    .limit(100);
  return rows.map(toAgentAction);
}

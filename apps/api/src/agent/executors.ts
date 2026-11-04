/**
 * Money actions, steps 2 and 3 of 3: APPROVE → RUN, or REJECT (AGENT_A_BACKEND.md §8.7).
 *
 * approveAction:
 *   1. one transaction: lock the action row (must be `proposed` and this org's), then the tool's `prepare` re-checks
 *      the stored amounts against the database and reserves what it needs (sponsor holds, a running-refund marker).
 *      Changed amounts → `failed` right here, nothing is sent to PayPal.            → status `approved`
 *   2. no transaction, no row locks: the tool's `run` calls PayPal with ONLY the stored args + computed values.
 *   3. one transaction: the tool's database changes (`apply`) and the final status   → `executed` | `failed`
 * If step 3 can't be saved after PayPal already acted, the action stays `approved` with an error saying so:
 * it must never look like nothing happened.
 *
 * rejectAction: `proposed` → `rejected`. Nothing runs.
 *
 * Nothing here reads amounts from the request or from the AI: approve takes no body.
 */
import {
  CreateInvoiceArgs,
  CreateRefundArgs,
  SendInvoiceArgs,
  type AgentAction,
  type MoneyTool,
} from "@needgrid/shared";
import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { publishNeedUpdated, type Executor } from "../core/needs";
import { db } from "../db/client";
import { agentActions, sponsorInvoices, type AgentActionRow } from "../db/schema";
import { invalidState, notFound } from "../lib/http";
import {
  AMOUNTS_CHANGED,
  createPayPalInvoice,
  InvoiceComputed,
  reserveSponsorInvoice,
  SendComputed,
  sendPayPalInvoice,
  type StepOutcome,
} from "../money/invoices";
import { withTxRetry } from "../money/ledger";
import { applyRefund, checkRefund, RefundComputed } from "../money/refunds";
import { refundsGateway } from "../paypal/refunds";
import { toAgentAction } from "./actions";

type Prepared<C> = { ok: true; ctx: C; touched?: string[] } | { ok: false; error: string };

interface ActionExecutor<C> {
  /** Inside the approve transaction (action row locked). Must not call PayPal. */
  prepare(tx: Executor, action: AgentActionRow): Promise<Prepared<C>>;
  /** Outside any transaction. Calls PayPal. Should not throw for PayPal failures (return `failed`). */
  run(action: AgentActionRow, ctx: C): Promise<StepOutcome>;
}

const STORED_INVALID = "This action's stored details are invalid; ask the assistant again.";

/** Parse what was stored at propose time. Anything that doesn't parse is never executed. */
function stored<A extends z.ZodType, C extends z.ZodType>(
  action: AgentActionRow,
  argsSchema: A,
  computedSchema: C,
): { args: z.output<A>; computed: z.output<C> } | null {
  const args = argsSchema.safeParse(action.args);
  const computed = computedSchema.safeParse(action.computed);
  return args.success && computed.success ? { args: args.data, computed: computed.data } : null;
}

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ---------------------------------------------------------------------------------------------

const createInvoice: ActionExecutor<{ sponsorInvoiceId: string; send: boolean; note: string | null }> = {
  async prepare(tx, action) {
    const s = stored(action, CreateInvoiceArgs, InvoiceComputed);
    if (!s) return { ok: false, error: STORED_INVALID };
    const r = await reserveSponsorInvoice(tx, { orgId: action.orgId, args: s.args, computed: s.computed });
    if (!r.ok) return r;
    return {
      ok: true,
      ctx: { sponsorInvoiceId: r.sponsorInvoiceId, send: s.args.send, note: s.args.note ?? null },
      touched: r.needIds,
    };
  },
  run: (_action, ctx) => createPayPalInvoice(ctx),
};

const sendInvoice: ActionExecutor<{ sponsorInvoiceId: string; paypalInvoiceId: string }> = {
  async prepare(tx, action) {
    const s = stored(action, SendInvoiceArgs, SendComputed);
    if (!s) return { ok: false, error: STORED_INVALID };
    const [inv] = await tx
      .select()
      .from(sponsorInvoices)
      .where(eq(sponsorInvoices.id, s.args.sponsorInvoiceId))
      .for("update");
    if (!inv || inv.orgId !== action.orgId) return { ok: false, error: "No such invoice for this charity." };
    if (inv.status !== "draft") return { ok: false, error: `This invoice is already ${inv.status}.` };
    if (inv.amountCents !== s.computed.amountCents || inv.recipientEmail !== s.computed.recipientEmail) {
      return { ok: false, error: AMOUNTS_CHANGED };
    }
    if (!inv.paypalInvoiceId)
      return { ok: false, error: "This draft was never created in PayPal; create a new invoice." };
    const [running] = await tx
      .select({ id: agentActions.id })
      .from(agentActions)
      .where(
        and(
          eq(agentActions.tool, "send_invoice"),
          eq(agentActions.status, "approved"),
          sql`${agentActions.args}->>'sponsorInvoiceId' = ${inv.id}`,
        ),
      )
      .limit(1);
    if (running) return { ok: false, error: "This invoice is already being sent." };
    return { ok: true, ctx: { sponsorInvoiceId: inv.id, paypalInvoiceId: inv.paypalInvoiceId } };
  },
  run: (_action, ctx) => sendPayPalInvoice({ ...ctx, releaseIfUnsent: false }),
};

const createRefund: ActionExecutor<{ captureId: string; donationId: string } & RefundComputed & { note: string }> = {
  async prepare(tx, action) {
    const s = stored(action, CreateRefundArgs, RefundComputed);
    if (!s) return { ok: false, error: STORED_INVALID };
    const c = await checkRefund(tx, {
      orgId: action.orgId,
      actionId: action.id,
      donationId: s.args.donationId,
      computed: s.computed,
    });
    if (!c.ok) return c;
    return {
      ok: true,
      ctx: { ...s.computed, captureId: c.captureId, donationId: s.args.donationId, note: s.args.reason },
    };
  },
  async run(action, ctx) {
    let refund;
    try {
      refund = await refundsGateway().refundCapture({
        actionId: action.id,
        captureId: ctx.captureId,
        amountCents: ctx.refundCents,
        noteToPayer: ctx.note,
      });
    } catch (err) {
      return { status: "failed", error: `PayPal couldn't refund this: ${reason(err)}. No money was moved.` };
    }
    if (refund.status !== "COMPLETED" && refund.status !== "PENDING") {
      return { status: "failed", error: `PayPal answered ${refund.status} for this refund. No money was moved.` };
    }
    if (refund.amountCents !== ctx.refundCents) {
      // Shouldn't happen (we sent the amount). Record what PayPal says it refunded, and say so.
      console.error(
        `[refunds] PayPal refunded ${refund.amountCents}, expected ${ctx.refundCents} (${refund.refundId})`,
      );
    }
    return {
      status: "executed",
      apply: async (tx) => ({
        touched: await applyRefund(tx, { donationId: ctx.donationId, parts: ctx.parts, refundCents: ctx.refundCents }),
        result: {
          refundId: refund.refundId,
          status: refund.status,
          refundCents: ctx.refundCents,
          donationId: ctx.donationId,
        },
      }),
    };
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EXECUTORS: Record<MoneyTool, ActionExecutor<any>> = {
  create_invoice: createInvoice,
  send_invoice: sendInvoice,
  create_refund: createRefund,
};

// ---------------------------------------------------------------------------------------------

async function lockActionForOrg(tx: Executor, actionId: string, orgId: string): Promise<AgentActionRow> {
  const [row] = await tx.select().from(agentActions).where(eq(agentActions.id, actionId)).for("update");
  if (!row || row.orgId !== orgId) throw notFound("Action");
  if (row.status !== "proposed") throw invalidState(`This action is already ${row.status}`);
  return row;
}

const publishAll = async (needIds: Iterable<string>) => {
  for (const id of new Set(needIds)) await publishNeedUpdated(id);
};

export async function approveAction(orgId: string, actionId: string): Promise<AgentAction> {
  // 1. Decide + prepare, atomically.
  const step1 = await withTxRetry(() =>
    db.transaction(async (tx) => {
      const row = await lockActionForOrg(tx, actionId, orgId);
      const executor = EXECUTORS[row.tool as MoneyTool];
      const prepared = executor ? await executor.prepare(tx, row) : { ok: false as const, error: STORED_INVALID };
      if (!prepared.ok) {
        const [failed] = await tx
          .update(agentActions)
          .set({ status: "failed", error: prepared.error, decidedAt: sql`now()` })
          .where(eq(agentActions.id, row.id))
          .returning();
        return { row: failed!, executor: null, ctx: null, touched: [] as string[] };
      }
      const [approved] = await tx
        .update(agentActions)
        .set({ status: "approved", decidedAt: sql`now()` })
        .where(eq(agentActions.id, row.id))
        .returning();
      return { row: approved!, executor, ctx: prepared.ctx as unknown, touched: prepared.touched ?? [] };
    }),
  );
  await publishAll(step1.touched);
  if (!step1.executor) return toAgentAction(step1.row);

  // 2. PayPal, with no transaction open.
  let outcome: StepOutcome;
  try {
    outcome = await step1.executor.run(step1.row, step1.ctx);
  } catch (err) {
    // A bug or a database blip before/after the PayPal call. Holds (if any) stay in place: the safe side.
    console.error(`[actions] ${step1.row.tool} ${step1.row.id} crashed while running:`, err);
    outcome = { status: "failed", error: `Something went wrong while running this action: ${reason(err)}` };
  }

  // 3. Save the money effects and the final status together.
  try {
    const done = await withTxRetry(() =>
      db.transaction(async (tx) => {
        const applied = outcome.apply ? await outcome.apply(tx) : {};
        const [row] = await tx
          .update(agentActions)
          .set({
            status: outcome.status,
            error: outcome.status === "failed" ? (outcome.error ?? "Failed") : null,
            result: outcome.status === "executed" ? (applied.result ?? null) : null,
            executedAt: outcome.status === "executed" ? sql`now()` : null,
          })
          .where(and(eq(agentActions.id, actionId), eq(agentActions.status, "approved")))
          .returning();
        if (!row) throw new Error(`action ${actionId} is no longer approved`);
        return { row, touched: applied.touched ?? [] };
      }),
    );
    await publishAll(done.touched);
    return toAgentAction(done.row);
  } catch (err) {
    console.error(`[actions] couldn't save the result of ${step1.row.tool} ${actionId}:`, err);
    const note =
      outcome.status === "executed"
        ? `PayPal completed this, but NeedGrid couldn't save the result (${reason(err)}). Don't approve it again; ` +
          `ask the NeedGrid team to record it.`
        : `This failed (${outcome.error ?? "unknown"}), and NeedGrid couldn't save that (${reason(err)}).`;
    const [stuck] = await db
      .update(agentActions)
      .set({ error: note })
      .where(and(eq(agentActions.id, actionId), eq(agentActions.status, "approved")))
      .returning()
      .catch(() => [undefined]);
    if (stuck) return toAgentAction(stuck);
    throw err;
  }
}

export async function rejectAction(orgId: string, actionId: string): Promise<AgentAction> {
  const row = await withTxRetry(() =>
    db.transaction(async (tx) => {
      const locked = await lockActionForOrg(tx, actionId, orgId);
      const [rejected] = await tx
        .update(agentActions)
        .set({ status: "rejected", decidedAt: sql`now()` })
        .where(eq(agentActions.id, locked.id))
        .returning();
      return rejected!;
    }),
  );
  return toAgentAction(row);
}

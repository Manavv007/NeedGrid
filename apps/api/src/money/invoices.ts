/**
 * Sponsor invoices (AGENT_A_BACKEND.md §8.6): what runs when staff approve a create_invoice / send_invoice action.
 *
 *   reserve (inside the approve transaction): re-read every need's remaining amount. If any differs from what was
 *     proposed, nothing happens ("Amounts changed…"). Otherwise insert the sponsor_invoices row (draft) and one
 *     sponsor hold per need (14 days), so donors can't fund the same tiles twice while the sponsor pays.
 *   then, outside any transaction (never hold row locks while calling PayPal):
 *     create the PayPal invoice → (if send) send it → QR code.
 *     A failure before the invoice reaches the sponsor releases the holds and cancels our row.
 *     Once PayPal has sent it, the holds stay: the sponsor may pay at any time (a missing QR code is only a warning).
 *
 * Paying the invoice (INVOICING.INVOICE.PAID → allocations with reason `sponsor`) is Phase 9.
 */
import type { CreateInvoiceArgs } from "@needgrid/shared";
import { SponsorInvoiceView } from "@needgrid/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Executor } from "../core/needs";
import { db } from "../db/client";
import { organizations, reservations, sponsorInvoices, type SponsorInvoiceRow } from "../db/schema";
import { invoicesGateway } from "../paypal/invoices";
import { lockNeed, roomCents } from "./ledger";

export const AMOUNTS_CHANGED = "Amounts changed since this was proposed; ask the assistant again.";
export const SPONSOR_HOLD_DAYS = 14;

export const InvoiceComputed = z.object({
  planned: z.array(z.object({ needId: z.uuid(), title: z.string(), amountCents: z.number().int().positive() })).min(1),
  totalCents: z.number().int().positive(),
});
export type InvoiceComputed = z.infer<typeof InvoiceComputed>;

export const SendComputed = z.object({ amountCents: z.number().int().positive(), recipientEmail: z.string() });

export function toSponsorInvoiceView(r: SponsorInvoiceRow): SponsorInvoiceView {
  return SponsorInvoiceView.parse({
    id: r.id,
    paypalInvoiceId: r.paypalInvoiceId,
    recipientEmail: r.recipientEmail,
    recipientName: r.recipientName,
    needIds: r.needIds,
    amountCents: r.amountCents,
    status: r.status,
    payerViewUrl: r.payerViewUrl,
    qrImageDataUrl: r.qrImageDataUrl,
    createdAt: r.createdAt.toISOString(),
  });
}

type Reserved = { ok: true; sponsorInvoiceId: string; needIds: string[] } | { ok: false; error: string };

/** Inside the approve transaction. Locks the needs in id order (two approvals can't deadlock each other). */
export async function reserveSponsorInvoice(
  tx: Executor,
  p: { orgId: string; args: z.output<typeof CreateInvoiceArgs>; computed: InvoiceComputed },
): Promise<Reserved> {
  const { planned, totalCents } = p.computed;
  if (planned.reduce((s, x) => s + x.amountCents, 0) !== totalCents) {
    return { ok: false, error: "This proposal's amounts don't add up; ask the assistant again." };
  }
  for (const item of [...planned].sort((a, b) => (a.needId < b.needId ? -1 : 1))) {
    const need = await lockNeed(tx, item.needId);
    if (!need || need.orgId !== p.orgId) return { ok: false, error: AMOUNTS_CHANGED };
    if ((await roomCents(tx, need)) !== item.amountCents) return { ok: false, error: AMOUNTS_CHANGED };
  }
  const [inv] = await tx
    .insert(sponsorInvoices)
    .values({
      orgId: p.orgId,
      recipientEmail: p.args.recipientEmail,
      recipientName: p.args.recipientName ?? null,
      needIds: planned.map((x) => x.needId),
      planned,
      amountCents: totalCents,
      status: "draft",
    })
    .returning({ id: sponsorInvoices.id });
  await tx.insert(reservations).values(
    planned.map((x) => ({
      needId: x.needId,
      sponsorInvoiceId: inv!.id,
      amountCents: x.amountCents,
      rollOverConsent: true,
      expiresAt: sql`now() + interval '14 days'`, // SPONSOR_HOLD_DAYS
      status: "active",
    })),
  );
  return { ok: true, sponsorInvoiceId: inv!.id, needIds: planned.map((x) => x.needId) };
}

/** Cancel our invoice row and release its sponsor holds. Returns the needs to re-publish. */
export async function releaseSponsorInvoice(tx: Executor, sponsorInvoiceId: string): Promise<string[]> {
  await tx
    .update(sponsorInvoices)
    .set({ status: "cancelled" })
    .where(and(eq(sponsorInvoices.id, sponsorInvoiceId), eq(sponsorInvoices.status, "draft")));
  const released = await tx
    .update(reservations)
    .set({ status: "released" })
    .where(and(eq(reservations.sponsorInvoiceId, sponsorInvoiceId), eq(reservations.status, "active")))
    .returning({ needId: reservations.needId });
  return [...new Set(released.map((r) => r.needId))];
}

/** What a PayPal step produced; agent/executors.ts turns it into the action's final status. */
export interface StepOutcome {
  status: "executed" | "failed";
  error?: string;
  /** Database changes to make in the same transaction that sets the final action status. */
  apply?: (tx: Executor) => Promise<{ touched?: string[]; result?: unknown }>;
}

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function loadInvoice(ex: Executor, id: string): Promise<SponsorInvoiceRow> {
  const [inv] = await ex.select().from(sponsorInvoices).where(eq(sponsorInvoices.id, id)).limit(1);
  if (!inv) throw new Error(`sponsor invoice ${id} not found`);
  return inv;
}

const viewResult = async (ex: Executor, id: string) => ({
  sponsorInvoice: toSponsorInvoiceView(await loadInvoice(ex, id)),
});

/** create_invoice after reserve: PayPal create → (send → QR). */
export async function createPayPalInvoice(p: {
  sponsorInvoiceId: string;
  send: boolean;
  note: string | null;
}): Promise<StepOutcome> {
  const inv = await loadInvoice(db, p.sponsorInvoiceId);
  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, inv.orgId));
  let paypalInvoiceId: string;
  try {
    ({ invoiceId: paypalInvoiceId } = await invoicesGateway().createInvoice({
      sponsorInvoiceId: inv.id,
      orgName: org?.name ?? "NeedGrid charity",
      recipientEmail: inv.recipientEmail,
      recipientName: inv.recipientName,
      note: p.note,
      items: inv.planned.map((x) => ({ title: x.title, amountCents: x.amountCents })),
    }));
  } catch (err) {
    return {
      status: "failed",
      error: `PayPal couldn't create the invoice: ${reason(err)}. The items are no longer on hold.`,
      apply: async (tx) => ({ touched: await releaseSponsorInvoice(tx, inv.id) }),
    };
  }
  // Saved straight away: if anything below fails we still know which PayPal invoice this is.
  await db.update(sponsorInvoices).set({ paypalInvoiceId }).where(eq(sponsorInvoices.id, inv.id));
  if (!p.send) return { status: "executed", apply: async (tx) => ({ result: await viewResult(tx, inv.id) }) };
  return sendPayPalInvoice({ sponsorInvoiceId: inv.id, paypalInvoiceId, releaseIfUnsent: true });
}

/**
 * Send → payer link → QR. `releaseIfUnsent`: create_invoice gives the holds back if PayPal certainly didn't send it;
 * send_invoice keeps its existing draft (and holds) as they were.
 */
export async function sendPayPalInvoice(p: {
  sponsorInvoiceId: string;
  paypalInvoiceId: string;
  releaseIfUnsent: boolean;
}): Promise<StepOutcome> {
  const gw = invoicesGateway();
  let payerViewUrl: string | null = null;
  try {
    ({ payerViewUrl } = await gw.sendInvoice(p.paypalInvoiceId));
  } catch (err) {
    // A timeout or 5xx doesn't tell us whether PayPal sent it. Ask before giving the holds back.
    let status: string | null;
    try {
      ({ status, payerViewUrl } = await gw.getInvoiceStatus(p.paypalInvoiceId));
    } catch {
      status = null;
    }
    if (status === null) {
      return {
        status: "failed",
        error:
          `PayPal didn't confirm whether the invoice was sent (${reason(err)}). The items stay on hold for this ` +
          `sponsor; check invoice ${p.paypalInvoiceId} in PayPal before trying again.`,
      };
    }
    if (status === "DRAFT") {
      if (!p.releaseIfUnsent) {
        return { status: "failed", error: `PayPal couldn't send the invoice: ${reason(err)}. It is still a draft.` };
      }
      await gw.deleteDraft(p.paypalInvoiceId).catch(() => undefined);
      return {
        status: "failed",
        error: `PayPal couldn't send the invoice: ${reason(err)}. The items are no longer on hold.`,
        apply: async (tx) => ({ touched: await releaseSponsorInvoice(tx, p.sponsorInvoiceId) }),
      };
    }
    // PayPal did send it: carry on as a success.
  }
  if (!payerViewUrl) {
    payerViewUrl = await gw
      .getInvoiceStatus(p.paypalInvoiceId)
      .then((s) => s.payerViewUrl)
      .catch(() => null);
  }
  // The invoice is with the sponsor now; a missing QR code must not undo that.
  const qr = await gw.generateQrCode(p.paypalInvoiceId).catch(() => null);
  return {
    status: "executed",
    apply: async (tx) => {
      await tx
        .update(sponsorInvoices)
        .set({ status: "sent", payerViewUrl, qrImageDataUrl: qr })
        .where(and(eq(sponsorInvoices.id, p.sponsorInvoiceId), inArray(sponsorInvoices.status, ["draft", "sent"])));
      return { result: await viewResult(tx, p.sponsorInvoiceId) };
    },
  };
}

/**
 * Needs: the NeedCard builder, timelines, org stats and the staff publish/edit rules.
 *
 * Every endpoint builds NeedCards through `needCardQuery` so held/remaining/donor numbers always agree.
 * `needs.status` and `needs.target_cents` are only changed here (and, from Phase 3, in money/).
 */
import {
  computeTargetCents,
  DeliveryView,
  formatUsd,
  MIN_DONATION_CENTS,
  NeedCard,
  OrgPublic,
  ProductSnapshot,
  PurchaseView,
  type Category,
  type DeliveryPublic,
  type NeedStatus,
  type OrgStats,
  type PatchNeedReq,
  type PublishNeedReq,
  type TimelineEvent,
} from "@needgrid/shared";
import { and, asc, desc, eq, gt, inArray, ne, notInArray, sql, type SQL } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { embedNeedText } from "../ai";
import { db } from "../db/client";
import type * as schema from "../db/schema";
import {
  allocations,
  deliveries,
  donations,
  EMBEDDING_DIMENSIONS,
  needs,
  organizations,
  purchases,
  reservations,
  type DeliveryRow,
  type NeedRow,
  type NewNeedRow,
  type OrganizationRow,
  type PurchaseRow,
} from "../db/schema";
import { emitNeedUpdated } from "../lib/events";
import { HttpError, invalidState, notFound } from "../lib/http";

/** The app's db or a transaction. */
export type Executor = PgDatabase<NodePgQueryResultHKT, typeof schema>;

const DONATABLE: NeedStatus[] = ["open", "topping_up"];
/** Statuses hidden from the public site. */
const NOT_PUBLIC: NeedStatus[] = ["draft", "closed"];

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

// ---------------------------------------------------------------------------------------------
// NeedCard
// ---------------------------------------------------------------------------------------------

/** Sum of active, unexpired holds on the need in the current row (correlated subquery). */
export const heldCentsSql = sql<number>`coalesce((
  select sum(r.amount_cents) from reservations r
  where r.need_id = ${needs.id} and r.status = 'active' and r.expires_at > now()
), 0)::int`;

/** Distinct donations whose net allocation to the need is positive. */
const donorCountSql = sql<number>`(
  select count(*) from (
    select a.donation_id from allocations a where a.need_id = ${needs.id}
    group by a.donation_id having sum(a.amount_cents) > 0
  ) d
)::int`;

/** "Most urgent" ordering (AGENT_A_BACKEND.md §5.2 comment on URGENCY_MIN). */
export const mostUrgentOrder: SQL[] = [
  desc(needs.urgency),
  sql`${needs.deadlineAt} asc nulls last`,
  asc(needs.createdAt),
];

const cardColumns = {
  id: needs.id,
  orgId: needs.orgId,
  orgSlug: organizations.slug,
  title: needs.title,
  description: needs.description,
  category: needs.category,
  urgency: needs.urgency,
  quantity: needs.quantity,
  unit: needs.unit,
  status: needs.status,
  targetCents: needs.targetCents,
  fundedCents: needs.fundedCents,
  heldCents: heldCentsSql,
  donorCount: donorCountSql,
  product: needs.product,
  deadlineAt: needs.deadlineAt,
  createdAt: needs.createdAt,
  updatedAt: needs.updatedAt,
};

function needCardQuery(ex: Executor) {
  return ex.select(cardColumns).from(needs).innerJoin(organizations, eq(organizations.id, needs.orgId));
}

type CardRow = Awaited<ReturnType<typeof needCardQuery>>[number];

/** Parsed with the shared schema, so bad data fails loudly here instead of in the browser. */
function toNeedCard(r: CardRow): NeedCard {
  return NeedCard.parse({
    id: r.id,
    orgId: r.orgId,
    orgSlug: r.orgSlug,
    title: r.title,
    description: r.description,
    category: r.category as Category,
    urgency: r.urgency,
    quantity: r.quantity,
    unit: r.unit,
    status: r.status as NeedStatus,
    targetCents: r.targetCents,
    fundedCents: r.fundedCents,
    heldCents: r.heldCents,
    remainingCents: Math.max(0, r.targetCents - r.fundedCents - r.heldCents),
    donorCount: r.donorCount,
    product: r.product ?? null,
    deadlineAt: isoOrNull(r.deadlineAt),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  });
}

export async function getNeedCard(needId: string, ex: Executor = db): Promise<NeedCard | null> {
  const rows = await needCardQuery(ex).where(eq(needs.id, needId)).limit(1);
  return rows[0] ? toNeedCard(rows[0]) : null;
}

/** Cards in the same order as `needIds`; unknown ids are skipped. */
export async function getNeedCards(needIds: string[], ex: Executor = db): Promise<NeedCard[]> {
  if (needIds.length === 0) return [];
  const rows = await needCardQuery(ex).where(inArray(needs.id, needIds));
  const byId = new Map(rows.map((r) => [r.id, toNeedCard(r)]));
  return needIds.flatMap((id) => byId.get(id) ?? []);
}

/** Open/topping_up needs with remainingCents > 0, most urgent first. orgId undefined = all orgs. */
export async function listDonatableNeeds(
  opts: { orgId?: string; limit?: number; excludeNeedId?: string } = {},
  ex: Executor = db,
): Promise<NeedCard[]> {
  const conditions: SQL[] = [
    inArray(needs.status, DONATABLE),
    sql`${needs.targetCents} - ${needs.fundedCents} - ${heldCentsSql} > 0`,
  ];
  if (opts.orgId) conditions.push(eq(needs.orgId, opts.orgId));
  if (opts.excludeNeedId) conditions.push(ne(needs.id, opts.excludeNeedId));
  const rows = await needCardQuery(ex)
    .where(and(...conditions))
    .orderBy(...mostUrgentOrder)
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  return rows.map(toNeedCard);
}

export async function getNextMostUrgentNeed(
  orgId: string,
  excludeNeedId?: string,
  ex: Executor = db,
): Promise<NeedCard | null> {
  const [card] = await listDonatableNeeds({ orgId, excludeNeedId, limit: 1 }, ex);
  return card ?? null;
}

export async function setNeedEmbedding(needId: string, embedding: number[]): Promise<void> {
  if (embedding.length !== EMBEDDING_DIMENSIONS || !embedding.every(Number.isFinite)) {
    throw new Error(`embedding must be ${EMBEDDING_DIMENSIONS} finite numbers, got ${embedding.length}`);
  }
  await db.update(needs).set({ embedding }).where(eq(needs.id, needId));
}

/** Push the need's current card to every open tile wall. Never throws (a failed broadcast must not fail a request). */
export async function publishNeedUpdated(needId: string): Promise<void> {
  try {
    const card = await getNeedCard(needId);
    if (card && card.status !== "draft") emitNeedUpdated(card);
  } catch (err) {
    console.error("[events] publishNeedUpdated failed:", (err as Error).message);
  }
}

// ---------------------------------------------------------------------------------------------
// Orgs
// ---------------------------------------------------------------------------------------------

export function toOrgPublic(o: OrganizationRow): OrgPublic {
  return OrgPublic.parse({
    id: o.id,
    slug: o.slug,
    name: o.name,
    city: o.city,
    description: o.description,
    causeTags: o.causeTags,
    logoUrl: o.logoUrl,
  });
}

/** Stats for every org in one pass (two grouped queries). */
export async function getOrgStats(orgIds: string[], ex: Executor = db): Promise<Map<string, OrgStats>> {
  const out = new Map<string, OrgStats>(
    orgIds.map((id) => [id, { raisedCents: 0, itemsFunded: 0, itemsDelivered: 0, openNeeds: 0 }]),
  );
  if (orgIds.length === 0) return out;
  const counts = await ex
    .select({
      orgId: needs.orgId,
      itemsFunded: sql<number>`count(*) filter (where ${needs.status} in ('funded','ordered','delivered'))::int`,
      itemsDelivered: sql<number>`count(*) filter (where ${needs.status} = 'delivered')::int`,
      openNeeds: sql<number>`count(*) filter (where ${needs.status} in ('open','topping_up'))::int`,
    })
    .from(needs)
    .where(inArray(needs.orgId, orgIds))
    .groupBy(needs.orgId);
  const raised = await ex
    .select({
      orgId: donations.orgId,
      raisedCents: sql<number>`coalesce(sum(${donations.amountCents} - ${donations.refundedCents}), 0)::int`,
    })
    .from(donations)
    .where(inArray(donations.orgId, orgIds))
    .groupBy(donations.orgId);
  for (const c of counts) {
    const s = out.get(c.orgId)!;
    s.itemsFunded = c.itemsFunded;
    s.itemsDelivered = c.itemsDelivered;
    s.openNeeds = c.openNeeds;
  }
  for (const r of raised) out.get(r.orgId)!.raisedCents = r.raisedCents;
  return out;
}

export async function listOrgSummaries() {
  const orgs = await db.select().from(organizations).orderBy(asc(organizations.name));
  const stats = await getOrgStats(orgs.map((o) => o.id));
  return orgs.map((o) => ({ ...toOrgPublic(o), stats: stats.get(o.id)! }));
}

export async function getOrgPage(slug: string) {
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
  if (!org) throw notFound("Charity");
  const stats = (await getOrgStats([org.id])).get(org.id)!;
  const rows = await needCardQuery(db)
    .where(and(eq(needs.orgId, org.id), notInArray(needs.status, NOT_PUBLIC)))
    .orderBy(...mostUrgentOrder);
  return { org: toOrgPublic(org), stats, needs: rows.map(toNeedCard) };
}

// ---------------------------------------------------------------------------------------------
// Timeline, purchases, deliveries
// ---------------------------------------------------------------------------------------------

export function toPurchaseView(p: PurchaseRow): PurchaseView {
  return PurchaseView.parse({
    id: p.id,
    needId: p.needId,
    status: p.status,
    offer: p.offer,
    newTargetCents: p.newTargetCents,
    explanation: p.explanation,
    flags: p.flags,
    orderRef: p.orderRef,
    createdAt: iso(p.createdAt),
    approvedAt: isoOrNull(p.approvedAt),
    orderedAt: isoOrNull(p.orderedAt),
  });
}

export function toDeliveryView(d: DeliveryRow): DeliveryView {
  return DeliveryView.parse({
    id: d.id,
    needId: d.needId,
    photoUrl: d.photoUrl,
    matchScore: d.matchScore,
    aiNotes: d.aiNotes,
    needsReview: d.needsReview,
    message: d.message,
    createdAt: iso(d.createdAt),
    confirmedAt: isoOrNull(d.confirmedAt),
  });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Timeline for one need, oldest first. Built from the need's timestamps, purchases and allocations. */
export async function buildTimeline(need: NeedRow, ex: Executor = db): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [
    { type: "created", at: iso(need.createdAt), label: "Need posted", amountCents: null },
  ];

  // Donations grouped per UTC day: "3 donors gave $42.00".
  const days = await ex
    .select({
      at: sql<Date>`min(${allocations.createdAt})`.mapWith(allocations.createdAt),
      donors: sql<number>`count(distinct ${allocations.donationId})::int`,
      cents: sql<number>`sum(${allocations.amountCents})::int`,
    })
    .from(allocations)
    .where(and(eq(allocations.needId, need.id), gt(allocations.amountCents, 0)))
    .groupBy(sql`date_trunc('day', ${allocations.createdAt} at time zone 'UTC')`);
  for (const d of days) {
    events.push({
      type: "donation",
      at: iso(d.at),
      label: `${plural(d.donors, "donor", "donors")} gave ${formatUsd(d.cents)}`,
      amountCents: d.cents,
    });
  }

  if (need.fundedAt) {
    events.push({ type: "funded", at: iso(need.fundedAt), label: "Fully funded", amountCents: need.fundedCents });
  }

  const approved = await ex
    .select()
    .from(purchases)
    .where(and(eq(purchases.needId, need.id), inArray(purchases.status, ["approved", "ordered"])))
    .orderBy(asc(purchases.approvedAt));
  for (const p of approved) {
    if (!p.approvedAt) continue;
    events.push({
      type: "purchase_approved",
      at: iso(p.approvedAt),
      label: `Purchase approved at ${p.offer.retailer}`,
      amountCents: null,
    });
  }
  const lastApproval = approved.at(-1)?.approvedAt;
  if (need.status === "topping_up" && lastApproval) {
    const gap = Math.max(0, need.targetCents - need.fundedCents);
    events.push({
      type: "topping_up",
      at: iso(lastApproval),
      label: `The price went up: ${formatUsd(gap)} more needed`,
      amountCents: gap,
    });
  }

  if (need.orderedAt) events.push({ type: "ordered", at: iso(need.orderedAt), label: "Ordered", amountCents: null });
  if (need.deliveredAt) {
    events.push({ type: "delivered", at: iso(need.deliveredAt), label: "Arrived", amountCents: null });
  }
  if (need.closedAt) events.push({ type: "closed", at: iso(need.closedAt), label: "Closed", amountCents: null });

  // Stable sort keeps same-timestamp events in the logical order pushed above.
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

/** Latest delivery that donors may see (passed the AI check or was confirmed by staff). */
async function publicDelivery(need: NeedRow, ex: Executor): Promise<DeliveryPublic | null> {
  if (need.status !== "delivered") return null;
  const [d] = await ex
    .select()
    .from(deliveries)
    .where(
      and(
        eq(deliveries.needId, need.id),
        sql`(${deliveries.needsReview} = false or ${deliveries.confirmedAt} is not null)`,
      ),
    )
    .orderBy(desc(deliveries.createdAt))
    .limit(1);
  return d ? { photoUrl: d.photoUrl, message: d.message, deliveredAt: iso(d.confirmedAt ?? d.createdAt) } : null;
}

// ---------------------------------------------------------------------------------------------
// Detail views
// ---------------------------------------------------------------------------------------------

/** Public need page. Drafts are not public (404). */
export async function getPublicNeedDetail(needId: string) {
  const [row] = await db
    .select({ need: needs, org: organizations })
    .from(needs)
    .innerJoin(organizations, eq(organizations.id, needs.orgId))
    .where(eq(needs.id, needId))
    .limit(1);
  if (!row || row.need.status === "draft") throw notFound("Need");
  const [card, timeline, delivery] = await Promise.all([
    getNeedCard(needId),
    buildTimeline(row.need),
    publicDelivery(row.need, db),
  ]);
  return { need: card!, org: toOrgPublic(row.org), timeline, delivery };
}

/** Staff need page. Another org's need is reported as not found (don't leak existence). */
export async function getStaffNeedDetail(orgId: string, needId: string) {
  const [need] = await db
    .select()
    .from(needs)
    .where(and(eq(needs.id, needId), eq(needs.orgId, orgId)))
    .limit(1);
  if (!need) throw notFound("Need");
  const [card, timeline, purchaseRows, deliveryRows] = await Promise.all([
    getNeedCard(needId),
    buildTimeline(need),
    db.select().from(purchases).where(eq(purchases.needId, needId)).orderBy(desc(purchases.createdAt)),
    db.select().from(deliveries).where(eq(deliveries.needId, needId)).orderBy(desc(deliveries.createdAt)).limit(1),
  ]);
  return {
    need: card!,
    alternatives: need.alternatives.map((a) => ProductSnapshot.parse(a)),
    purchases: purchaseRows.map(toPurchaseView),
    delivery: deliveryRows[0] ? toDeliveryView(deliveryRows[0]) : null,
    timeline,
  };
}

export async function listStaffNeeds(orgId: string, status?: NeedStatus): Promise<NeedCard[]> {
  const conditions: SQL[] = [eq(needs.orgId, orgId)];
  if (status) conditions.push(eq(needs.status, status));
  const rows = await needCardQuery(db)
    .where(and(...conditions))
    .orderBy(desc(needs.updatedAt));
  return rows.map(toNeedCard);
}

// ---------------------------------------------------------------------------------------------
// Staff writes: publish + edit
// ---------------------------------------------------------------------------------------------

function assertMinTarget(targetCents: number) {
  if (targetCents < MIN_DONATION_CENTS) {
    throw new HttpError(400, "VALIDATION", `The target must be at least ${formatUsd(MIN_DONATION_CENTS)}`);
  }
}

/** POST /api/staff/needs. Target = staff override or unit price × quantity + 8%, rounded up to the dollar. */
export async function createNeed(orgId: string, req: PublishNeedReq): Promise<NeedCard> {
  const targetCents = req.targetCents ?? computeTargetCents(req.product.unitPriceCents, req.quantity);
  assertMinTarget(targetCents);
  const [row] = await db
    .insert(needs)
    .values({
      orgId,
      title: req.title,
      description: req.description,
      category: req.category,
      urgency: req.urgency,
      quantity: req.quantity,
      unit: req.unit,
      status: req.publish ? "open" : "draft",
      targetCents,
      product: req.product,
      alternatives: req.alternatives,
      deadlineAt: req.deadlineAt ? new Date(req.deadlineAt) : null,
    })
    .returning({ id: needs.id });
  const needId = row!.id;

  // Embedding for Match me (B). Optional: publishing never fails because of it.
  try {
    const embedding = await embedNeedText({
      title: req.title,
      description: req.description,
      category: req.category,
      unit: req.unit,
    });
    if (embedding) await setNeedEmbedding(needId, embedding);
  } catch (err) {
    console.error("[needs] embedding skipped:", (err as Error).message);
  }

  await publishNeedUpdated(needId);
  return (await getNeedCard(needId))!;
}

const EDITABLE_TARGET: NeedStatus[] = ["draft", "open", "topping_up", "funded"];
const PRE_FUNDING: NeedStatus[] = ["draft", "open", "topping_up"];

/**
 * PATCH /api/staff/needs/:id. Runs in one transaction with the need row locked (same lock the
 * checkout uses), so target/quantity checks can't race a donation.
 *
 * Rules:
 * - delivered and closed needs can't be edited
 * - quantity: only while nothing is funded or on hold
 * - product swap: only before the item is funded (draft/open/topping_up)
 * - target: draft/open/topping_up/funded only, ≥ $1, never below funded + held.
 *   Without an explicit target, a quantity or product change recomputes it.
 * - status "open": publishes a draft (needs a product); "closed": only when no money is attached
 *   (refunds/roll-over for funded needs are P1 and go through the assistant)
 * - afterwards funded/open is re-derived: funded ≥ target → funded, funded < target → open
 */
export async function patchNeed(orgId: string, needId: string, patch: PatchNeedReq): Promise<NeedCard> {
  await db.transaction(async (tx) => {
    const [need] = await tx
      .select()
      .from(needs)
      .where(and(eq(needs.id, needId), eq(needs.orgId, orgId)))
      .for("update");
    if (!need) throw notFound("Need");
    const status = need.status as NeedStatus;
    if (status === "delivered" || status === "closed") throw invalidState(`A ${status} need can't be edited`);

    const [{ held } = { held: 0 }] = await tx
      .select({ held: sql<number>`coalesce(sum(${reservations.amountCents}), 0)::int` })
      .from(reservations)
      .where(
        and(eq(reservations.needId, needId), eq(reservations.status, "active"), gt(reservations.expiresAt, sql`now()`)),
      );
    const moneyIn = need.fundedCents + held;

    const updates: Partial<NewNeedRow> = {};
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.description !== undefined) updates.description = patch.description;
    if (patch.urgency !== undefined) updates.urgency = patch.urgency;
    if (patch.deadlineAt !== undefined) updates.deadlineAt = patch.deadlineAt ? new Date(patch.deadlineAt) : null;

    const quantityChanged = patch.quantity !== undefined && patch.quantity !== need.quantity;
    if (quantityChanged) {
      if (moneyIn > 0) throw invalidState("The quantity can't change once donations have started");
      updates.quantity = patch.quantity;
    }
    if (patch.product) {
      if (!PRE_FUNDING.includes(status))
        throw invalidState("The product can only be changed before the item is funded");
      updates.product = patch.product;
    }

    const product = patch.product ?? need.product;
    const quantity = patch.quantity ?? need.quantity;
    let targetCents = need.targetCents;
    if (patch.targetCents !== undefined) targetCents = patch.targetCents;
    else if ((quantityChanged || patch.product) && product)
      targetCents = computeTargetCents(product.unitPriceCents, quantity);

    if (targetCents !== need.targetCents) {
      if (!EDITABLE_TARGET.includes(status)) throw invalidState(`The target can't change once the item is ${status}`);
      assertMinTarget(targetCents);
      if (targetCents < moneyIn) {
        throw invalidState(`The target can't be below what's already raised or on hold (${formatUsd(moneyIn)})`, {
          minTargetCents: moneyIn,
        });
      }
      updates.targetCents = targetCents;
    }

    let nextStatus: NeedStatus = status;
    if (patch.status === "open" && status !== "open") {
      if (status !== "draft") throw invalidState(`Only a draft can be published (this need is ${status})`);
      if (!product) throw invalidState("Choose a product before publishing");
      nextStatus = "open";
    }
    if (patch.status === "closed") {
      if (moneyIn > 0) {
        throw invalidState("This need has donations attached, so it can't be closed yet");
      }
      nextStatus = "closed";
      updates.closedAt = new Date();
    }

    // Re-derive funded/open after a target change.
    if (
      (nextStatus === "open" || nextStatus === "topping_up") &&
      need.fundedCents > 0 &&
      need.fundedCents >= targetCents
    ) {
      nextStatus = "funded";
      updates.fundedAt = need.fundedAt ?? new Date();
    } else if (nextStatus === "funded" && need.fundedCents < targetCents) {
      nextStatus = "open";
    }
    if (nextStatus !== status) updates.status = nextStatus;

    if (Object.keys(updates).length > 0) {
      await tx.update(needs).set(updates).where(eq(needs.id, needId));
    }
  });

  await publishNeedUpdated(needId);
  return (await getNeedCard(needId))!;
}

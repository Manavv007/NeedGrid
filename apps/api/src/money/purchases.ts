/**
 * Purchases (AGENT_A_BACKEND.md §8.5, money rule 7).
 *
 *   proposed  → created by B's purchase-plan route through createProposedPurchase (need must be `funded`)
 *   approved  → approvePurchase: the target becomes the new price; the money is settled right here:
 *                 exact   → nothing to move
 *                 surplus → the extra is taken back from donations (newest first) and given to the org's most
 *                           urgent open needs (reason price_drop, paired −/+ allocation rows). Money with nowhere
 *                           to go stays on this need.
 *                 gap     → the need goes to `topping_up` and accepts donations again until funded
 *   ordered   → markPurchaseOrdered: staff bought it and typed the retailer's order number (need must be `funded`)
 *
 * Every amount comes from the stored purchase and the database, never from the browser or the AI.
 */
import {
  ApprovePurchaseRes,
  computeTargetCents,
  formatUsd,
  planPurchaseMoney,
  PurchaseOffer,
  PurchaseRes,
  takeFromAllocations,
  type ProductSnapshot,
  type PurchaseView,
} from "@needgrid/shared";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { getNeedCard, planSummary, publishNeedUpdated, toPurchaseView, type Executor } from "../core/needs";
import { db } from "../db/client";
import { allocations, needs, purchases, type NeedRow, type PurchaseRow } from "../db/schema";
import { invalidState, notFound } from "../lib/http";
import { allocate, distribute, lockNeed, withTxRetry } from "./ledger";

async function lockPurchase(tx: Executor, purchaseId: string): Promise<PurchaseRow | undefined> {
  const [p] = await tx.select().from(purchases).where(eq(purchases.id, purchaseId)).for("update");
  return p;
}

async function hasApprovedPurchase(tx: Executor, needId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: purchases.id })
    .from(purchases)
    .where(and(eq(purchases.needId, needId), inArray(purchases.status, ["approved", "ordered"])))
    .limit(1);
  return Boolean(row);
}

/** Lock purchase + its need, and check the need belongs to `orgId` (another org's purchase is "not found"). */
async function lockPurchaseForOrg(tx: Executor, purchaseId: string, orgId: string) {
  const purchase = await lockPurchase(tx, purchaseId);
  if (!purchase) throw notFound("Purchase");
  const need = await lockNeed(tx, purchase.needId);
  if (!need || need.orgId !== orgId) throw notFound("Purchase");
  return { purchase, need };
}

// ---------------------------------------------------------------------------------------------
// Propose (called by B's purchase-plan route via core)
// ---------------------------------------------------------------------------------------------

/**
 * Inserts a `proposed` purchase and supersedes older proposals for the need. The need must be `funded` and have no
 * approved purchase yet. newTargetCents = computeTargetCents(offer.unitPriceCents, need.quantity).
 */
export async function createProposedPurchase(input: {
  needId: string;
  offer: PurchaseOffer;
  explanation: string;
  flags: string[];
}): Promise<PurchaseView> {
  const offer = PurchaseOffer.parse(input.offer);
  const row = await withTxRetry(() =>
    db.transaction(async (tx) => {
      const need = await lockNeed(tx, input.needId);
      if (!need) throw notFound("Need");
      if (need.status !== "funded") throw invalidState(`Only a funded need can be bought (this one is ${need.status})`);
      if (await hasApprovedPurchase(tx, need.id)) {
        throw invalidState("A purchase is already approved for this need; mark it as ordered");
      }
      await tx
        .update(purchases)
        .set({ status: "superseded" })
        .where(and(eq(purchases.needId, need.id), eq(purchases.status, "proposed")));
      const [inserted] = await tx
        .insert(purchases)
        .values({
          needId: need.id,
          offer,
          newTargetCents: computeTargetCents(offer.unitPriceCents, need.quantity),
          explanation: input.explanation.slice(0, 1000),
          flags: input.flags.slice(0, 20).map((f) => f.slice(0, 200)),
          status: "proposed",
        })
        .returning();
      return inserted!;
    }),
  );
  const view = toPurchaseView(row);
  const card = await getNeedCard(row.needId);
  return { ...view, plan: card ? await planSummary(view, card) : null };
}

// ---------------------------------------------------------------------------------------------
// Approve
// ---------------------------------------------------------------------------------------------

/** The approved offer becomes the need's product (pack size kept when it's the same product). */
function offerAsProduct(offer: PurchaseOffer, previous: ProductSnapshot | null): ProductSnapshot {
  return {
    channel3Id: offer.channel3Id,
    title: offer.title,
    imageUrl: offer.imageUrl,
    retailer: offer.retailer,
    url: offer.url,
    unitPriceCents: offer.unitPriceCents,
    packSize: previous?.channel3Id === offer.channel3Id ? previous.packSize : null,
    inStock: offer.inStock,
    fetchedAt: new Date().toISOString(),
  };
}

interface SurplusMoves {
  /** Cents per receiving need, in placement order. */
  placed: Array<{ needId: string; cents: number }>;
  /** Couldn't be placed anywhere: stays on the need. */
  keptCents: number;
}

/** Take `cents` back from the need's donations (newest first) and give it to the org's most urgent open needs. */
async function moveSurplus(tx: Executor, need: NeedRow, cents: number): Promise<SurplusMoves> {
  const rows = await tx
    .select({
      donationId: allocations.donationId,
      amountCents: allocations.amountCents,
      createdAt: allocations.createdAt,
    })
    .from(allocations)
    .where(eq(allocations.needId, need.id))
    .orderBy(asc(allocations.createdAt));
  const takes = takeFromAllocations(
    rows.map((r) => ({ donationId: r.donationId, amountCents: r.amountCents, createdAt: r.createdAt.toISOString() })),
    cents,
  );

  const byNeed = new Map<string, number>();
  let keptCents = 0;
  for (const take of takes) {
    const outId = await allocate(tx, {
      donationId: take.donationId,
      needId: need.id,
      cents: -take.amountCents,
      reason: "price_drop",
    });
    const result = await distribute(tx, {
      donationId: take.donationId,
      orgId: need.orgId,
      cents: take.amountCents,
      reason: "price_drop",
      excludeNeedId: need.id,
      relatedAllocationId: outId,
    });
    for (const p of result.placed) byNeed.set(p.needId, (byNeed.get(p.needId) ?? 0) + p.cents);
    if (result.leftoverCents > 0) {
      // Nowhere to go: put that part back on this need (it stays with the item; staff can buy extra).
      await allocate(tx, {
        donationId: take.donationId,
        needId: need.id,
        cents: result.leftoverCents,
        reason: "price_drop",
        relatedAllocationId: outId,
      });
      keptCents += result.leftoverCents;
    }
  }
  return { placed: [...byNeed].map(([needId, c]) => ({ needId, cents: c })), keptCents };
}

/** POST /api/staff/purchases/:id/approve */
export async function approvePurchase(orgId: string, purchaseId: string): Promise<ApprovePurchaseRes> {
  const outcome = await withTxRetry(() =>
    db.transaction(async (tx) => {
      const { purchase, need } = await lockPurchaseForOrg(tx, purchaseId, orgId);
      if (purchase.status !== "proposed") throw invalidState(`This purchase is already ${purchase.status}`);
      if (need.status !== "funded") throw invalidState(`Only a funded need can be bought (this one is ${need.status})`);
      if (await hasApprovedPurchase(tx, need.id)) {
        throw invalidState("A purchase is already approved for this need; mark it as ordered");
      }

      const money = planPurchaseMoney(need.fundedCents, purchase.newTargetCents);
      // Target first: the −allocations below then never drop the need below its (new) target.
      await tx
        .update(needs)
        .set({ targetCents: purchase.newTargetCents, product: offerAsProduct(purchase.offer, need.product) })
        .where(eq(needs.id, need.id));

      let moves: SurplusMoves = { placed: [], keptCents: 0 };
      if (money.kind === "surplus") {
        moves = await moveSurplus(tx, { ...need, targetCents: purchase.newTargetCents }, money.cents);
      } else if (money.kind === "gap") {
        await tx.update(needs).set({ status: "topping_up" }).where(eq(needs.id, need.id));
      }

      await tx
        .update(purchases)
        .set({ status: "superseded" })
        .where(and(eq(purchases.needId, need.id), eq(purchases.status, "proposed"), ne(purchases.id, purchase.id)));
      const [approved] = await tx
        .update(purchases)
        .set({ status: "approved", approvedAt: sql`clock_timestamp()` })
        .where(eq(purchases.id, purchase.id))
        .returning();
      return { approved: approved!, needId: need.id, money, moves };
    }),
  );

  const { approved, needId, money, moves } = outcome;
  for (const id of [needId, ...moves.placed.map((p) => p.needId)]) await publishNeedUpdated(id);

  let surplusMoved: ApprovePurchaseRes["surplusMoved"] = null;
  if (moves.placed.length > 0) {
    const titles = new Map(
      (
        await db
          .select({ id: needs.id, title: needs.title })
          .from(needs)
          .where(
            inArray(
              needs.id,
              moves.placed.map((p) => p.needId),
            ),
          )
      ).map((r) => [r.id, r.title]),
    );
    const list = moves.placed.map((p) => ({
      needId: p.needId,
      needTitle: titles.get(p.needId) ?? "",
      amountCents: p.cents,
    }));
    surplusMoved = {
      toNeedId: list[0]!.needId,
      toNeedTitle: list[0]!.needTitle,
      amountCents: list.reduce((s, m) => s + m.amountCents, 0),
      moves: list,
    };
  }
  if (moves.keptCents > 0) {
    console.warn(`[purchases] ${formatUsd(moves.keptCents)} surplus had nowhere to go and stays on need ${needId}`);
  }

  return ApprovePurchaseRes.parse({
    purchase: { ...toPurchaseView(approved), plan: null },
    need: await getNeedCard(needId),
    surplusMoved,
    gapCents: money.kind === "gap" ? money.cents : null,
  });
}

// ---------------------------------------------------------------------------------------------
// Ordered
// ---------------------------------------------------------------------------------------------

/** POST /api/staff/purchases/:id/ordered */
export async function markPurchaseOrdered(orgId: string, purchaseId: string, orderRef: string): Promise<PurchaseRes> {
  const row = await withTxRetry(() =>
    db.transaction(async (tx) => {
      const { purchase, need } = await lockPurchaseForOrg(tx, purchaseId, orgId);
      if (purchase.status !== "approved") {
        throw invalidState(
          purchase.status === "ordered"
            ? "This purchase is already marked as ordered"
            : `Approve the purchase first (it is ${purchase.status})`,
        );
      }
      if (need.status === "topping_up") {
        throw invalidState(
          `The price went up: donors still need to cover ${formatUsd(Math.max(0, need.targetCents - need.fundedCents))}`,
        );
      }
      if (need.status !== "funded")
        throw invalidState(`Only a funded need can be ordered (this one is ${need.status})`);

      const [ordered] = await tx
        .update(purchases)
        .set({ status: "ordered", orderRef, orderedAt: sql`clock_timestamp()` })
        .where(eq(purchases.id, purchase.id))
        .returning();
      await tx
        .update(needs)
        .set({ status: "ordered", orderedAt: sql`clock_timestamp()` })
        .where(eq(needs.id, need.id));
      return ordered!;
    }),
  );
  await publishNeedUpdated(row.needId);
  return PurchaseRes.parse({ purchase: { ...toPurchaseView(row), plan: null }, need: await getNeedCard(row.needId) });
}

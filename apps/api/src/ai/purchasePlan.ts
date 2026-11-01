/**
 * Purchase plan (AGENT_B_AI_DATA.md §9.3): before staff buy a funded item, refresh its price, pick the best offer and
 * say what happens to the money. Everything with money in it is deterministic: the offer (cheapest in stock, same
 * product), the new target (computeTargetCents), the surplus or gap (planPurchaseMoney) and the flags. The model only
 * writes the explanation from those facts, and an explanation quoting a number that isn't in the facts is replaced
 * by a plain one.
 */
import {
  computeTargetCents,
  formatUsd,
  planPurchaseMoney,
  PurchasePlanRes,
  type NeedCard,
  type ProductSnapshot,
  type PurchaseOffer,
} from "@needgrid/shared";
import { generateText, Output } from "ai";
import { z } from "zod";
import { PET_CATEGORY, refreshProduct, searchProducts } from "../channel3";
import * as core from "../core";
import { invalidState, notFound } from "../lib/http";
import { cached, callModel, isAiConfigured } from "./models";
import { PURCHASE_PLAN_SYSTEM } from "./prompts/purchasePlan";
import { wrapUntrusted } from "./untrusted";

export const MAX_ALTERNATIVES = 3;
/** Other products (not just other retailers) suggested from a search for the need's title. */
const SEARCH_ALTERNATIVES = 2;
const MAX_EXPLANATION = 400;
/** Seeded food items have no Channel3 product (channel3Id "manual-<key>"). */
export const MANUAL_PREFIX = "manual-";
export const FLAG_MANUAL = "Price not refreshed: manual product";

const ExplanationSchema = z.object({ explanation: z.string() });

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const toOffer = (p: ProductSnapshot): PurchaseOffer => ({
  channel3Id: p.channel3Id,
  title: p.title,
  retailer: p.retailer,
  url: p.url,
  imageUrl: p.imageUrl,
  unitPriceCents: p.unitPriceCents,
  inStock: p.inStock,
});

interface Refreshed {
  /** In stock first, cheapest first. Never empty: falls back to the stored product. */
  offers: PurchaseOffer[];
  flags: string[];
}

/** Today's offers for the stored product, or the stored price with a flag saying why it wasn't refreshed. */
async function refreshOffers(stored: ProductSnapshot): Promise<Refreshed> {
  const fallback = (flag: string): Refreshed => ({ offers: [toOffer(stored)], flags: [flag] });
  if (stored.channel3Id.startsWith(MANUAL_PREFIX)) return fallback(FLAG_MANUAL);
  try {
    const { allOffers } = await refreshProduct(stored.channel3Id);
    if (allOffers.length === 0) {
      return fallback(`Channel3 no longer lists this product; using the price from ${shortDate(stored.fetchedAt)}`);
    }
    return { offers: allOffers, flags: [] };
  } catch (err) {
    console.warn("[purchase-plan] price refresh failed:", (err as Error).message);
    return fallback(`Couldn't refresh the price; using the price from ${shortDate(stored.fetchedAt)}`);
  }
}

/** Deterministic flags about the chosen offer. */
export function offerFlags(stored: ProductSnapshot, best: PurchaseOffer, offers: readonly PurchaseOffer[]): string[] {
  const flags: string[] = [];
  const diff = best.unitPriceCents - stored.unitPriceCents;
  if (diff < 0 && stored.unitPriceCents > 0) {
    flags.push(`Price dropped ${Math.max(1, Math.round((-diff / stored.unitPriceCents) * 100))}%`);
  } else if (diff > 0) flags.push(`Price rose ${formatUsd(diff)}`);
  const storedRetailer = offers.find((o) => o.retailer === stored.retailer);
  if (best.inStock === false) flags.push("Out of stock everywhere we checked; check before ordering");
  else if (storedRetailer?.inStock === false) flags.push(`Out of stock at ${stored.retailer}`);
  if (best.retailer !== stored.retailer) flags.push(`Now from ${best.retailer} (was ${stored.retailer})`);
  const inStock = offers.filter((o) => o.inStock === true).length;
  if (inStock === 1 && offers.length > 1) flags.push("Only offer in stock");
  return flags;
}

/** Other retailers for the same product first, then up to 2 other products from a search for the need's title. */
async function findAlternatives(need: NeedCard, best: PurchaseOffer, offers: readonly PurchaseOffer[]) {
  const key = (o: PurchaseOffer) => `${o.channel3Id}|${o.retailer}`;
  const seen = new Set([key(best)]);
  const out: PurchaseOffer[] = [];
  const add = (o: PurchaseOffer) => {
    if (out.length < MAX_ALTERNATIVES && !seen.has(key(o))) {
      seen.add(key(o));
      out.push(o);
    }
  };
  offers.forEach(add);
  if (out.length < MAX_ALTERNATIVES) {
    try {
      const found = await searchProducts(need.title, {
        limit: 6,
        excludeCategoryIds: need.category === "pet" ? [] : [PET_CATEGORY],
      });
      found
        .filter((p) => p.channel3Id !== best.channel3Id && p.inStock !== false)
        .slice(0, SEARCH_ALTERNATIVES)
        .map(toOffer)
        .forEach(add);
    } catch (err) {
      console.warn("[purchase-plan] alternatives search failed:", (err as Error).message);
    }
  }
  return out;
}

type Money = PurchasePlanRes["money"];

export interface PlanFacts {
  needTitle: string;
  quantity: number;
  unit: string;
  offer: PurchaseOffer;
  oldUnitPriceCents: number;
  fundedCents: number;
  newTargetCents: number;
  money: Money;
  flags: string[];
}

/** The plain explanation, used when the AI is off, fails, or quotes a number that isn't in the facts. */
export function plainExplanation(f: PlanFacts): string {
  const price = formatUsd(f.offer.unitPriceCents);
  const change =
    f.offer.unitPriceCents < f.oldUnitPriceCents
      ? `The price dropped from ${formatUsd(f.oldUnitPriceCents)} to ${price}.`
      : f.offer.unitPriceCents > f.oldUnitPriceCents
        ? `The price rose from ${formatUsd(f.oldUnitPriceCents)} to ${price}.`
        : "The price hasn't changed.";
  const money =
    f.money.kind === "exact"
      ? "The money raised covers it exactly."
      : f.money.kind === "surplus"
        ? f.money.nextNeed
          ? `The ${formatUsd(f.money.cents)} left over goes to "${f.money.nextNeed.title}".`
          : `${formatUsd(f.money.cents)} will be left over; there's no other open need to move it to yet.`
        : `Donors need to cover ${formatUsd(f.money.cents)} more before it can be bought.`;
  return `Best offer: ${price} each at ${f.offer.retailer}. ${change} ${money}`;
}

/** Every "$12.34" / "12%" in the text, normalised. */
function quotedNumbers(text: string): string[] {
  return [...text.matchAll(/\$\s?\d[\d,]*(?:\.\d+)?|\d+(?:\.\d+)?\s?%/g)].map((m) => m[0].replace(/[\s,]/g, ""));
}

function factsText(f: PlanFacts): string {
  const lines = [
    `Item: ${wrapUntrusted("need_title", f.needTitle, 200)}, quantity ${f.quantity} × ${wrapUntrusted("need_unit", f.unit, 40)}`,
    `Chosen offer: ${wrapUntrusted("product_title", f.offer.title, 300)} at ${f.offer.retailer}, ${formatUsd(f.offer.unitPriceCents)} each${f.offer.inStock === false ? ", out of stock" : ""}`,
    `Price when donors funded it: ${formatUsd(f.oldUnitPriceCents)} each`,
    `Money raised: ${formatUsd(f.fundedCents)}. New total with tax and shipping buffer: ${formatUsd(f.newTargetCents)}`,
    f.money.kind === "exact"
      ? "Money: exact match"
      : f.money.kind === "surplus"
        ? `Money: ${formatUsd(f.money.cents)} left over, moves to ${f.money.nextNeed ? wrapUntrusted("next_need_title", f.money.nextNeed.title, 200) : "no other open need yet (it stays here for now)"}`
        : `Money: donors need to cover ${formatUsd(f.money.cents)} more`,
    f.flags.length ? `Flags: ${f.flags.join("; ")}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

/** ≤ 3 sentences from the facts. Never throws. */
export async function explainPlan(f: PlanFacts): Promise<string> {
  const plain = plainExplanation(f);
  if (!isAiConfigured()) return plain;
  const facts = factsText(f);
  try {
    const text = await cached("purchase-plan", facts, () =>
      callModel(
        async ({ model, signal, providerOptions }) => {
          const { output } = await generateText({
            model,
            instructions: PURCHASE_PLAN_SYSTEM,
            prompt: facts,
            output: Output.object({ schema: ExplanationSchema }),
            temperature: 0,
            maxRetries: 0,
            abortSignal: signal,
            providerOptions,
          });
          return output.explanation.replace(/\s+/g, " ").trim();
        },
        { label: "purchase-plan", thinkingBudget: 0 },
      ),
    );
    const allowed = new Set(quotedNumbers(`${facts}\n${plain}`));
    const invented = quotedNumbers(text).filter((n) => !allowed.has(n));
    if (!text || text.length > MAX_EXPLANATION || invented.length > 0) {
      if (invented.length)
        console.warn(`[purchase-plan] explanation quoted numbers not in the facts: ${invented.join(", ")}`);
      return plain;
    }
    return text;
  } catch (err) {
    console.warn("[purchase-plan] explanation fell back to plain text:", (err as Error).message);
    return plain;
  }
}

/** POST /api/staff/needs/:id/purchase-plan. */
export async function planPurchase(needId: string, orgId: string): Promise<PurchasePlanRes> {
  const need = await core.getNeedCard(needId);
  // Another org's need answers 404, not 403: staff can't probe other orgs' ids.
  if (!need || need.orgId !== orgId) throw notFound("Need");
  if (need.status !== "funded") throw invalidState(`Only a funded need can be bought (this one is ${need.status})`);
  const stored = need.product;
  if (!stored) throw invalidState("This need has no product to buy");

  const refreshed = await refreshOffers(stored);
  const best = refreshed.offers[0]!; // in stock first, then cheapest
  const flags = [...refreshed.flags, ...offerFlags(stored, best, refreshed.offers)];

  const newTargetCents = computeTargetCents(best.unitPriceCents, need.quantity);
  const plan = planPurchaseMoney(need.fundedCents, newTargetCents);
  const money: Money =
    plan.kind === "surplus" ? { ...plan, nextNeed: await core.getNextMostUrgentNeed(orgId, need.id) } : plan;
  const priceChange =
    best.unitPriceCents < stored.unitPriceCents
      ? "cheaper"
      : best.unitPriceCents > stored.unitPriceCents
        ? "pricier"
        : "same";

  const [explanation, alternatives] = await Promise.all([
    explainPlan({
      needTitle: need.title,
      quantity: need.quantity,
      unit: need.unit,
      offer: best,
      oldUnitPriceCents: stored.unitPriceCents,
      fundedCents: need.fundedCents,
      newTargetCents,
      money,
      flags,
    }),
    findAlternatives(need, best, refreshed.offers),
  ]);

  const purchase = await core.createProposedPurchase({ needId: need.id, offer: best, explanation, flags });
  if (purchase.newTargetCents !== newTargetCents) {
    console.warn(
      `[purchase-plan] core computed newTargetCents ${purchase.newTargetCents}, B computed ${newTargetCents}`,
    );
  }
  return PurchasePlanRes.parse({ purchase, priceChange, money, alternatives });
}

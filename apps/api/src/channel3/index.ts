// OWNER: B (AI & Data). Channel3 product search, URL lookup and price refresh (AGENT_B_AI_DATA.md §7).
// Everything returned here is normalised (ProductSnapshot / PurchaseOffer, integer cents, USD only).
import type { ProductSnapshot, PurchaseOffer } from "@needgrid/shared";
import { z } from "zod";
import { HttpError } from "../lib/http";
import { channel3Gateway, TtlCache, type Channel3Product } from "./client";
import { normalizeProduct, normalizeQuery, productOffers } from "./normalize";

export {
  isChannel3Configured,
  setChannel3Gateway,
  type Channel3Gateway,
  type Channel3Product,
  type SearchFilters,
} from "./client";
/** Channel3's root category for pet products. Excluded for non-pet needs ("canned tuna" otherwise finds cat food). */
export const PET_CATEGORY = "animals-pet-supplies";
export { parsePackSize } from "./normalize";

const HOUR = 60 * 60 * 1000;
const MAX_QUERY_CHARS = 200;
const MAX_URL_CHARS = 2048;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 30; // Channel3's cap
/** Control characters are stripped from untrusted query text. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** Search results cost credits and are suggestions only: 24 h. */
const searchCache = new TtlCache<ProductSnapshot[]>(500, 24 * HOUR);
/** URL lookups are slow (2–10 s) and cost credits: 1 h. */
const lookupCache = new TtlCache<ProductSnapshot | null>(200, HOUR);
/**
 * Retrieve is free and the purchase plan needs today's price, so only 5 min (absorbs double-clicks).
 * Shorter than the brief's 1 h on purpose: Channel3 advises refreshing prices at display time.
 */
const retrieveCache = new TtlCache<Channel3Product | null>(200, 5 * 60 * 1000);

/** Tests and the seed script. */
export function clearChannel3Cache(): void {
  searchCache.clear();
  lookupCache.clear();
  retrieveCache.clear();
}

/** Text search → up to `limit` (default 8) normalised, de-duplicated products. Products without a USD offer are dropped. */
export async function searchProducts(
  query: string,
  opts: { limit?: number; excludeCategoryIds?: string[] } = {},
): Promise<ProductSnapshot[]> {
  const q = query.replace(CONTROL_CHARS, " ").trim().slice(0, MAX_QUERY_CHARS);
  if (q.length === 0) return [];
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  const exclude = [...new Set(opts.excludeCategoryIds ?? [])].sort();
  return searchCache.getOrLoad(`${normalizeQuery(q)}|${limit}|${exclude.join(",")}`, async () => {
    const products = await channel3Gateway().search(q, limit, exclude.length ? { excludeCategoryIds: exclude } : {});
    const fetchedAt = new Date().toISOString();
    const seen = new Set<string>();
    const out: ProductSnapshot[] = [];
    for (const p of products) {
      const snap = normalizeProduct(p, fetchedAt);
      if (snap && !seen.has(snap.channel3Id)) {
        seen.add(snap.channel3Id);
        out.push(snap);
      }
    }
    return out;
  });
}

const ProductUrl = z.url({ protocol: /^https?$/ }).max(MAX_URL_CHARS);

/** A pasted retailer URL → the canonical product, or null if Channel3 can't resolve it to a product. */
export async function lookupByUrl(url: string): Promise<ProductSnapshot | null> {
  const parsed = ProductUrl.safeParse(url.trim());
  if (!parsed.success) throw new HttpError(400, "VALIDATION", "That doesn't look like a product link");
  return lookupCache.getOrLoad(parsed.data, async () => {
    const product = await channel3Gateway().lookup(parsed.data);
    return product ? normalizeProduct(product) : null;
  });
}

/**
 * Fresh price for a stored product (purchase plan). `snapshot` uses the best offer;
 * `allOffers` is every usable USD offer, in stock first, cheapest first.
 * Returns `{ snapshot: null, allOffers: [] }` if Channel3 no longer knows the product. Throws HttpError on outages.
 */
export async function refreshProduct(
  channel3Id: string,
): Promise<{ snapshot: ProductSnapshot | null; allOffers: PurchaseOffer[] }> {
  const product = await retrieveCache.getOrLoad(channel3Id, () => channel3Gateway().retrieve(channel3Id));
  if (!product) return { snapshot: null, allOffers: [] };
  return { snapshot: normalizeProduct(product), allOffers: productOffers(product) };
}

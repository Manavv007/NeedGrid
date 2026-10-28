/**
 * Channel3 Product → our ProductSnapshot / PurchaseOffer (AGENT_B_AI_DATA.md §7). Pure functions, no I/O.
 *
 * Rules:
 * 1. Only USD offers with a positive price and a valid URL. Pick the cheapest in-stock offer, else the cheapest
 *    out-of-stock one (inStock: false). No usable offer → the product is dropped.
 * 2. unitPriceCents = dollarsToCents(offer.price.price); retailer = offer.domain; url = offer.url.
 * 3. imageUrl = main image's cleaned_url ?? its url ?? first image's cleaned_url ?? url ?? null.
 * 4. packSize parsed from the title, then key_features. Unknown → null.
 * 5. The result is validated with ProductSnapshot; anything that fails is dropped.
 */
import type { Channel3Api } from "@channel3/sdk";
import { dollarsToCents, ProductSnapshot, type PurchaseOffer } from "@needgrid/shared";
import { z } from "zod";

type Product = Channel3Api.Product;
type Offer = Channel3Api.ProductOffer;

const MAX_PACK_SIZE = 10_000;
const HttpUrl = z.url({ protocol: /^https?$/ });

function validUrl(u: string | null | undefined): string | null {
  return u && HttpUrl.safeParse(u).success ? u : null;
}

// ---------------------------------------------------------------------------------------------
// Pack size
// ---------------------------------------------------------------------------------------------

const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+)`;
/** "150 Count", "150 ct", "150-Count", "150ct", "100 pcs", "36 Rolls", "12 Pairs". "Sheets"/"oz" are sizes, not item counts. */
const COUNT_RE = new RegExp(
  String.raw`\b${NUM}\s*-?\s*(?:count|counts|ct|pcs|pieces|piece|pc|rolls|roll|pairs|pair)\b\.?`,
  "i",
);
/** "Pack of 12", "Case of 24", "Box of 100", "Set of 6", "Bag of 50". */
const PACK_OF_RE = new RegExp(String.raw`\b(?:pack|case|box|set|bag|bundle|carton)\s+of\s+${NUM}\b`, "i");
/** "12-Pack", "12 Pack", "12pk", "12 pk", "6-pk". Not "Pack 'n Play" (needs a number in front). */
const N_PACK_RE = new RegExp(String.raw`\b${NUM}\s*-?\s*(?:pack|pk|pks)\b`, "i");
/** "24 x 15 oz", "12 X 16.9 fl oz", "6 x 1 lb". Only with a size unit, so "24 x 36 in" posters don't match. */
const TIMES_RE = new RegExp(
  String.raw`\b${NUM}\s*[x×]\s*\d+(?:\.\d+)?\s*-?\s*(?:fl\.?\s*oz|oz|ml|l|g|kg|lb|lbs|ct|count)\b`,
  "i",
);

const toInt = (s: string) => Number(s.replace(/,/g, ""));

/**
 * Items per purchasable unit, from one piece of text. A count AND a multi-pack multiply:
 * "24 Count (Pack of 12)" = 288 items in one purchase. Returns null when nothing sensible is found.
 */
export function parsePackSizeFrom(text: string): number | null {
  const count = COUNT_RE.exec(text);
  const packs = PACK_OF_RE.exec(text) ?? N_PACK_RE.exec(text) ?? TIMES_RE.exec(text);
  const c = count ? toInt(count[1]!) : null;
  const p = packs ? toInt(packs[1]!) : null;
  let n: number | null;
  if (c !== null && p !== null) n = c * p;
  else n = c ?? p;
  if (n === null || !Number.isSafeInteger(n) || n < 1 || n > MAX_PACK_SIZE) return null;
  return n;
}

/** Title first, then each key feature in order. */
export function parsePackSize(title: string, keyFeatures?: readonly string[] | null): number | null {
  const fromTitle = parsePackSizeFrom(title);
  if (fromTitle !== null) return fromTitle;
  for (const f of keyFeatures ?? []) {
    const n = parsePackSizeFrom(f);
    if (n !== null) return n;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------------------------

export interface UsableOffer {
  url: string;
  retailer: string;
  unitPriceCents: number;
  inStock: boolean;
}

/** USD offers with a positive finite price, a domain and a valid http(s) URL. */
export function usableOffers(offers: readonly Offer[] | undefined): UsableOffer[] {
  const out: UsableOffer[] = [];
  for (const o of offers ?? []) {
    if (o.price?.currency?.toUpperCase() !== "USD") continue;
    const price = o.price.price;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
    const url = validUrl(o.url);
    if (!url || !o.domain) continue;
    out.push({ url, retailer: o.domain, unitPriceCents: dollarsToCents(price), inStock: o.availability === "InStock" });
  }
  return out;
}

/** In stock first, then cheapest, then retailer name (stable, deterministic). */
export function sortOffers<T extends { inStock: boolean | null; unitPriceCents: number; retailer: string }>(
  offers: readonly T[],
): T[] {
  return [...offers].sort(
    (a, b) =>
      Number(b.inStock === true) - Number(a.inStock === true) ||
      a.unitPriceCents - b.unitPriceCents ||
      a.retailer.localeCompare(b.retailer),
  );
}

/** Cheapest in-stock offer, else the cheapest out-of-stock one. */
export function pickOffer(offers: readonly Offer[] | undefined): UsableOffer | null {
  return sortOffers(usableOffers(offers))[0] ?? null;
}

export function pickImageUrl(images: Product["images"]): string | null {
  const list = images ?? [];
  const main = list.find((i) => i.is_main_image) ?? null;
  const first = list[0] ?? null;
  return (
    validUrl(main?.cleaned_url) ?? validUrl(main?.url) ?? validUrl(first?.cleaned_url) ?? validUrl(first?.url) ?? null
  );
}

// ---------------------------------------------------------------------------------------------
// Product
// ---------------------------------------------------------------------------------------------

/** One Channel3 product → ProductSnapshot, or null if it has no usable USD offer or fails validation. */
export function normalizeProduct(p: Product, fetchedAt: string = new Date().toISOString()): ProductSnapshot | null {
  const offer = pickOffer(p.offers);
  const title = p.title?.trim();
  if (!offer || !title) return null;
  const parsed = ProductSnapshot.safeParse({
    channel3Id: p.id,
    title,
    imageUrl: pickImageUrl(p.images),
    retailer: offer.retailer,
    url: offer.url,
    unitPriceCents: offer.unitPriceCents,
    packSize: parsePackSize(title, p.key_features),
    inStock: offer.inStock,
    fetchedAt,
  });
  if (!parsed.success) {
    console.warn(`[channel3] dropped product ${p.id}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    return null;
  }
  return parsed.data;
}

/** Every usable USD offer of one product as PurchaseOffers, in stock first, cheapest first. */
export function productOffers(p: Product): PurchaseOffer[] {
  const title = p.title?.trim();
  if (!title) return [];
  const imageUrl = pickImageUrl(p.images);
  return sortOffers(usableOffers(p.offers)).map((o) => ({
    channel3Id: p.id,
    title,
    retailer: o.retailer,
    url: o.url,
    imageUrl,
    unitPriceCents: o.unitPriceCents,
    inStock: o.inStock,
  }));
}

/** Cache key for a search: lowercase, single spaces, trimmed. */
export function normalizeQuery(query: string): string {
  return query.toLowerCase().replace(/\s+/g, " ").trim();
}

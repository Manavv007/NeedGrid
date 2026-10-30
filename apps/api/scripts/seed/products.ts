/**
 * Products for seeded needs. Online: search Channel3 once per query and save the results in products.cache.json
 * (committed, so reseeding costs no credits). Offline: read the cache only.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProductSnapshot } from "@needgrid/shared";
import { z } from "zod";
import { PET_CATEGORY, searchProducts } from "../../src/channel3";
import { DEFAULT_MAX_UNIT_CENTS, type NeedTemplate } from "./catalog";

export const CACHE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "products.cache.json");
const SEARCH_LIMIT = 12;

const CacheFile = z.object({
  version: z.literal(1),
  /** key = `${query}|${pet ? "pet" : "nopet"}` */
  searches: z.record(z.string(), z.object({ fetchedAt: z.string(), products: z.array(ProductSnapshot) })),
});
export type ProductCache = z.infer<typeof CacheFile>;

export const cacheKey = (query: string, allowPet: boolean) =>
  `${query.toLowerCase().trim()}|${allowPet ? "pet" : "nopet"}`;

export function loadCache(file = CACHE_PATH): ProductCache {
  if (!existsSync(file)) return { version: 1, searches: {} };
  return CacheFile.parse(JSON.parse(readFileSync(file, "utf8")));
}

/** Stable key order so the committed file diffs cleanly. */
export function saveCache(cache: ProductCache, file = CACHE_PATH): void {
  const sorted: ProductCache = {
    version: 1,
    searches: Object.fromEntries(Object.entries(cache.searches).sort(([a], [b]) => a.localeCompare(b))),
  };
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
}

/** Fill the cache for every Channel3 template that isn't cached yet. Returns how many searches were made. */
export async function fetchMissing(
  cache: ProductCache,
  jobs: Array<{ template: NeedTemplate; allowPet: boolean }>,
  opts: { refresh?: boolean; concurrency?: number } = {},
): Promise<number> {
  const todo = new Map<string, { query: string; allowPet: boolean }>();
  for (const { template, allowPet } of jobs) {
    if (!template.query) continue;
    const key = cacheKey(template.query, allowPet);
    if (opts.refresh || !cache.searches[key]) todo.set(key, { query: template.query, allowPet });
  }
  const entries = [...todo.entries()];
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const [key, { query, allowPet }] = entries[next++]!;
      const products = await searchProducts(query, {
        limit: SEARCH_LIMIT,
        excludeCategoryIds: allowPet ? [] : [PET_CATEGORY],
      });
      cache.searches[key] = { fetchedAt: new Date().toISOString(), products };
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, entries.length) }, worker));
  return entries.length;
}

function matches(p: ProductSnapshot, t: NeedTemplate): boolean {
  const ok = (t.match ?? []).every((re) => new RegExp(re, "i").test(p.title));
  const bad = (t.avoid ?? []).some((re) => new RegExp(re, "i").test(p.title));
  return ok && !bad && p.unitPriceCents <= (t.maxUnitCents ?? DEFAULT_MAX_UNIT_CENTS);
}

/** Cached results for a template that pass its match/avoid/price rules, in Channel3's order, in stock first. */
export function candidatesFor(cache: ProductCache, t: NeedTemplate, allowPet: boolean): ProductSnapshot[] {
  if (!t.query) return [];
  const hit = cache.searches[cacheKey(t.query, allowPet)];
  if (!hit) return [];
  const ok = hit.products.filter((p) => matches(p, t) && p.imageUrl !== null);
  return [...ok.filter((p) => p.inStock !== false), ...ok.filter((p) => p.inStock === false)];
}

/** A hand-entered product (Harbor's food items) as a ProductSnapshot. */
export function manualSnapshot(t: NeedTemplate, fetchedAt: string): ProductSnapshot {
  const m = t.manual!;
  return ProductSnapshot.parse({
    channel3Id: `manual-${t.key}`,
    title: m.title,
    imageUrl: null,
    retailer: m.retailer,
    url: m.url,
    unitPriceCents: m.unitPriceCents,
    packSize: m.packSize,
    inStock: true,
    fetchedAt,
  });
}

/**
 * Channel3 SDK client (@channel3/sdk 4.x), error mapping and a small in-memory cache.
 *
 * All NeedGrid code talks to Channel3 through `channel3Gateway()`, so tests swap in a fake with
 * `setChannel3Gateway()`. No test ever calls the real API.
 *
 * SDK 4.x facts (checked against the installed .d.ts and the Channel3 API skill):
 * - `import { Channel3 } from "@channel3/sdk"`, `new Channel3({ apiKey })`; request fields are snake_case.
 * - `products.search()` returns a Page: products are in `.data`. `limit` max 30.
 * - `products.retrieve({ product_id })` is free; `products.lookup({ url })` takes 2–10 s uncached and
 *   returns 422 for non-product pages.
 */
import { Channel3, Channel3Error, Channel3TimeoutError, type Channel3Api } from "@channel3/sdk";
import { env } from "../env";
import { HttpError, upstream } from "../lib/http";

export type Channel3Product = Channel3Api.Product;

export interface SearchFilters {
  /** Channel3 category slugs to leave out (with descendants), e.g. "animals-pet-supplies". */
  excludeCategoryIds?: string[];
}

export interface Channel3Gateway {
  /** Text search, US/USD locale. In-stock offers only (Channel3's default availability filter). */
  search(query: string, limit: number, filters?: SearchFilters): Promise<Channel3Product[]>;
  /** One product by id with all current offers. null when Channel3 doesn't know it (404). */
  retrieve(productId: string): Promise<Channel3Product | null>;
  /** Canonical product for a merchant URL. null for non-product pages (422) or unknown URLs (404). */
  lookup(url: string): Promise<Channel3Product | null>;
}

const LOCALE = { country: "US", currency: "USD" } as const;

function statusOf(err: unknown): number | undefined {
  return err instanceof Channel3Error ? err.statusCode : undefined;
}

/** Map SDK errors to our ApiError shape. Details stay in the server log, never in the response. */
function toHttpError(err: unknown, what: string): HttpError {
  if (err instanceof HttpError) return err;
  const status = statusOf(err);
  console.error(`[channel3] ${what} failed`, { status, message: (err as Error)?.message });
  if (err instanceof Channel3TimeoutError) return upstream("Product search timed out, try again");
  if (status === 401 || status === 403) return upstream("Product search is misconfigured (bad Channel3 API key)");
  if (status === 402) return upstream("Product search is out of credits");
  if (status === 429) return upstream("Product search is busy, try again in a minute");
  return upstream("Product search is unavailable, try again");
}

export class SdkChannel3Gateway implements Channel3Gateway {
  private readonly client: Channel3;

  constructor(apiKey: string) {
    // SDK retries 429/5xx itself; keep it to 2 so one intake can't stall for long.
    this.client = new Channel3({ apiKey, maxRetries: 2, timeoutInSeconds: 20 });
  }

  async search(query: string, limit: number, filters: SearchFilters = {}): Promise<Channel3Product[]> {
    try {
      const exclude = filters.excludeCategoryIds?.length ? filters.excludeCategoryIds : undefined;
      const page = await this.client.products.search({
        query,
        limit,
        config: LOCALE,
        ...(exclude ? { filters: { exclude_category_ids: exclude } } : {}),
      });
      return page.data;
    } catch (err) {
      throw toHttpError(err, "search");
    }
  }

  async retrieve(productId: string): Promise<Channel3Product | null> {
    try {
      return await this.client.products.retrieve({ product_id: productId, ...LOCALE }, { timeoutInSeconds: 15 });
    } catch (err) {
      if (statusOf(err) === 404) return null;
      throw toHttpError(err, "retrieve");
    }
  }

  async lookup(url: string): Promise<Channel3Product | null> {
    try {
      const res = await this.client.products.lookup({ url }, { timeoutInSeconds: 30 });
      return res.product;
    } catch (err) {
      const status = statusOf(err);
      if (status === 404 || status === 422) return null;
      throw toHttpError(err, "lookup");
    }
  }
}

let override: Channel3Gateway | null = null;
let real: SdkChannel3Gateway | null = null;

/** The active gateway. 503 UPSTREAM when CHANNEL3_API_KEY is missing (the API still boots without it). */
export function channel3Gateway(): Channel3Gateway {
  if (override) return override;
  if (!env.CHANNEL3_API_KEY) throw new HttpError(503, "UPSTREAM", "Product search is not configured");
  real ??= new SdkChannel3Gateway(env.CHANNEL3_API_KEY);
  return real;
}

/** Tests: swap in a fake (null restores the real SDK gateway). */
export function setChannel3Gateway(gateway: Channel3Gateway | null): void {
  override = gateway;
}

export const isChannel3Configured = (): boolean => override !== null || Boolean(env.CHANNEL3_API_KEY);

// ---------------------------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------------------------

/**
 * Tiny LRU with a TTL. Stores promises, so concurrent identical calls share one request
 * (saves credits when staff double-click). Rejected promises are evicted at once.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: Promise<V>; expiresAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async getOrLoad(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > this.now()) {
      this.entries.delete(key); // re-insert = most recently used
      this.entries.set(key, hit);
      return hit.value;
    }
    const value = load();
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    return value;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

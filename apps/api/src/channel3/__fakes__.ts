/** Test doubles for Channel3. Made-up products only. Use with setChannel3Gateway(). */
import type { Channel3Gateway, Channel3Product } from "./client";

type FakeOffer = NonNullable<Channel3Product["offers"]>[number];

type FakeOfferInput = Partial<Omit<FakeOffer, "price">> & { price?: number; currency?: string };

/** `price` is in dollars, like the Channel3 API. */
export function fakeOffer(over: FakeOfferInput = {}): FakeOffer {
  const { price = 38.49, currency = "USD", ...rest } = over;
  return {
    url: "https://www.walmart.com/ip/123",
    domain: "walmart.com",
    price: { price, currency },
    availability: "InStock",
    ...rest,
  };
}

export function fakeProduct(over: Partial<Channel3Product> = {}): Channel3Product {
  return {
    id: "prod_diapers4",
    title: "Pampers Cruisers Diapers Size 4, 150 Count",
    images: [{ url: "https://images.example.com/diapers.jpg", is_main_image: true }],
    key_features: [],
    offers: [fakeOffer()],
    ...over,
  };
}

/** In-memory gateway that records every call, so tests can assert caching. */
export class FakeChannel3 implements Channel3Gateway {
  calls: Array<{ op: "search" | "retrieve" | "lookup"; arg: string; limit?: number }> = [];
  searchResults = new Map<string, Channel3Product[]>();
  products = new Map<string, Channel3Product>();
  lookups = new Map<string, Channel3Product>();
  /** When set, every call rejects with this error. */
  failWith: Error | null = null;

  async search(query: string, limit: number): Promise<Channel3Product[]> {
    this.calls.push({ op: "search", arg: query, limit });
    if (this.failWith) throw this.failWith;
    return (this.searchResults.get(query.toLowerCase()) ?? []).slice(0, limit);
  }

  async retrieve(productId: string): Promise<Channel3Product | null> {
    this.calls.push({ op: "retrieve", arg: productId });
    if (this.failWith) throw this.failWith;
    return this.products.get(productId) ?? null;
  }

  async lookup(url: string): Promise<Channel3Product | null> {
    this.calls.push({ op: "lookup", arg: url });
    if (this.failWith) throw this.failWith;
    return this.lookups.get(url) ?? null;
  }
}

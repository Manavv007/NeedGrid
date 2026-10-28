import { ProductSnapshot } from "@needgrid/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpError } from "../lib/http";
import { FakeChannel3, fakeOffer, fakeProduct } from "./__fakes__";
import { TtlCache } from "./client";
import { clearChannel3Cache, lookupByUrl, refreshProduct, searchProducts, setChannel3Gateway } from "./index";

let fake: FakeChannel3;

beforeEach(() => {
  fake = new FakeChannel3();
  setChannel3Gateway(fake);
  clearChannel3Cache();
});

afterEach(() => {
  setChannel3Gateway(null);
  clearChannel3Cache();
});

describe("searchProducts", () => {
  beforeEach(() => {
    fake.searchResults.set("size 4 diapers", [
      fakeProduct({ id: "p1" }),
      fakeProduct({ id: "p1" }), // duplicate id → dropped
      fakeProduct({ id: "p2", offers: [fakeOffer({ currency: "EUR" })] }), // no USD → dropped
      fakeProduct({ id: "p3", title: "Huggies Size 4, 128 Ct", offers: [fakeOffer({ price: 31.5 })] }),
    ]);
  });

  it("returns normalised, de-duplicated USD products", async () => {
    const res = await searchProducts("Size 4 diapers");
    expect(res.map((p) => [p.channel3Id, p.unitPriceCents, p.packSize])).toEqual([
      ["p1", 3849, 150],
      ["p3", 3150, 128],
    ]);
    res.forEach((p) => ProductSnapshot.parse(p));
    expect(fake.calls).toEqual([{ op: "search", arg: "Size 4 diapers", limit: 8 }]);
  });

  it("caches by normalised query, and shares one request between concurrent calls", async () => {
    await Promise.all([searchProducts("Size 4 diapers"), searchProducts("  size 4   DIAPERS")]);
    await searchProducts("size 4 diapers");
    expect(fake.calls).toHaveLength(1);
  });

  it("clamps the limit to Channel3's 1–30 range", async () => {
    await searchProducts("size 4 diapers", { limit: 500 });
    await searchProducts("size 4 diapers", { limit: 0 });
    expect(fake.calls.map((c) => c.limit)).toEqual([30, 1]);
  });

  it("empty or whitespace query → [] without calling Channel3", async () => {
    expect(await searchProducts("   ")).toEqual([]);
    expect(fake.calls).toHaveLength(0);
  });

  it("strips control characters and caps the query length", async () => {
    await searchProducts(`diapers\u0000\n${"x".repeat(500)}`);
    expect(fake.calls[0]!.arg.length).toBe(200);
    // eslint-disable-next-line no-control-regex
    expect(fake.calls[0]!.arg).not.toMatch(/[\u0000-\u001f]/);
  });

  it("does not cache failures", async () => {
    fake.failWith = new HttpError(502, "UPSTREAM", "Product search is unavailable, try again");
    await expect(searchProducts("size 4 diapers")).rejects.toMatchObject({ status: 502, code: "UPSTREAM" });
    fake.failWith = null;
    expect(await searchProducts("size 4 diapers")).toHaveLength(2);
    expect(fake.calls).toHaveLength(2);
  });
});

describe("lookupByUrl", () => {
  const url = "https://www.target.com/p/pampers-size-4/-/A-123";

  it("resolves a product URL", async () => {
    fake.lookups.set(url, fakeProduct({ id: "p9", offers: [fakeOffer({ domain: "target.com", url, price: 42 })] }));
    expect(await lookupByUrl(url)).toMatchObject({ channel3Id: "p9", retailer: "target.com", unitPriceCents: 4200 });
    await lookupByUrl(url);
    expect(fake.calls).toHaveLength(1);
  });

  it("null when Channel3 can't resolve it", async () => {
    expect(await lookupByUrl(url)).toBeNull();
  });

  it("rejects non-http URLs with 400 before calling Channel3", async () => {
    await expect(lookupByUrl("file:///etc/passwd")).rejects.toMatchObject({ status: 400, code: "VALIDATION" });
    await expect(lookupByUrl("not a url")).rejects.toMatchObject({ status: 400 });
    expect(fake.calls).toHaveLength(0);
  });
});

describe("refreshProduct", () => {
  it("returns the best offer as the snapshot plus every usable offer", async () => {
    fake.products.set(
      "p1",
      fakeProduct({
        id: "p1",
        offers: [
          fakeOffer({ domain: "walmart.com", url: "https://walmart.com/1", price: 38.49 }),
          fakeOffer({ domain: "target.com", url: "https://target.com/1", price: 34.99 }),
          fakeOffer({ domain: "amazon.com", url: "https://amazon.com/1", price: 29.99, availability: "OutOfStock" }),
        ],
      }),
    );
    const { snapshot, allOffers } = await refreshProduct("p1");
    expect(snapshot).toMatchObject({ channel3Id: "p1", retailer: "target.com", unitPriceCents: 3499, inStock: true });
    expect(allOffers.map((o) => o.retailer)).toEqual(["target.com", "walmart.com", "amazon.com"]);
  });

  it("unknown product → { snapshot: null, allOffers: [] }", async () => {
    expect(await refreshProduct("gone")).toEqual({ snapshot: null, allOffers: [] });
  });
});

describe("not configured", () => {
  it("503 UPSTREAM when CHANNEL3_API_KEY is missing (tests run without keys)", async () => {
    setChannel3Gateway(null);
    const err = await searchProducts("diapers").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 503, code: "UPSTREAM" });
  });
});

describe("TtlCache", () => {
  it("expires entries and evicts the least recently used", async () => {
    let now = 0;
    const cache = new TtlCache<number>(2, 1000, () => now);
    let loads = 0;
    const load = async () => ++loads;
    await cache.getOrLoad("a", load);
    await cache.getOrLoad("b", load);
    await cache.getOrLoad("a", load); // a is now most recent
    await cache.getOrLoad("c", load); // evicts b
    expect(cache.size).toBe(2);
    expect(await cache.getOrLoad("a", load)).toBe(1);
    expect(await cache.getOrLoad("b", load)).toBe(4); // reloaded
    now = 2000;
    expect(await cache.getOrLoad("a", load)).toBe(5); // expired
  });
});

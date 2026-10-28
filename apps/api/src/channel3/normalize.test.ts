import { ProductSnapshot } from "@needgrid/shared";
import { describe, expect, it } from "vitest";
import { fakeOffer, fakeProduct } from "./__fakes__";
import {
  normalizeProduct,
  normalizeQuery,
  parsePackSize,
  parsePackSizeFrom,
  pickImageUrl,
  pickOffer,
  productOffers,
} from "./normalize";

describe("parsePackSizeFrom: real-world style titles", () => {
  const cases: Array<[string, number | null]> = [
    ["Pampers Cruisers Diapers Size 4, 150 Count", 150],
    ["Huggies Little Movers Baby Diapers, Size 4, 128 Ct", 128],
    ["Crayola Crayons, 24 Count (Pack of 12)", 288],
    ["Pack of 12 Kleenex Facial Tissues", 12],
    ["Dove Beauty Bar Soap, 3.75 oz, 14-Pack", 14],
    ["Campbell's Chunky Soup, 24 x 18.8 oz", 24],
    ["Bounty Select-A-Size Paper Towels 12 pk", 12],
    ["Scott 1000 Toilet Paper, 1,000 Sheets per Roll, 36 Rolls", 36],
    ["Kirkland Signature Purified Water, 16.9 fl oz, 40-count", 40],
    ["Ticonderoga Pencils, #2 HB Soft, 96-Pack", 96],
    ["Glad Tall Kitchen Trash Bags, 13 Gallon, 110 Count", 110],
    ["Colgate Cavity Protection Toothpaste 6 oz, Pack of 6", 6],
    ["Mead Spiral Notebooks, 1 Subject, 70 Sheets, 6 Pack", 6],
    ["Hanes Boys' Crew Socks, 12 Pairs", 12],
    ["Fancy Feast Gravy Lovers Wet Cat Food, 3 oz. Cans (24 Pack)", 24],
    ["Elmer's Disappearing Purple Glue Sticks, 0.24 oz, 30 Count", 30],
    ["Similac 360 Total Care Infant Formula Powder, 30.8 oz, 1 ct", 1],
    ["Sharpie Permanent Markers, Fine Point, 5 pcs", 5],
    ["Box of 100 Nitrile Exam Gloves, Large", 100],
    ["Energizer MAX AA Batteries (48 Pack)", 48],
    ["Paper Plates 1,000 Count Bulk", 1000],
    ["Wet Wipes 6-pk", 6],
    // No item count in the title:
    ["Pampers Swaddlers Diapers Size 4", null],
    ["Pedigree Complete Nutrition Adult Dry Dog Food, 44 lb. Bag", null],
    ["Graco Pack 'n Play Portable Playard", null],
    ["Classroom World Map Poster, 24 x 36 in", null],
    ["Kids' Hooded Winter Puffer Coat, Size 8", null],
    ["100% Cotton Youth T-Shirt", null],
    ["Purina Tidy Cats Clumping Cat Litter, 40 lb", null],
    ["Ziploc Storage Bags 3-in-1 Value Pack", null],
    // Out of range:
    ["Rubber Bands, 20,000 Count", null],
  ];
  it.each(cases)("%s → %s", (title, expected) => {
    expect(parsePackSizeFrom(title)).toBe(expected);
  });
});

describe("parsePackSize", () => {
  it("prefers the title over key features", () => {
    expect(parsePackSize("Diapers Size 4, 150 Count", ["Pack of 2"])).toBe(150);
  });
  it("falls back to key features in order", () => {
    expect(parsePackSize("Huggies Natural Care Baby Wipes", ["Unscented", "Pack of 12, 56 wipes each"])).toBe(12);
  });
  it("null when nothing matches", () => {
    expect(parsePackSize("Toddler Rain Boots", null)).toBeNull();
  });
});

describe("pickOffer", () => {
  it("cheapest in-stock USD offer wins over cheaper out-of-stock and non-USD offers", () => {
    const o = pickOffer([
      fakeOffer({ domain: "a.com", url: "https://a.com/1", price: 30 }),
      fakeOffer({ domain: "b.com", url: "https://b.com/1", price: 20, availability: "OutOfStock" }),
      fakeOffer({ domain: "c.com", url: "https://c.com/1", price: 10, currency: "CAD" }),
      fakeOffer({ domain: "d.com", url: "https://d.com/1", price: 25.99 }),
    ]);
    expect(o).toEqual({ url: "https://d.com/1", retailer: "d.com", unitPriceCents: 2599, inStock: true });
  });
  it("falls back to the cheapest out-of-stock offer", () => {
    const o = pickOffer([
      fakeOffer({ domain: "a.com", price: 30, availability: "OutOfStock" }),
      fakeOffer({ domain: "b.com", price: 20, availability: "OutOfStock" }),
    ]);
    expect(o).toMatchObject({ retailer: "b.com", unitPriceCents: 2000, inStock: false });
  });
  it("ignores zero/negative prices and invalid URLs; null when nothing usable", () => {
    expect(pickOffer([fakeOffer({ price: 0 }), fakeOffer({ url: "javascript:alert(1)" })])).toBeNull();
    expect(pickOffer(undefined)).toBeNull();
  });
  it("converts dollars without float drift", () => {
    expect(pickOffer([fakeOffer({ price: 19.99 })])?.unitPriceCents).toBe(1999);
    expect(pickOffer([fakeOffer({ price: 0.29 })])?.unitPriceCents).toBe(29);
  });
});

describe("pickImageUrl", () => {
  it("main image cleaned_url, then its url, then the first image", () => {
    expect(
      pickImageUrl([
        { url: "https://x.com/first.jpg", cleaned_url: "https://x.com/first-clean.jpg" },
        { url: "https://x.com/main.jpg", cleaned_url: "https://x.com/main-clean.jpg", is_main_image: true },
      ]),
    ).toBe("https://x.com/main-clean.jpg");
    expect(pickImageUrl([{ url: "https://x.com/main.jpg", is_main_image: true }])).toBe("https://x.com/main.jpg");
    expect(pickImageUrl([{ url: "https://x.com/a.jpg" }])).toBe("https://x.com/a.jpg");
    expect(pickImageUrl([])).toBeNull();
    expect(pickImageUrl(undefined)).toBeNull();
  });
});

describe("normalizeProduct", () => {
  const at = "2026-10-28T12:00:00.000Z";
  it("builds a valid ProductSnapshot", () => {
    const snap = normalizeProduct(fakeProduct(), at);
    expect(ProductSnapshot.parse(snap)).toEqual({
      channel3Id: "prod_diapers4",
      title: "Pampers Cruisers Diapers Size 4, 150 Count",
      imageUrl: "https://images.example.com/diapers.jpg",
      retailer: "walmart.com",
      url: "https://www.walmart.com/ip/123",
      unitPriceCents: 3849,
      packSize: 150,
      inStock: true,
      fetchedAt: at,
    });
  });
  it("drops products without a USD offer", () => {
    expect(normalizeProduct(fakeProduct({ offers: [fakeOffer({ currency: "EUR" })] }), at)).toBeNull();
    expect(normalizeProduct(fakeProduct({ offers: [] }), at)).toBeNull();
  });
  it("drops products with an empty title", () => {
    expect(normalizeProduct(fakeProduct({ title: "  " }), at)).toBeNull();
  });
});

describe("productOffers", () => {
  it("every usable offer, in stock first then cheapest", () => {
    const offers = productOffers(
      fakeProduct({
        offers: [
          fakeOffer({ domain: "a.com", url: "https://a.com/1", price: 40 }),
          fakeOffer({ domain: "b.com", url: "https://b.com/1", price: 20, availability: "OutOfStock" }),
          fakeOffer({ domain: "c.com", url: "https://c.com/1", price: 35 }),
          fakeOffer({ domain: "d.com", url: "https://d.com/1", price: 10, currency: "GBP" }),
        ],
      }),
    );
    expect(offers.map((o) => [o.retailer, o.unitPriceCents, o.inStock])).toEqual([
      ["c.com", 3500, true],
      ["a.com", 4000, true],
      ["b.com", 2000, false],
    ]);
    expect(offers[0]).toMatchObject({ channel3Id: "prod_diapers4", imageUrl: "https://images.example.com/diapers.jpg" });
  });
});

it("normalizeQuery lowercases and collapses whitespace", () => {
  expect(normalizeQuery("  Pampers   Size 4\tDIAPERS ")).toBe("pampers size 4 diapers");
});

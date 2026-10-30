/**
 * What the mock `POST /api/staff/intake` answers, in the shape B's real route produces (NOTES.md 13,
 * HANDOFF note from B): up to 3 ranked options per draft, an empty `options` list plus a "paste a
 * product link" warning for food (Channel3 has no groceries), a low-confidence draft, a draft whose
 * `suggestedTargetCents` is null (pack size unknown), and one draft with one option for a pasted link.
 *
 * The mock doesn't read photos or lists: any photo or text returns the same six drafts, which is
 * what makes the demo repeatable.
 */
import {
  computeTargetCents,
  IntakeRes,
  type DraftNeed,
  type ExtractedNeed,
  type IntakeReq,
  type ProductOption,
} from "@needgrid/shared";
import { mockImage } from "./fixtures";

type OptionSeed = {
  title: string;
  retailer: string;
  host: string;
  query: string;
  unitPriceCents: number;
  packSize: number | null;
  image: string;
  fitScore: number;
  fitReason: string;
};

function option(seed: OptionSeed): ProductOption {
  return {
    channel3Id: `c3_mock_${seed.retailer.toLowerCase()}_${seed.query.replace(/\W+/g, "_")}`,
    title: seed.title,
    imageUrl: mockImage(seed.image),
    retailer: seed.retailer,
    url: `https://${seed.host}/search?q=${encodeURIComponent(seed.query)}`,
    unitPriceCents: seed.unitPriceCents,
    packSize: seed.packSize,
    inStock: true,
    fetchedAt: new Date().toISOString(),
    fitScore: seed.fitScore,
    fitReason: seed.fitReason,
    pricePerItemCents: seed.packSize ? Math.round(seed.unitPriceCents / seed.packSize) : null,
  };
}

function extracted(e: Omit<ExtractedNeed, "searchQuery"> & { searchQuery?: string }): ExtractedNeed {
  return { ...e, searchQuery: e.searchQuery ?? e.title };
}

function draftOf(e: ExtractedNeed, options: ProductOption[], suggestedTargetCents: number | null): DraftNeed {
  return { draftId: crypto.randomUUID(), extracted: e, options, suggestedTargetCents };
}

function sixDrafts(): IntakeRes {
  const diapers = [
    option({
      title: "Parent's Choice Diapers Size 4, 150 Count",
      retailer: "Walmart",
      host: "www.walmart.com",
      query: "parents choice diapers size 4 150",
      unitPriceCents: 3849,
      packSize: 150,
      image: "baby",
      fitScore: 0.95,
      fitReason: "Right size, biggest pack",
    }),
    option({
      title: "Huggies Little Movers Size 4, 120 Count",
      retailer: "Target",
      host: "www.target.com",
      query: "huggies little movers size 4",
      unitPriceCents: 4199,
      packSize: 120,
      image: "baby",
      fitScore: 0.88,
      fitReason: "Right size, smaller pack",
    }),
    option({
      title: "Pampers Cruisers Size 4, 112 Count",
      retailer: "Amazon",
      host: "www.amazon.com",
      query: "pampers cruisers size 4",
      unitPriceCents: 4497,
      packSize: 112,
      image: "baby",
      fitScore: 0.82,
      fitReason: "Right size, highest price",
    }),
  ];
  const wipes = [
    option({
      title: "Huggies Natural Care Sensitive Baby Wipes, Unscented, 72 Count",
      retailer: "Target",
      host: "www.target.com",
      query: "huggies natural care wipes unscented",
      unitPriceCents: 399,
      packSize: 72,
      image: "baby",
      fitScore: 0.93,
      fitReason: "Unscented, matches the list",
    }),
    option({
      title: "Pampers Sensitive Baby Wipes, Unscented, 56 Count",
      retailer: "Walmart",
      host: "www.walmart.com",
      query: "pampers sensitive wipes",
      unitPriceCents: 349,
      packSize: 56,
      image: "baby",
      fitScore: 0.86,
      fitReason: "Unscented, smaller pack",
    }),
  ];
  const peanutButter = [
    option({
      title: "Jif Creamy Peanut Butter, 40 oz",
      retailer: "Walmart",
      host: "www.walmart.com",
      query: "jif creamy peanut butter 40 oz",
      unitPriceCents: 798,
      packSize: 1,
      image: "food",
      fitScore: 0.9,
      fitReason: "Same size as the list",
    }),
  ];
  const toothpaste = [
    option({
      title: "Colgate Cavity Protection Toothpaste, 4 oz, 6 Pack",
      retailer: "Amazon",
      host: "www.amazon.com",
      query: "colgate cavity protection 4 oz 6 pack",
      unitPriceCents: 1149,
      packSize: null,
      image: "hygiene",
      fitScore: 0.8,
      fitReason: "Right size, sold as a multi-pack",
    }),
    option({
      title: "Crest Cavity Protection Toothpaste, 4.1 oz",
      retailer: "Target",
      host: "www.target.com",
      query: "crest cavity protection 4.1 oz",
      unitPriceCents: 349,
      packSize: 1,
      image: "hygiene",
      fitScore: 0.74,
      fitReason: "Single tube",
    }),
  ];
  const detergent = [
    option({
      title: "Tide Original Liquid Laundry Detergent, 92 fl oz",
      retailer: "Walmart",
      host: "www.walmart.com",
      query: "tide original liquid 92 oz",
      unitPriceCents: 1297,
      packSize: 1,
      image: "household",
      fitScore: 0.92,
      fitReason: "Matches the brand and size",
    }),
    option({
      title: "Gain Original Liquid Laundry Detergent, 88 fl oz",
      retailer: "Target",
      host: "www.target.com",
      query: "gain original liquid 88 oz",
      unitPriceCents: 1149,
      packSize: 1,
      image: "household",
      fitScore: 0.8,
      fitReason: "Same type, slightly smaller",
    }),
  ];

  const drafts: DraftNeed[] = [
    draftOf(
      extracted({
        title: "Diapers, size 4",
        quantity: 2,
        unit: "pack of 150",
        category: "baby",
        urgency: 3,
        notes: null,
        confidence: 0.95,
      }),
      diapers,
      computeTargetCents(3849, 2),
    ),
    draftOf(
      extracted({
        title: "Baby wipes, unscented",
        quantity: 3,
        unit: "pack of 72",
        category: "baby",
        urgency: 2,
        notes: null,
        confidence: 0.9,
      }),
      wipes,
      computeTargetCents(399, 3),
    ),
    draftOf(
      extracted({
        title: "Canned chicken",
        quantity: 24,
        unit: "can",
        category: "food",
        urgency: 2,
        notes: null,
        confidence: 0.85,
      }),
      [],
      null,
    ),
    draftOf(
      extracted({
        title: "Peanut butter, 40 oz",
        quantity: 6,
        unit: "jar",
        category: "food",
        urgency: 1,
        notes: "quantity hard to read",
        confidence: 0.45,
      }),
      peanutButter,
      computeTargetCents(798, 6),
    ),
    draftOf(
      extracted({
        title: "Toothpaste, 4 oz",
        quantity: 24,
        unit: "tube",
        category: "hygiene",
        urgency: 2,
        notes: "check how many come in one pack before publishing",
        confidence: 0.8,
      }),
      toothpaste,
      null,
    ),
    draftOf(
      extracted({
        title: "Laundry detergent",
        quantity: 4,
        unit: "bottle",
        category: "household",
        urgency: 1,
        notes: null,
        confidence: 0.9,
      }),
      detergent,
      computeTargetCents(1297, 4),
    ),
  ];

  return {
    drafts,
    warnings: [
      'No good product match for "Canned chicken". Paste a product link to choose one yourself.',
      'One line was hard to read. We marked it "Please check".',
    ],
  };
}

const URL_ONLY = /^https?:\/\/\S+$/i;
const LINK_NOT_FOUND = "Couldn't find a product at that link. Try another link, or type the item instead.";

/** A small, stable number for a string (prices for pasted links must not change between tries). */
function hashOf(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) % 1_000_003;
  return hash;
}

function titleFromPath(url: URL): string {
  const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
  const words = decodeURIComponent(last)
    .replace(/\.[a-z]+$/i, "")
    .split(/[-_\s]+/)
    .filter((word) => /^[a-z]+$/i.test(word));
  const title = words.join(" ");
  return title === "" ? "Product from your link" : title.charAt(0).toUpperCase() + title.slice(1);
}

/** A pasted retailer link: one draft with that exact product, like B's `intakeFromUrl`. */
function fromLink(raw: string): IntakeRes {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { drafts: [], warnings: [LINK_NOT_FOUND] };
  }
  if (url.hostname.includes("notfound")) return { drafts: [], warnings: [LINK_NOT_FOUND] };

  const retailerWord = url.hostname.replace(/^www\./, "").split(".")[0] ?? "store";
  const retailer = retailerWord.charAt(0).toUpperCase() + retailerWord.slice(1);
  const title = titleFromPath(url);
  const unitPriceCents = 399 + (hashOf(url.toString()) % 2600);
  const product: ProductOption = {
    channel3Id: `c3_mock_link_${hashOf(url.toString())}`,
    title,
    imageUrl: mockImage("food"),
    retailer,
    url: url.toString(),
    unitPriceCents,
    packSize: null,
    inStock: true,
    fetchedAt: new Date().toISOString(),
    fitScore: 1,
    fitReason: "The product you linked",
    pricePerItemCents: null,
  };
  return {
    drafts: [
      draftOf(
        extracted({
          title,
          quantity: 1,
          unit: "item",
          category: "other",
          urgency: 2,
          notes: "Added from a product link: set the quantity",
          searchQuery: title,
          confidence: 1,
        }),
        [product],
        computeTargetCents(unitPriceCents, 1),
      ),
    ],
    warnings: [],
  };
}

/** The mock's answer to a validated intake request. */
export function mockIntake(req: IntakeReq): IntakeRes {
  const text = req.text?.trim();
  return IntakeRes.parse(text && URL_ONLY.test(text) ? fromLink(text) : sixDrafts());
}

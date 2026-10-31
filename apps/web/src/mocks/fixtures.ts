/**
 * Hand-written mock data mirroring B's seed: three demo orgs, ~12 needs each across every status.
 * Every object is validated with its shared schema when this module loads, and the money rules are
 * checked too, so a contract change (or a typo here) breaks tests and the build immediately.
 *
 * Sample names and numbers come from the approved designs (Main, Landing, TileStates, ImpactPhone,
 * PurchasePlan, StaffConsole). Dates are relative to the clock when this module loads (see `rel`),
 * so deadlines stay ahead, deliveries stay in the past, and the mocks never go stale.
 */
import {
  Cents,
  computeTargetCents,
  DeliveryPublic,
  DeliveryView,
  formatUsd,
  NeedCard,
  OrgPublic,
  ProductSnapshot,
  PurchaseOffer,
  PurchaseView,
  remainingCents,
  SponsorInvoiceView,
  TimelineEvent,
  type AllocationReason,
  type Category,
  type NeedStatus,
} from "@needgrid/shared";
import { qrPngDataUrl } from "./qrPng";

// ---------- helpers ----------

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * The fixtures tell their story on a "story clock" that reads 12:00 UTC at the moment this module
 * loads (the designs were drawn around noon). `rel(days, "HH:MM")` is HH:MM on the story clock,
 * `days` days from today: `rel(1, "21:00")` is tomorrow evening (33 h from now), `rel(-7, "14:05")`
 * a week ago, `rel(0, "09:12")` this morning (2 h 48 min ago). Every date moves together, so the
 * order and the gaps between them never change. Keep past times today at or before "11:59".
 */
const STORY_TODAY = Date.now() - 12 * 60 * MINUTE_MS;

function rel(days: number, time: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new Error(`Mock fixture time must be "HH:MM", got "${time}"`);
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return new Date(STORY_TODAY + days * DAY_MS + minutes * MINUTE_MS).toISOString();
}

/** Mock images live in public/mock/. The schemas need absolute URLs, so build them from this page's origin. */
const ORIGIN = typeof window === "undefined" ? "http://localhost:5173" : window.location.origin;
export const mockImage = (name: string) => `${ORIGIN}/mock/${name}.svg`;

type OrgKey = "harbor" | "paws" | "room12";

type ProductSeed = {
  title: string;
  retailer: string;
  /** Retailer search URL host + query, e.g. ["www.walmart.com", "pampers cruisers size 4"]. */
  search: [host: string, query: string];
  unitPriceCents: number;
  packSize: number | null;
  /** Mock image name in public/mock, or null to show the design's grey placeholder. */
  image: string | null;
  /**
   * Hand-written product (groceries Channel3 doesn't sell, NOTES.md decisions): its id becomes
   * `manual-<slug>` and the purchase plan never refreshes its price.
   */
  manual?: string;
};

type NeedSeed = {
  id: string;
  org: OrgKey;
  title: string;
  description: string;
  category: Category;
  urgency: 1 | 2 | 3;
  quantity: number;
  unit: string;
  status: NeedStatus;
  fundedCents: number;
  heldCents: number;
  donorCount: number;
  product: ProductSeed;
  deadlineAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Lifecycle timestamps used to build the timeline. */
  fundedAt?: string;
  approvedAt?: string;
  orderedAt?: string;
  orderRef?: string;
  deliveredAt?: string;
  closedAt?: string;
  /** topping_up only: the price the tile was first funded at (the approved offer was pricier). */
  previousUnitPriceCents?: number;
  /** delivered only. */
  delivery?: { message: string; aiNotes: string; matchScore: number };
  alternatives?: ProductSeed[];
};

function productSnapshot(p: ProductSeed, fetchedAt: string, id: string): ProductSnapshot {
  const [host, query] = p.search;
  return ProductSnapshot.parse({
    channel3Id: p.manual ? `${MANUAL_PRODUCT_PREFIX}${p.manual}` : `c3_${id.slice(-6)}_${p.retailer.toLowerCase()}`,
    title: p.title,
    imageUrl: p.image ? mockImage(p.image) : null,
    retailer: p.retailer,
    url: `https://${host}/search?q=${encodeURIComponent(query)}`,
    unitPriceCents: p.unitPriceCents,
    packSize: p.packSize,
    inStock: true,
    fetchedAt,
  });
}

/** Hand-written products have ids like `manual-jif-creamy-peanut-butter-40-oz` (NOTES.md decisions). */
export const MANUAL_PRODUCT_PREFIX = "manual-";

/** A stored product as a purchase offer (what a purchase plan buys). */
export function toOffer(p: ProductSnapshot): PurchaseOffer {
  return PurchaseOffer.parse({
    channel3Id: p.channel3Id,
    title: p.title,
    retailer: p.retailer,
    url: p.url,
    imageUrl: p.imageUrl,
    unitPriceCents: p.unitPriceCents,
    inStock: p.inStock,
  });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---------- orgs ----------

export const ORG_IDS: Record<OrgKey, string> = {
  harbor: "4c1f7a2e-9b3d-4e5f-8a6b-000000000001",
  paws: "4c1f7a2e-9b3d-4e5f-8a6b-000000000002",
  room12: "4c1f7a2e-9b3d-4e5f-8a6b-000000000003",
};

export const orgs: OrgPublic[] = [
  {
    id: ORG_IDS.harbor,
    slug: "harbor-food-bank",
    name: "Harbor Food Bank",
    city: "Portland, ME",
    description:
      "We feed 400 families a week. These are the exact items our shelves are missing right now. Fund one, and we'll post a photo when it arrives.",
    causeTags: ["Food bank"],
    logoUrl: null,
  },
  {
    id: ORG_IDS.paws,
    slug: "second-chance-paws",
    name: "Second Chance Paws",
    city: "Austin, TX",
    description:
      "We pull dogs and cats from overcrowded shelters and foster them until they find a home. Everything here goes straight to our foster families.",
    causeTags: ["Animal rescue"],
    logoUrl: null,
  },
  {
    id: ORG_IDS.room12,
    slug: "room-12-readers",
    name: "Room 12 Readers",
    city: "Columbus, OH",
    description:
      "A second-grade class of 24 readers at a public elementary school. We post what the class runs out of, from chapter books to winter coats.",
    causeTags: ["Classroom"],
    logoUrl: null,
  },
].map((o) => OrgPublic.parse(o));

/** Demo staff passcodes (public by design, sandbox only) → org id. */
export const STAFF_PASSCODES: Record<string, string> = {
  "harbor-demo-2026": ORG_IDS.harbor,
  "paws-demo-2026": ORG_IDS.paws,
  "room12-demo-2026": ORG_IDS.room12,
};

// ---------- needs ----------

const ORG_SLUG: Record<OrgKey, string> = {
  harbor: "harbor-food-bank",
  paws: "second-chance-paws",
  room12: "room-12-readers",
};

const NEED_SEEDS: NeedSeed[] = [
  // ----- Harbor Food Bank (14) -----
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000101",
    org: "harbor",
    title: "Diapers, size 4",
    description: "Our most-asked-for item. Families with toddlers go through a pack a week.",
    category: "baby",
    urgency: 3,
    quantity: 2,
    unit: "pack of 150",
    status: "open",
    fundedCents: 7000,
    heldCents: 0,
    donorCount: 6,
    product: {
      title: "Pampers Cruisers Diapers, Size 4, 150 Count",
      retailer: "Walmart",
      search: ["www.walmart.com", "pampers cruisers size 4 150"],
      unitPriceCents: 3849,
      packSize: 150,
      image: "baby",
    },
    alternatives: [
      {
        title: "Huggies Little Movers Diapers, Size 4, 140 Count",
        retailer: "Target",
        search: ["www.target.com", "huggies little movers size 4"],
        unitPriceCents: 3999,
        packSize: 140,
        image: "baby",
      },
    ],
    deadlineAt: rel(1, "21:00"),
    createdAt: rel(-7, "14:05"),
    updatedAt: rel(-1, "18:20"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000102",
    org: "harbor",
    title: "Infant formula, 12.4 oz",
    description: "Standard milk-based formula. We can't accept opened cans, so new ones make a big difference.",
    category: "baby",
    urgency: 3,
    quantity: 6,
    unit: "can",
    status: "open",
    fundedCents: 4100,
    heldCents: 1500,
    donorCount: 5,
    product: {
      title: "Similac 360 Total Care Infant Formula Powder, 12.4 oz",
      retailer: "Target",
      search: ["www.target.com", "similac 360 total care 12.4 oz"],
      unitPriceCents: 1719,
      packSize: null,
      image: "baby",
    },
    deadlineAt: rel(2, "21:00"),
    createdAt: rel(-7, "14:06"),
    updatedAt: rel(0, "09:12"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000103",
    org: "harbor",
    title: "Baby wipes, unscented",
    description: "Unscented wipes for sensitive skin.",
    category: "baby",
    urgency: 2,
    quantity: 6,
    unit: "pack of 72",
    status: "open",
    fundedCents: 2200,
    heldCents: 0,
    donorCount: 3,
    product: {
      title: "Huggies Natural Care Sensitive Baby Wipes, Unscented, 72 Count",
      retailer: "Walmart",
      search: ["www.walmart.com", "huggies natural care sensitive wipes 72"],
      unitPriceCents: 629,
      packSize: 72,
      image: "baby",
    },
    deadlineAt: rel(4, "21:00"),
    createdAt: rel(-7, "14:07"),
    updatedAt: rel(-2, "16:40"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000104",
    org: "harbor",
    title: "Canned chicken, 12.5 oz",
    description: "Protein that keeps. One can makes dinner for a family of four.",
    category: "food",
    urgency: 2,
    quantity: 24,
    unit: "can",
    status: "open",
    fundedCents: 3000,
    heldCents: 1000,
    donorCount: 4,
    product: {
      title: "Great Value Chunk Chicken Breast in Water, 12.5 oz",
      retailer: "Walmart",
      search: ["www.walmart.com", "great value chunk chicken breast 12.5 oz"],
      unitPriceCents: 254,
      packSize: null,
      image: "food",
      manual: "great-value-chunk-chicken-breast-12-5-oz",
    },
    deadlineAt: rel(5, "21:00"),
    createdAt: rel(-6, "10:15"),
    updatedAt: rel(0, "08:55"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000105",
    org: "harbor",
    title: "Peanut butter, 40 oz",
    description: "Big jars last a family a month.",
    category: "food",
    urgency: 2,
    quantity: 12,
    unit: "jar",
    status: "open",
    fundedCents: 1500,
    heldCents: 0,
    donorCount: 2,
    product: {
      title: "Jif Creamy Peanut Butter, 40 oz",
      retailer: "Amazon",
      search: ["www.amazon.com", "jif creamy peanut butter 40 oz"],
      unitPriceCents: 568,
      packSize: null,
      image: null,
      manual: "jif-creamy-peanut-butter-40-oz",
    },
    deadlineAt: rel(16, "21:00"),
    createdAt: rel(-6, "10:16"),
    updatedAt: rel(-3, "12:00"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000106",
    org: "harbor",
    title: "Toothpaste, 4 oz",
    description: "Goes into our monthly hygiene kits.",
    category: "hygiene",
    urgency: 1,
    quantity: 36,
    unit: "tube",
    status: "open",
    fundedCents: 1000,
    heldCents: 0,
    donorCount: 1,
    product: {
      title: "Colgate Cavity Protection Toothpaste, 4 oz",
      retailer: "Amazon",
      search: ["www.amazon.com", "colgate cavity protection toothpaste 4 oz"],
      unitPriceCents: 132,
      packSize: null,
      image: "hygiene",
    },
    deadlineAt: rel(22, "21:00"),
    createdAt: rel(-6, "10:17"),
    updatedAt: rel(-4, "19:30"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000107",
    org: "harbor",
    title: "Rolled oats, 42 oz",
    description: "Breakfast for our weekend backpack program.",
    category: "food",
    urgency: 1,
    quantity: 10,
    unit: "canister",
    status: "open",
    fundedCents: 0,
    heldCents: 0,
    donorCount: 0,
    product: {
      title: "Quaker Old Fashioned Rolled Oats, 42 oz",
      retailer: "Walmart",
      search: ["www.walmart.com", "quaker old fashioned oats 42 oz"],
      unitPriceCents: 524,
      packSize: null,
      image: "food",
      manual: "quaker-old-fashioned-oats-42-oz",
    },
    deadlineAt: rel(27, "21:00"),
    createdAt: rel(-5, "09:00"),
    updatedAt: rel(-5, "09:00"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000108",
    org: "harbor",
    title: "Canned tuna, 5 oz",
    description: "Easy protein for our grab-and-go shelf.",
    category: "food",
    urgency: 2,
    quantity: 48,
    unit: "can",
    status: "topping_up",
    fundedCents: 7100,
    heldCents: 0,
    donorCount: 5,
    previousUnitPriceCents: 136,
    product: {
      title: "StarKist Chunk Light Tuna in Water, 5 oz",
      retailer: "Walmart",
      search: ["www.walmart.com", "starkist chunk light tuna 5 oz"],
      unitPriceCents: 146,
      packSize: null,
      image: "food",
      manual: "starkist-chunk-light-tuna-5-oz",
    },
    deadlineAt: null,
    createdAt: rel(-8, "11:00"),
    fundedAt: rel(-2, "15:10"),
    approvedAt: rel(-1, "10:30"),
    updatedAt: rel(-1, "10:30"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000109",
    org: "harbor",
    title: "Kids' toothbrushes",
    description: "Soft brushes for our school-age kits.",
    category: "hygiene",
    urgency: 2,
    quantity: 4,
    unit: "pack of 12",
    status: "funded",
    fundedCents: 3800,
    heldCents: 0,
    donorCount: 3,
    product: {
      title: "Colgate Kids Extra Soft Toothbrushes, 12 Pack",
      retailer: "Amazon",
      search: ["www.amazon.com", "colgate kids extra soft toothbrush 12 pack"],
      unitPriceCents: 869,
      packSize: 12,
      image: "hygiene",
    },
    deadlineAt: null,
    createdAt: rel(-9, "13:00"),
    fundedAt: rel(-1, "17:45"),
    updatedAt: rel(-1, "17:45"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000110",
    org: "harbor",
    title: "Laundry detergent",
    description: "For families staying in our partner shelter's laundry room.",
    category: "household",
    urgency: 1,
    quantity: 6,
    unit: "92 oz bottle",
    status: "funded",
    fundedCents: 9500,
    heldCents: 0,
    donorCount: 8,
    product: {
      title: "Tide Original Liquid Laundry Detergent, 92 fl oz",
      retailer: "Target",
      search: ["www.target.com", "tide original liquid detergent 92 oz"],
      unitPriceCents: 1459,
      packSize: null,
      image: "household",
    },
    deadlineAt: null,
    createdAt: rel(-10, "09:30"),
    fundedAt: rel(0, "08:40"),
    updatedAt: rel(0, "08:40"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000111",
    org: "harbor",
    title: "Women's socks",
    description: "Warm socks are the first thing to go when it gets cold.",
    category: "clothing",
    urgency: 1,
    quantity: 4,
    unit: "pack of 12",
    status: "ordered",
    fundedCents: 5600,
    heldCents: 0,
    donorCount: 3,
    product: {
      title: "Hanes Women's Cushioned Crew Socks, 12 Pack",
      retailer: "Target",
      search: ["www.target.com", "hanes womens crew socks 12 pack"],
      unitPriceCents: 1289,
      packSize: 12,
      image: "clothing",
    },
    deadlineAt: null,
    createdAt: rel(-11, "10:00"),
    fundedAt: rel(-4, "20:15"),
    approvedAt: rel(-3, "14:00"),
    orderedAt: rel(-3, "14:20"),
    orderRef: "TGT-4417-2290",
    updatedAt: rel(-3, "14:20"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000112",
    org: "harbor",
    title: "Diapers, size 3",
    description: "Size 3 runs out right after size 4.",
    category: "baby",
    urgency: 3,
    quantity: 2,
    unit: "pack of 164",
    status: "delivered",
    fundedCents: 8400,
    heldCents: 0,
    donorCount: 7,
    product: {
      title: "Pampers Swaddlers Diapers, Size 3, 164 Count",
      retailer: "Walmart",
      search: ["www.walmart.com", "pampers swaddlers size 3 164"],
      unitPriceCents: 3869,
      packSize: 164,
      image: "baby",
    },
    deadlineAt: null,
    createdAt: rel(-14, "12:00"),
    fundedAt: rel(-9, "15:42"),
    approvedAt: rel(-8, "09:00"),
    orderedAt: rel(-8, "09:15"),
    orderRef: "WM-2000-118-5521",
    deliveredAt: rel(-2, "15:30"),
    delivery: {
      message: "They were on the shelf by lunch the day they arrived. Thank you for keeping 30 families in diapers.",
      aiNotes: "Two packs of Pampers Swaddlers size 3 on a shelf. Matches the posted product and quantity.",
      matchScore: 0.93,
    },
    updatedAt: rel(-2, "15:30"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000113",
    org: "harbor",
    title: "Hand soap, 7.5 oz",
    description: "",
    category: "hygiene",
    urgency: 2,
    quantity: 12,
    unit: "bottle",
    status: "draft",
    fundedCents: 0,
    heldCents: 0,
    donorCount: 0,
    product: {
      title: "Softsoap Moisturizing Liquid Hand Soap, 7.5 fl oz",
      retailer: "Walmart",
      search: ["www.walmart.com", "softsoap liquid hand soap 7.5 oz"],
      unitPriceCents: 129,
      packSize: null,
      image: "hygiene",
    },
    deadlineAt: null,
    createdAt: rel(0, "08:00"),
    updatedAt: rel(0, "08:00"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000114",
    org: "harbor",
    title: "Paper towels",
    description: "A local store donated a pallet, so we no longer need these.",
    category: "household",
    urgency: 1,
    quantity: 4,
    unit: "pack of 6 rolls",
    status: "closed",
    fundedCents: 0,
    heldCents: 0,
    donorCount: 0,
    product: {
      title: "Bounty Select-A-Size Paper Towels, 6 Double Rolls",
      retailer: "Amazon",
      search: ["www.amazon.com", "bounty select a size paper towels 6 double rolls"],
      unitPriceCents: 1199,
      packSize: 6,
      image: "household",
    },
    deadlineAt: null,
    createdAt: rel(-13, "09:00"),
    closedAt: rel(-7, "16:00"),
    updatedAt: rel(-7, "16:00"),
  },

  // ----- Second Chance Paws (12) -----
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000201",
    org: "paws",
    title: "Puppy food, 30 lb bag",
    description: "We have a litter of eight in foster care right now.",
    category: "pet",
    urgency: 3,
    quantity: 2,
    unit: "bag",
    status: "open",
    fundedCents: 4500,
    heldCents: 0,
    donorCount: 4,
    product: {
      title: "Purina Puppy Chow High Protein Dry Puppy Food, 30 lb",
      retailer: "Chewy",
      search: ["www.chewy.com", "purina puppy chow 30 lb"],
      unitPriceCents: 3298,
      packSize: null,
      image: "pet",
    },
    deadlineAt: rel(2, "22:00"),
    createdAt: rel(-6, "15:00"),
    updatedAt: rel(-1, "21:10"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000202",
    org: "paws",
    title: "Cat litter, 40 lb",
    description: "Clumping litter for 15 foster cats.",
    category: "pet",
    urgency: 3,
    quantity: 3,
    unit: "40 lb box",
    status: "open",
    fundedCents: 2000,
    heldCents: 1200,
    donorCount: 3,
    product: {
      title: "Tidy Cats Clumping Multi-Cat Litter, 40 lb",
      retailer: "Chewy",
      search: ["www.chewy.com", "tidy cats clumping litter 40 lb"],
      unitPriceCents: 2198,
      packSize: null,
      image: "pet",
    },
    deadlineAt: rel(3, "22:00"),
    createdAt: rel(-6, "15:01"),
    updatedAt: rel(0, "10:05"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000203",
    org: "paws",
    title: "Flea and tick treatment",
    description: "Every rescue gets treated on intake.",
    category: "medical",
    urgency: 2,
    quantity: 2,
    unit: "pack of 6 doses",
    status: "open",
    fundedCents: 6000,
    heldCents: 0,
    donorCount: 5,
    product: {
      title: "Frontline Plus Flea and Tick Treatment for Dogs, 6 Doses",
      retailer: "Chewy",
      search: ["www.chewy.com", "frontline plus dogs 6 doses"],
      unitPriceCents: 5499,
      packSize: 6,
      image: "medical",
    },
    deadlineAt: rel(8, "22:00"),
    createdAt: rel(-7, "12:00"),
    updatedAt: rel(-2, "18:00"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000204",
    org: "paws",
    title: "Puppy training pads",
    description: "Foster homes go through these fast.",
    category: "pet",
    urgency: 2,
    quantity: 3,
    unit: "pack of 100",
    status: "open",
    fundedCents: 1500,
    heldCents: 0,
    donorCount: 2,
    product: {
      title: "Amazon Basics Dog and Puppy Training Pads, 100 Count",
      retailer: "Amazon",
      search: ["www.amazon.com", "amazon basics puppy training pads 100"],
      unitPriceCents: 2349,
      packSize: 100,
      image: "pet",
    },
    deadlineAt: rel(12, "22:00"),
    createdAt: rel(-5, "09:00"),
    updatedAt: rel(-3, "13:00"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000205",
    org: "paws",
    title: "Dog leashes, 6 ft",
    description: "Every dog goes home with a leash.",
    category: "pet",
    urgency: 1,
    quantity: 10,
    unit: "leash",
    status: "open",
    fundedCents: 0,
    heldCents: 0,
    donorCount: 0,
    product: {
      title: "Frisco Solid Nylon Dog Leash, 6 ft",
      retailer: "Chewy",
      search: ["www.chewy.com", "frisco nylon dog leash 6 ft"],
      unitPriceCents: 799,
      packSize: null,
      image: null,
    },
    deadlineAt: null,
    createdAt: rel(-4, "10:00"),
    updatedAt: rel(-4, "10:00"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000206",
    org: "paws",
    title: "Kitten milk replacer",
    description: "Bottle babies need feeding every few hours.",
    category: "pet",
    urgency: 3,
    quantity: 4,
    unit: "12 oz can",
    status: "open",
    fundedCents: 9800,
    heldCents: 0,
    donorCount: 6,
    product: {
      title: "PetAg KMR Kitten Milk Replacer Powder, 12 oz",
      retailer: "Chewy",
      search: ["www.chewy.com", "petag kmr kitten milk replacer 12 oz"],
      unitPriceCents: 2899,
      packSize: null,
      image: "pet",
    },
    deadlineAt: rel(1, "22:00"),
    createdAt: rel(-3, "08:00"),
    updatedAt: rel(0, "07:30"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000207",
    org: "paws",
    title: "Kennel blankets",
    description: "Soft fleece for the dogs waiting in boarding.",
    category: "bedding",
    urgency: 2,
    quantity: 2,
    unit: "pack of 10",
    status: "topping_up",
    fundedCents: 7200,
    heldCents: 0,
    donorCount: 6,
    previousUnitPriceCents: 3299,
    product: {
      title: "Utopia Bedding Fleece Throw Blankets, 10 Pack",
      retailer: "Amazon",
      search: ["www.amazon.com", "utopia bedding fleece blanket 10 pack"],
      unitPriceCents: 3499,
      packSize: 10,
      image: "bedding",
    },
    deadlineAt: null,
    createdAt: rel(-9, "10:00"),
    fundedAt: rel(-3, "19:00"),
    approvedAt: rel(-2, "11:00"),
    updatedAt: rel(-2, "11:00"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000208",
    org: "paws",
    title: "Enzyme cleaner, 1 gal",
    description: "Keeps foster homes happy.",
    category: "household",
    urgency: 2,
    quantity: 4,
    unit: "1 gal bottle",
    status: "funded",
    fundedCents: 10800,
    heldCents: 0,
    donorCount: 9,
    product: {
      title: "Nature's Miracle Stain and Odor Remover, 1 gal",
      retailer: "Chewy",
      search: ["www.chewy.com", "natures miracle stain odor remover gallon"],
      unitPriceCents: 2499,
      packSize: null,
      image: "household",
    },
    deadlineAt: null,
    createdAt: rel(-10, "10:00"),
    fundedAt: rel(-1, "12:00"),
    updatedAt: rel(-1, "12:00"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000209",
    org: "paws",
    title: "Chew toys",
    description: "Bored puppies chew furniture. Toys save foster couches.",
    category: "pet",
    urgency: 1,
    quantity: 3,
    unit: "pack of 6",
    status: "ordered",
    fundedCents: 6200,
    heldCents: 0,
    donorCount: 4,
    product: {
      title: "Nylabone Power Chew Variety Pack, 6 Count",
      retailer: "Amazon",
      search: ["www.amazon.com", "nylabone power chew variety pack 6"],
      unitPriceCents: 1899,
      packSize: 6,
      image: "pet",
    },
    deadlineAt: null,
    createdAt: rel(-12, "10:00"),
    fundedAt: rel(-5, "18:00"),
    approvedAt: rel(-4, "10:00"),
    orderedAt: rel(-4, "10:20"),
    orderRef: "AMZ-114-7720391-5521",
    updatedAt: rel(-4, "10:20"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000210",
    org: "paws",
    title: "Cat carriers",
    description: "Every adoption event needs carriers.",
    category: "pet",
    urgency: 2,
    quantity: 2,
    unit: "carrier",
    status: "delivered",
    fundedCents: 6100,
    heldCents: 0,
    donorCount: 5,
    product: {
      title: "Frisco Two-Door Top Load Cat Kennel, 19 in",
      retailer: "Chewy",
      search: ["www.chewy.com", "frisco two door top load cat kennel"],
      unitPriceCents: 2799,
      packSize: null,
      image: "pet",
    },
    deadlineAt: null,
    createdAt: rel(-17, "10:00"),
    fundedAt: rel(-11, "16:00"),
    approvedAt: rel(-10, "09:00"),
    orderedAt: rel(-10, "09:30"),
    orderRef: "CHW-88231907",
    deliveredAt: rel(-6, "17:00"),
    delivery: {
      message: "Two new carriers, already put to use at our latest adoption event. Thank you!",
      aiNotes: "Two grey top-load cat carriers, tags still on. Matches the posted product.",
      matchScore: 0.88,
    },
    updatedAt: rel(-6, "17:00"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000211",
    org: "paws",
    title: "Grooming wipes",
    description: "",
    category: "pet",
    urgency: 1,
    quantity: 6,
    unit: "pack of 100",
    status: "draft",
    fundedCents: 0,
    heldCents: 0,
    donorCount: 0,
    product: {
      title: "Earth Rated Dog Wipes, Unscented, 100 Count",
      retailer: "Amazon",
      search: ["www.amazon.com", "earth rated dog wipes unscented 100"],
      unitPriceCents: 1299,
      packSize: 100,
      image: "pet",
    },
    deadlineAt: null,
    createdAt: rel(-1, "20:00"),
    updatedAt: rel(-1, "20:00"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000212",
    org: "paws",
    title: "Heated pet bed",
    description: "A vet clinic donated two, so this one isn't needed any more.",
    category: "bedding",
    urgency: 1,
    quantity: 1,
    unit: "bed",
    status: "closed",
    fundedCents: 0,
    heldCents: 0,
    donorCount: 0,
    product: {
      title: "K&H Thermo-Snuggly Sleeper Heated Pet Bed, Medium",
      retailer: "Amazon",
      search: ["www.amazon.com", "k&h thermo snuggly sleeper medium"],
      unitPriceCents: 4599,
      packSize: null,
      image: "bedding",
    },
    deadlineAt: null,
    createdAt: rel(-15, "10:00"),
    closedAt: rel(-8, "10:00"),
    updatedAt: rel(-8, "10:00"),
  },

  // ----- Room 12 Readers (12) -----
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000301",
    org: "room12",
    title: "Winter coats, kids' size 6–7",
    description: "Several of our readers came to school in hoodies last week.",
    category: "clothing",
    urgency: 3,
    quantity: 4,
    unit: "coat",
    status: "open",
    fundedCents: 3000,
    heldCents: 0,
    donorCount: 2,
    product: {
      title: "Cat & Jack Kids' Long Puffer Jacket, Size 6/7",
      retailer: "Target",
      search: ["www.target.com", "cat and jack kids long puffer jacket 6/7"],
      unitPriceCents: 3500,
      packSize: null,
      image: "clothing",
    },
    deadlineAt: rel(8, "22:00"),
    createdAt: rel(-3, "14:00"),
    updatedAt: rel(-1, "15:00"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000302",
    org: "room12",
    title: "Winter coats, kids' size 8",
    description: "Several of our readers came to school in hoodies last week.",
    category: "clothing",
    urgency: 3,
    quantity: 4,
    unit: "coat",
    status: "open",
    fundedCents: 0,
    heldCents: 0,
    donorCount: 0,
    product: {
      title: "Cat & Jack Kids' Long Puffer Jacket, Size 8",
      retailer: "Target",
      search: ["www.target.com", "cat and jack kids long puffer jacket 8"],
      unitPriceCents: 3500,
      packSize: null,
      image: "clothing",
    },
    deadlineAt: rel(8, "22:00"),
    createdAt: rel(-3, "14:01"),
    updatedAt: rel(-3, "14:01"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000303",
    org: "room12",
    title: "Winter coats, kids' size 10–12",
    description: "Several of our readers came to school in hoodies last week.",
    category: "clothing",
    urgency: 3,
    quantity: 3,
    unit: "coat",
    status: "open",
    fundedCents: 1000,
    heldCents: 1500,
    donorCount: 1,
    product: {
      title: "Cat & Jack Kids' Long Puffer Jacket, Size 10/12",
      retailer: "Target",
      search: ["www.target.com", "cat and jack kids long puffer jacket 10/12"],
      unitPriceCents: 3800,
      packSize: null,
      image: "clothing",
    },
    deadlineAt: rel(8, "22:00"),
    createdAt: rel(-3, "14:02"),
    updatedAt: rel(0, "11:00"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000304",
    org: "room12",
    title: "Chapter books, grades 2–3",
    description: "Our classroom library is down to the books nobody wants.",
    category: "school",
    urgency: 2,
    quantity: 2,
    unit: "set of 24",
    status: "open",
    fundedCents: 5200,
    heldCents: 0,
    donorCount: 4,
    product: {
      title: "Scholastic Grade 2–3 Chapter Book Classroom Library, 24 Books",
      retailer: "Amazon",
      search: ["www.amazon.com", "scholastic grade 2-3 chapter book classroom library"],
      unitPriceCents: 6499,
      packSize: 24,
      image: "school",
    },
    deadlineAt: rel(22, "22:00"),
    createdAt: rel(-8, "14:00"),
    updatedAt: rel(-2, "20:00"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000305",
    org: "room12",
    title: "Dry-erase markers",
    description: "For our small-group whiteboards.",
    category: "school",
    urgency: 2,
    quantity: 4,
    unit: "pack of 12",
    status: "open",
    fundedCents: 2500,
    heldCents: 0,
    donorCount: 2,
    product: {
      title: "EXPO Low-Odor Dry Erase Markers, Chisel Tip, 12 Pack",
      retailer: "Amazon",
      search: ["www.amazon.com", "expo low odor dry erase markers 12 pack"],
      unitPriceCents: 1399,
      packSize: 12,
      image: "school",
    },
    deadlineAt: null,
    createdAt: rel(-7, "14:00"),
    updatedAt: rel(-4, "16:00"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000306",
    org: "room12",
    title: "Pencils, #2",
    description: "We go through a pack of 96 every month.",
    category: "school",
    urgency: 1,
    quantity: 4,
    unit: "pack of 96",
    status: "topping_up",
    fundedCents: 7600,
    heldCents: 0,
    donorCount: 5,
    previousUnitPriceCents: 1749,
    product: {
      title: "Ticonderoga #2 HB Wood-Cased Pencils, 96 Count",
      retailer: "Amazon",
      search: ["www.amazon.com", "ticonderoga #2 pencils 96"],
      unitPriceCents: 1899,
      packSize: 96,
      image: "school",
    },
    deadlineAt: null,
    createdAt: rel(-11, "14:00"),
    fundedAt: rel(-3, "12:00"),
    approvedAt: rel(-2, "08:30"),
    updatedAt: rel(-2, "08:30"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000307",
    org: "room12",
    title: "Snacks for reading club",
    description: "Friday reading club runs into lunch, and some of our readers skip breakfast.",
    category: "food",
    urgency: 2,
    quantity: 4,
    unit: "box of 30 packs",
    status: "funded",
    fundedCents: 5700,
    heldCents: 0,
    donorCount: 4,
    product: {
      title: "Pepperidge Farm Goldfish Cheddar Crackers, 30 Snack Packs",
      retailer: "Walmart",
      search: ["www.walmart.com", "goldfish cheddar crackers 30 snack packs"],
      unitPriceCents: 1298,
      packSize: 30,
      image: "food",
      manual: "goldfish-cheddar-30-snack-packs",
    },
    deadlineAt: null,
    createdAt: rel(-10, "14:00"),
    fundedAt: rel(-1, "19:00"),
    updatedAt: rel(-1, "19:00"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000308",
    org: "room12",
    title: "Tissues",
    description: "Cold season is here.",
    category: "hygiene",
    urgency: 1,
    quantity: 2,
    unit: "pack of 12 boxes",
    status: "ordered",
    fundedCents: 4800,
    heldCents: 0,
    donorCount: 3,
    product: {
      title: "Kleenex Trusted Care Facial Tissues, 12 Boxes",
      retailer: "Target",
      search: ["www.target.com", "kleenex trusted care 12 boxes"],
      unitPriceCents: 2199,
      packSize: 12,
      image: "hygiene",
    },
    deadlineAt: null,
    createdAt: rel(-13, "14:00"),
    fundedAt: rel(-6, "12:00"),
    approvedAt: rel(-5, "08:00"),
    orderedAt: rel(-5, "08:10"),
    orderRef: "TGT-9902-1184",
    updatedAt: rel(-5, "08:10"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000309",
    org: "room12",
    title: "Kids' winter coats, size 4–5",
    description: "For our youngest readers.",
    category: "clothing",
    urgency: 3,
    quantity: 4,
    unit: "coat",
    status: "delivered",
    fundedCents: 13900,
    heldCents: 0,
    donorCount: 9,
    product: {
      title: "Cat & Jack Kids' Puffer Jacket, Size 4/5",
      retailer: "Target",
      search: ["www.target.com", "cat and jack kids puffer jacket 4/5"],
      unitPriceCents: 3200,
      packSize: null,
      image: "clothing",
    },
    deadlineAt: null,
    createdAt: rel(-19, "14:00"),
    fundedAt: rel(-13, "18:00"),
    approvedAt: rel(-12, "08:00"),
    orderedAt: rel(-12, "08:20"),
    orderRef: "TGT-7710-3302",
    deliveredAt: rel(-7, "19:00"),
    delivery: {
      message: "Four warm coats for our youngest readers. They wore them out to recess the same day!",
      aiNotes: "Four children's puffer jackets on a classroom coat rack. Matches the posted product and quantity.",
      matchScore: 0.91,
    },
    updatedAt: rel(-7, "19:00"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000310",
    org: "room12",
    title: "Hand sanitizer",
    description: "",
    category: "hygiene",
    urgency: 1,
    quantity: 6,
    unit: "8 oz bottle",
    status: "draft",
    fundedCents: 0,
    heldCents: 0,
    donorCount: 0,
    product: {
      title: "Purell Advanced Hand Sanitizer Gel, 8 fl oz",
      retailer: "Walmart",
      search: ["www.walmart.com", "purell advanced hand sanitizer 8 oz"],
      unitPriceCents: 399,
      packSize: null,
      image: "hygiene",
    },
    deadlineAt: null,
    createdAt: rel(0, "07:00"),
    updatedAt: rel(0, "07:00"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000311",
    org: "room12",
    title: "Glue sticks",
    description: "Art projects every Friday.",
    category: "school",
    urgency: 1,
    quantity: 2,
    unit: "pack of 30",
    status: "open",
    fundedCents: 900,
    heldCents: 0,
    donorCount: 1,
    product: {
      title: "Elmer's Disappearing Purple Glue Sticks, 30 Count",
      retailer: "Amazon",
      search: ["www.amazon.com", "elmers disappearing purple glue sticks 30"],
      unitPriceCents: 1149,
      packSize: 30,
      image: null,
    },
    deadlineAt: null,
    createdAt: rel(-5, "14:00"),
    updatedAt: rel(-3, "09:00"),
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000312",
    org: "room12",
    title: "Bean bag chairs",
    description: "The PTA bought these for the reading corner instead.",
    category: "household",
    urgency: 1,
    quantity: 2,
    unit: "chair",
    status: "closed",
    fundedCents: 0,
    heldCents: 0,
    donorCount: 0,
    product: {
      title: "Big Joe Milano Bean Bag Chair",
      retailer: "Amazon",
      search: ["www.amazon.com", "big joe milano bean bag chair"],
      unitPriceCents: 4999,
      packSize: null,
      image: "household",
    },
    deadlineAt: null,
    createdAt: rel(-16, "14:00"),
    closedAt: rel(-9, "14:00"),
    updatedAt: rel(-9, "14:00"),
  },
];

// ---------- money and status rules (mirror A's invariants) ----------

const FUNDED_STATUSES: NeedStatus[] = ["funded", "ordered", "delivered"];

function assertNeedConsistent(n: NeedCard, seed: NeedSeed): void {
  const fail = (msg: string): never => {
    throw new Error(`Mock fixture "${n.title}" (${n.id}) is inconsistent: ${msg}`);
  };
  if (!n.product) fail("every mock need has a product");
  else if (n.targetCents !== computeTargetCents(n.product.unitPriceCents, n.quantity)) {
    fail("targetCents must equal computeTargetCents(product.unitPriceCents, quantity)");
  }
  if (n.remainingCents !== remainingCents(n)) fail("remainingCents must be max(0, target − funded − held)");
  if ((n.donorCount === 0) !== (n.fundedCents === 0)) fail("donorCount must be 0 exactly when fundedCents is 0");
  if (FUNDED_STATUSES.includes(n.status) && (n.fundedCents < n.targetCents || n.heldCents !== 0)) {
    fail(`a ${n.status} need is fully funded with no holds`);
  }
  if ((n.status === "open" || n.status === "topping_up") && n.fundedCents >= n.targetCents) {
    fail(`a ${n.status} need is not fully funded yet`);
  }
  if ((n.status === "draft" || n.status === "closed") && (n.fundedCents !== 0 || n.heldCents !== 0)) {
    fail(`a ${n.status} need has no money attached`);
  }
  if (n.status === "topping_up") {
    if (seed.previousUnitPriceCents === undefined) fail("topping_up needs previousUnitPriceCents");
    else if (n.fundedCents !== computeTargetCents(seed.previousUnitPriceCents, n.quantity)) {
      fail("a topping_up need was fully funded at its previous target");
    }
  }
  if (n.status === "delivered" && !seed.delivery) fail("a delivered need has a delivery");
}

// ---------- build ----------

export type MockNeed = {
  card: NeedCard;
  timeline: TimelineEvent[];
  delivery: DeliveryPublic | null;
  /** Staff-only detail. */
  alternatives: ProductSnapshot[];
  purchases: PurchaseView[];
  deliveryView: DeliveryView | null;
};

function buildTimeline(s: NeedSeed, card: NeedCard): TimelineEvent[] {
  const events: TimelineEvent[] = [{ type: "created", at: s.createdAt, label: "Need posted", amountCents: null }];
  if (card.fundedCents > 0) {
    // Donations happen before funding; without a funded time, use the last update.
    events.push({
      type: "donation",
      at: s.fundedAt ?? s.updatedAt,
      label: `${plural(card.donorCount, "donor", "donors")} gave ${formatUsd(card.fundedCents)}`,
      amountCents: card.fundedCents,
    });
  }
  if (s.fundedAt) events.push({ type: "funded", at: s.fundedAt, label: "Fully funded", amountCents: card.fundedCents });
  if (s.approvedAt) {
    events.push({
      type: "purchase_approved",
      at: s.approvedAt,
      label: `Purchase approved at ${s.product.retailer}`,
      amountCents: null,
    });
  }
  if (card.status === "topping_up" && s.approvedAt) {
    events.push({
      type: "topping_up",
      at: s.approvedAt,
      label: `The price went up: ${formatUsd(card.remainingCents)} more needed`,
      amountCents: card.remainingCents,
    });
  }
  if (s.orderedAt) events.push({ type: "ordered", at: s.orderedAt, label: "Ordered", amountCents: null });
  if (s.deliveredAt) events.push({ type: "delivered", at: s.deliveredAt, label: "Arrived", amountCents: null });
  if (s.closedAt) events.push({ type: "closed", at: s.closedAt, label: "Closed", amountCents: null });
  return events.map((e) => TimelineEvent.parse(e));
}

/** Purchase ids reuse the need id's tail with a different block, so they're stable and unique. */
const purchaseId = (needId: string) => needId.replace("-8a6b-", "-9c7d-");
const deliveryId = (needId: string) => needId.replace("-8a6b-", "-ad8e-");

function buildPurchases(s: NeedSeed, card: NeedCard, product: ProductSnapshot): PurchaseView[] {
  if (!s.approvedAt) return [];
  const pricier = s.previousUnitPriceCents !== undefined;
  return [
    PurchaseView.parse({
      id: purchaseId(s.id),
      needId: s.id,
      status: s.orderedAt ? "ordered" : "approved",
      offer: toOffer(product),
      newTargetCents: computeTargetCents(product.unitPriceCents, card.quantity),
      explanation: pricier
        ? `Same product as posted, but ${product.retailer} now charges more per unit. The tile asks donors for the difference.`
        : `Same product and pack size as posted. ${product.retailer} shows it in stock.`,
      flags: pricier ? ["Price went up", "In stock"] : ["In stock"],
      orderRef: s.orderRef ?? null,
      createdAt: s.approvedAt,
      approvedAt: s.approvedAt,
      orderedAt: s.orderedAt ?? null,
    }),
  ];
}

function buildNeed(s: NeedSeed): MockNeed {
  const product = productSnapshot(s.product, s.createdAt, s.id);
  const targetCents = computeTargetCents(product.unitPriceCents, s.quantity);
  const card = NeedCard.parse({
    id: s.id,
    orgId: ORG_IDS[s.org],
    orgSlug: ORG_SLUG[s.org],
    title: s.title,
    description: s.description,
    category: s.category,
    urgency: s.urgency,
    quantity: s.quantity,
    unit: s.unit,
    status: s.status,
    targetCents,
    fundedCents: s.fundedCents,
    heldCents: s.heldCents,
    remainingCents: remainingCents({ targetCents, fundedCents: s.fundedCents, heldCents: s.heldCents }),
    donorCount: s.donorCount,
    product,
    deadlineAt: s.deadlineAt,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  });
  assertNeedConsistent(card, s);

  const photoUrl = mockImage("arrival");
  const delivery =
    s.delivery && s.deliveredAt
      ? DeliveryPublic.parse({ photoUrl, message: s.delivery.message, deliveredAt: s.deliveredAt })
      : null;
  const deliveryView =
    s.delivery && s.deliveredAt
      ? DeliveryView.parse({
          id: deliveryId(s.id),
          needId: s.id,
          photoUrl,
          matchScore: s.delivery.matchScore,
          aiNotes: s.delivery.aiNotes,
          needsReview: false,
          message: s.delivery.message,
          createdAt: s.deliveredAt,
          confirmedAt: null,
        })
      : null;

  return {
    card,
    timeline: buildTimeline(s, card),
    delivery,
    alternatives: (s.alternatives ?? []).map((a) => productSnapshot(a, s.createdAt, s.id)),
    purchases: buildPurchases(s, card, product),
    deliveryView,
  };
}

export const needs: MockNeed[] = NEED_SEEDS.map(buildNeed);

const needById = new Map(needs.map((n) => [n.card.id, n]));
function fixtureNeed(id: string): MockNeed {
  const n = needById.get(id);
  if (!n) throw new Error(`Mock fixture need ${id} is missing`);
  return n;
}

// ---------- fresh prices (purchase plan, C-7) ----------

type OfferSeed = { title: string; retailer: string; search: [host: string, query: string]; unitPriceCents: number };

/** What one fresh price check finds for a need: today's price of the same product, and other offers. */
type PriceCheckSeed = { id: string; unitPriceCents: number; alternatives: OfferSeed[] };

function offerFrom(seed: OfferSeed, image: string | null): PurchaseOffer {
  const [host, query] = seed.search;
  return PurchaseOffer.parse({
    channel3Id: `c3_offer_${query.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
    title: seed.title,
    retailer: seed.retailer,
    url: `https://${host}/search?q=${encodeURIComponent(query)}`,
    imageUrl: image ? mockImage(image) : null,
    unitPriceCents: seed.unitPriceCents,
    inStock: true,
  });
}

/**
 * Deterministic price checks, one per money outcome (planPurchaseMoney on the need's funded amount):
 * - Laundry detergent: cheaper, $95 raised vs $88 new cost → $7 surplus to the next need (demo scene).
 * - Kids' toothbrushes: pricier, $38 raised vs $41 → a $3 gap, the tile goes back to donors.
 * - Enzyme cleaner: 10¢ cheaper, but the new cost still rounds to the $108 raised → exact.
 * - Diapers, size 4: cheaper once it's funded (PurchasePlan.dc.html).
 * Hand-written products (Snacks for reading club) are never refreshed: same price, exact.
 */
const PRICE_CHECKS: PriceCheckSeed[] = [
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000110",
    unitPriceCents: 1349,
    alternatives: [
      {
        title: "Gain Original Liquid Laundry Detergent, 88 fl oz",
        retailer: "Walmart",
        search: ["www.walmart.com", "gain original liquid detergent 88 oz"],
        unitPriceCents: 1297,
      },
      {
        title: "Persil ProClean Original Liquid Detergent, 82.5 fl oz",
        retailer: "Amazon",
        search: ["www.amazon.com", "persil proclean original 82.5 oz"],
        unitPriceCents: 1499,
      },
    ],
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000109",
    unitPriceCents: 949,
    alternatives: [
      {
        title: "Oral-B Kids Extra Soft Toothbrushes, 12 Pack",
        retailer: "Walmart",
        search: ["www.walmart.com", "oral-b kids extra soft toothbrush 12 pack"],
        unitPriceCents: 847,
      },
      {
        title: "Amazon Basics Kids Soft Toothbrushes, 12 Pack",
        retailer: "Amazon",
        search: ["www.amazon.com", "amazon basics kids soft toothbrush 12 pack"],
        unitPriceCents: 799,
      },
    ],
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000208",
    unitPriceCents: 2489,
    alternatives: [
      {
        title: "Simple Solution Pet Stain and Odor Remover, 1 gal",
        retailer: "Amazon",
        search: ["www.amazon.com", "simple solution stain odor remover gallon"],
        unitPriceCents: 2399,
      },
    ],
  },
  { id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000101", unitPriceCents: 3699, alternatives: [] },
];

/** Today's offer for the need's own product, per need id (only needs whose price moved, or was checked). */
export const freshOffers: Record<string, PurchaseOffer> = Object.fromEntries(
  PRICE_CHECKS.map(({ id, unitPriceCents }) => {
    const { product } = fixtureNeed(id).card;
    if (!product) throw new Error(`Mock fixture need ${id} has no product`);
    if (product.channel3Id.startsWith(MANUAL_PRODUCT_PREFIX)) throw new Error("manual products are never refreshed");
    return [id, PurchaseOffer.parse({ ...toOffer(product), unitPriceCents })];
  }),
);

/** Other offers a price check finds per need id (up to 3, shown for comparison). */
export const freshAlternatives: Record<string, PurchaseOffer[]> = Object.fromEntries(
  PRICE_CHECKS.map(({ id, alternatives }) => {
    const image = fixtureNeed(id).card.product?.imageUrl ?? null;
    const name = image ? (/\/mock\/([a-z]+)\.svg$/.exec(image)?.[1] ?? null) : null;
    return [id, alternatives.slice(0, 3).map((seed) => offerFrom(seed, name))];
  }),
);

// ---------- impact ----------

export const DEMO_IMPACT_TOKEN = "demo-impact-token";

/**
 * A donation that is part of the fixture story, with its impact link. The mock ledger turns each
 * item into an allocation (one of the need's `donorCount` donors), so `GET /api/impact/:token` is
 * built from the needs' current state, like the server: a delivery recorded in this tab shows up.
 */
export type ImpactRecord = {
  token: string;
  donationId: string;
  donorFirstName: string | null;
  donatedAt: string;
  /** In the order the capture placed them (the server lists items by their first allocation). */
  items: ReadonlyArray<{ needId: string; amountCents: number; reason: AllocationReason }>;
};

/**
 * Sam's gift (ImpactPhone.dc.html): $14 finished Diapers, size 3 (delivered, with a photo); the
 * other $25 overflowed to Women's socks (ordered, no photo yet).
 */
export const impactRecords: readonly ImpactRecord[] = [
  {
    token: DEMO_IMPACT_TOKEN,
    donationId: "seed-demo-impact-sam",
    donorFirstName: "Sam",
    donatedAt: rel(-9, "15:42"),
    items: [
      { needId: "4c1f7a2e-9b3d-4e5f-8a6b-000000000112", amountCents: 1400, reason: "direct" },
      { needId: "4c1f7a2e-9b3d-4e5f-8a6b-000000000111", amountCents: 2500, reason: "overflow" },
    ],
  },
];

/** Each record's items must fit inside the need's funded amount and donor count. */
for (const record of impactRecords) {
  for (const item of record.items) {
    const { card } = fixtureNeed(item.needId);
    if (!Cents.safeParse(item.amountCents).success || item.amountCents === 0) {
      throw new Error(`Mock impact ${record.token}: amount for ${card.title} must be positive cents`);
    }
    if (item.amountCents > card.fundedCents || card.donorCount < 1) {
      throw new Error(`Mock impact ${record.token}: ${card.title} has less funding than this gift`);
    }
  }
}

// ---------- sponsor invoices (C-10) ----------

/**
 * A sponsor invoice from the fixture story, with what it did to the ledger (A §8.6), so the invoices
 * page isn't empty on first load:
 * - `sent`: one sponsor hold per need, each the need's remaining when the invoice was sent (the mock
 *   ledger lets them run for SPONSOR_HOLD_DAYS from then).
 * - `paid`: the sponsor's payment is a donation (source "invoice") with one `sponsor` allocation per
 *   need, already part of that need's funded amount and donor count.
 */
export type SponsorInvoiceRecord = {
  orgId: string;
  invoice: SponsorInvoiceView;
  holds: ReadonlyArray<{ needId: string; amountCents: number }>;
  payment: {
    donationId: string;
    impactToken: string;
    paidAt: string;
    items: ReadonlyArray<{ needId: string; amountCents: number }>;
  } | null;
};

const DONATABLE: readonly NeedStatus[] = ["open", "topping_up"];

function sandboxInvoice(fields: {
  id: string;
  paypalInvoiceId: string;
  recipientEmail: string;
  recipientName: string;
  needIds: string[];
  amountCents: number;
  status: "sent" | "paid";
  createdAt: string;
}): SponsorInvoiceView {
  const payerViewUrl = `https://www.sandbox.paypal.com/invoice/p/#${fields.paypalInvoiceId}`;
  return SponsorInvoiceView.parse({ ...fields, payerViewUrl, qrImageDataUrl: qrPngDataUrl(payerViewUrl) });
}

/** Bayview Dental was sent an invoice two days ago for the markers and glue sticks: both are on hold for it. */
function sentInvoice(): SponsorInvoiceRecord {
  const createdAt = rel(-2, "10:00");
  const holds = ["4c1f7a2e-9b3d-4e5f-8a6b-000000000305", "4c1f7a2e-9b3d-4e5f-8a6b-000000000311"].map((needId) => {
    const { card } = fixtureNeed(needId);
    if (card.orgId !== ORG_IDS.room12 || !DONATABLE.includes(card.status) || card.remainingCents === 0) {
      throw new Error(`Mock sponsor invoice: "${card.title}" must be a Room 12 need still taking donations`);
    }
    if (card.updatedAt > createdAt) throw new Error(`Mock sponsor invoice: "${card.title}" changed after it was sent`);
    return { needId, amountCents: card.remainingCents };
  });
  const invoice = sandboxInvoice({
    id: "4c1f7a2e-9b3d-4e5f-8a6b-0000000005e1",
    paypalInvoiceId: "INV2-B4YV-2DNT-8LQE-M3RS",
    recipientEmail: "office@example.com",
    recipientName: "Bayview Dental",
    needIds: holds.map((h) => h.needId),
    amountCents: holds.reduce((sum, h) => sum + h.amountCents, 0),
    status: "sent",
    createdAt,
  });
  return { orgId: ORG_IDS.room12, invoice, holds, payment: null };
}

/** Lakeside Rotary paid the last $59 of the coats for Room 12's youngest readers (since delivered). */
function paidInvoice(): SponsorInvoiceRecord {
  const needId = "4c1f7a2e-9b3d-4e5f-8a6b-000000000309";
  const need = fixtureNeed(needId);
  const amountCents = 5900;
  // The payment is what finished the tile.
  const paidAt = need.timeline.find((e) => e.type === "funded")?.at;
  const createdAt = rel(-14, "10:30");
  if (!paidAt || paidAt < createdAt || !FUNDED_STATUSES.includes(need.card.status)) {
    throw new Error(`Mock sponsor invoice: "${need.card.title}" must have been funded after the invoice was sent`);
  }
  if (amountCents > need.card.fundedCents || need.card.donorCount < 1) {
    throw new Error(`Mock sponsor invoice: "${need.card.title}" has less funding than the sponsor paid`);
  }
  const invoice = sandboxInvoice({
    id: "4c1f7a2e-9b3d-4e5f-8a6b-0000000005e2",
    paypalInvoiceId: "INV2-7KQ2-9DHL-3MZA-XC4P",
    recipientEmail: "giving@example.org",
    recipientName: "Lakeside Rotary",
    needIds: [needId],
    amountCents,
    status: "paid",
    createdAt,
  });
  return {
    orgId: ORG_IDS.room12,
    invoice,
    holds: [],
    payment: {
      donationId: "seed-sponsor-lakeside-rotary",
      impactToken: "sponsor-lakeside-rotary",
      paidAt,
      items: [{ needId, amountCents }],
    },
  };
}

/** Room 12's sponsor invoices, newest first. */
export const sponsorInvoices: readonly SponsorInvoiceRecord[] = [sentInvoice(), paidInvoice()];

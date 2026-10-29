/**
 * Hand-written mock data mirroring B's seed: three demo orgs, ~12 needs each across every status.
 * Every object is validated with its shared schema when this module loads, and the money rules are
 * checked too, so a contract change (or a typo here) breaks tests and the build immediately.
 *
 * Sample names and numbers come from the approved designs (Main, Landing, TileStates, ImpactPhone,
 * PurchasePlan, StaffConsole). Times are fixed ISO UTC strings around the demo week (late Oct 2026).
 */
import {
  computeTargetCents,
  DeliveryPublic,
  DeliveryView,
  formatUsd,
  ImpactRes,
  NeedCard,
  OrgPublic,
  ProductSnapshot,
  PurchaseOffer,
  PurchaseView,
  remainingCents,
  TimelineEvent,
  type Category,
  type NeedStatus,
} from "@needgrid/shared";

// ---------- helpers ----------

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
    channel3Id: `c3_${id.slice(-6)}_${p.retailer.toLowerCase()}`,
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

function toOffer(p: ProductSnapshot): PurchaseOffer {
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
    deadlineAt: "2026-10-30T21:00:00.000Z",
    createdAt: "2026-10-22T14:05:00.000Z",
    updatedAt: "2026-10-28T18:20:00.000Z",
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
    deadlineAt: "2026-10-31T21:00:00.000Z",
    createdAt: "2026-10-22T14:06:00.000Z",
    updatedAt: "2026-10-29T09:12:00.000Z",
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
    deadlineAt: "2026-11-02T21:00:00.000Z",
    createdAt: "2026-10-22T14:07:00.000Z",
    updatedAt: "2026-10-27T16:40:00.000Z",
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
    },
    deadlineAt: "2026-11-03T21:00:00.000Z",
    createdAt: "2026-10-23T10:15:00.000Z",
    updatedAt: "2026-10-29T08:55:00.000Z",
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
    },
    deadlineAt: "2026-11-14T21:00:00.000Z",
    createdAt: "2026-10-23T10:16:00.000Z",
    updatedAt: "2026-10-26T12:00:00.000Z",
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
    deadlineAt: "2026-11-20T21:00:00.000Z",
    createdAt: "2026-10-23T10:17:00.000Z",
    updatedAt: "2026-10-25T19:30:00.000Z",
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
    },
    deadlineAt: "2026-11-25T21:00:00.000Z",
    createdAt: "2026-10-24T09:00:00.000Z",
    updatedAt: "2026-10-24T09:00:00.000Z",
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
    },
    deadlineAt: null,
    createdAt: "2026-10-21T11:00:00.000Z",
    fundedAt: "2026-10-27T15:10:00.000Z",
    approvedAt: "2026-10-28T10:30:00.000Z",
    updatedAt: "2026-10-28T10:30:00.000Z",
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
    createdAt: "2026-10-20T13:00:00.000Z",
    fundedAt: "2026-10-28T17:45:00.000Z",
    updatedAt: "2026-10-28T17:45:00.000Z",
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
    createdAt: "2026-10-19T09:30:00.000Z",
    fundedAt: "2026-10-29T08:40:00.000Z",
    updatedAt: "2026-10-29T08:40:00.000Z",
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
    createdAt: "2026-10-18T10:00:00.000Z",
    fundedAt: "2026-10-25T20:15:00.000Z",
    approvedAt: "2026-10-26T14:00:00.000Z",
    orderedAt: "2026-10-26T14:20:00.000Z",
    orderRef: "TGT-4417-2290",
    updatedAt: "2026-10-26T14:20:00.000Z",
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
    createdAt: "2026-10-15T12:00:00.000Z",
    fundedAt: "2026-10-20T15:42:00.000Z",
    approvedAt: "2026-10-21T09:00:00.000Z",
    orderedAt: "2026-10-21T09:15:00.000Z",
    orderRef: "WM-2000-118-5521",
    deliveredAt: "2026-10-27T15:30:00.000Z",
    delivery: {
      message:
        "They arrived Tuesday morning and were on the shelf by lunch. Thank you for keeping 30 families covered this week.",
      aiNotes: "Two packs of Pampers Swaddlers size 3 on a shelf. Matches the posted product and quantity.",
      matchScore: 0.93,
    },
    updatedAt: "2026-10-27T15:30:00.000Z",
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
    createdAt: "2026-10-29T08:00:00.000Z",
    updatedAt: "2026-10-29T08:00:00.000Z",
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
    createdAt: "2026-10-16T09:00:00.000Z",
    closedAt: "2026-10-22T16:00:00.000Z",
    updatedAt: "2026-10-22T16:00:00.000Z",
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
    deadlineAt: "2026-10-31T22:00:00.000Z",
    createdAt: "2026-10-23T15:00:00.000Z",
    updatedAt: "2026-10-28T21:10:00.000Z",
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
    deadlineAt: "2026-11-01T22:00:00.000Z",
    createdAt: "2026-10-23T15:01:00.000Z",
    updatedAt: "2026-10-29T10:05:00.000Z",
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
    deadlineAt: "2026-11-06T22:00:00.000Z",
    createdAt: "2026-10-22T12:00:00.000Z",
    updatedAt: "2026-10-27T18:00:00.000Z",
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
    deadlineAt: "2026-11-10T22:00:00.000Z",
    createdAt: "2026-10-24T09:00:00.000Z",
    updatedAt: "2026-10-26T13:00:00.000Z",
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
    createdAt: "2026-10-25T10:00:00.000Z",
    updatedAt: "2026-10-25T10:00:00.000Z",
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
    deadlineAt: "2026-10-30T22:00:00.000Z",
    createdAt: "2026-10-26T08:00:00.000Z",
    updatedAt: "2026-10-29T07:30:00.000Z",
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
    createdAt: "2026-10-20T10:00:00.000Z",
    fundedAt: "2026-10-26T19:00:00.000Z",
    approvedAt: "2026-10-27T11:00:00.000Z",
    updatedAt: "2026-10-27T11:00:00.000Z",
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
    createdAt: "2026-10-19T10:00:00.000Z",
    fundedAt: "2026-10-28T12:00:00.000Z",
    updatedAt: "2026-10-28T12:00:00.000Z",
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
    createdAt: "2026-10-17T10:00:00.000Z",
    fundedAt: "2026-10-24T18:00:00.000Z",
    approvedAt: "2026-10-25T10:00:00.000Z",
    orderedAt: "2026-10-25T10:20:00.000Z",
    orderRef: "AMZ-114-7720391-5521",
    updatedAt: "2026-10-25T10:20:00.000Z",
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
    createdAt: "2026-10-12T10:00:00.000Z",
    fundedAt: "2026-10-18T16:00:00.000Z",
    approvedAt: "2026-10-19T09:00:00.000Z",
    orderedAt: "2026-10-19T09:30:00.000Z",
    orderRef: "CHW-88231907",
    deliveredAt: "2026-10-23T17:00:00.000Z",
    delivery: {
      message: "Two new carriers, already used at Saturday's adoption event. Thank you!",
      aiNotes: "Two grey top-load cat carriers, tags still on. Matches the posted product.",
      matchScore: 0.88,
    },
    updatedAt: "2026-10-23T17:00:00.000Z",
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
    createdAt: "2026-10-28T20:00:00.000Z",
    updatedAt: "2026-10-28T20:00:00.000Z",
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
    createdAt: "2026-10-14T10:00:00.000Z",
    closedAt: "2026-10-21T10:00:00.000Z",
    updatedAt: "2026-10-21T10:00:00.000Z",
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
    deadlineAt: "2026-11-06T22:00:00.000Z",
    createdAt: "2026-10-26T14:00:00.000Z",
    updatedAt: "2026-10-28T15:00:00.000Z",
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
    deadlineAt: "2026-11-06T22:00:00.000Z",
    createdAt: "2026-10-26T14:01:00.000Z",
    updatedAt: "2026-10-26T14:01:00.000Z",
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
    deadlineAt: "2026-11-06T22:00:00.000Z",
    createdAt: "2026-10-26T14:02:00.000Z",
    updatedAt: "2026-10-29T11:00:00.000Z",
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
    deadlineAt: "2026-11-20T22:00:00.000Z",
    createdAt: "2026-10-21T14:00:00.000Z",
    updatedAt: "2026-10-27T20:00:00.000Z",
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
    createdAt: "2026-10-22T14:00:00.000Z",
    updatedAt: "2026-10-25T16:00:00.000Z",
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
    createdAt: "2026-10-18T14:00:00.000Z",
    fundedAt: "2026-10-26T12:00:00.000Z",
    approvedAt: "2026-10-27T08:30:00.000Z",
    updatedAt: "2026-10-27T08:30:00.000Z",
  },
  {
    id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000307",
    org: "room12",
    title: "Kids' headphones",
    description: "For the reading app on our classroom tablets.",
    category: "school",
    urgency: 2,
    quantity: 10,
    unit: "pair",
    status: "funded",
    fundedCents: 14100,
    heldCents: 0,
    donorCount: 7,
    product: {
      title: "Kids Wired Headphones with 85 dB Volume Limit",
      retailer: "Amazon",
      search: ["www.amazon.com", "kids wired headphones volume limit"],
      unitPriceCents: 1299,
      packSize: null,
      image: "school",
    },
    deadlineAt: null,
    createdAt: "2026-10-19T14:00:00.000Z",
    fundedAt: "2026-10-28T19:00:00.000Z",
    updatedAt: "2026-10-28T19:00:00.000Z",
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
    createdAt: "2026-10-16T14:00:00.000Z",
    fundedAt: "2026-10-23T12:00:00.000Z",
    approvedAt: "2026-10-24T08:00:00.000Z",
    orderedAt: "2026-10-24T08:10:00.000Z",
    orderRef: "TGT-9902-1184",
    updatedAt: "2026-10-24T08:10:00.000Z",
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
    createdAt: "2026-10-10T14:00:00.000Z",
    fundedAt: "2026-10-16T18:00:00.000Z",
    approvedAt: "2026-10-17T08:00:00.000Z",
    orderedAt: "2026-10-17T08:20:00.000Z",
    orderRef: "TGT-7710-3302",
    deliveredAt: "2026-10-22T19:00:00.000Z",
    delivery: {
      message: "Four warm coats for our youngest readers. They wore them out to recess the same day!",
      aiNotes: "Four children's puffer jackets on a classroom coat rack. Matches the posted product and quantity.",
      matchScore: 0.91,
    },
    updatedAt: "2026-10-22T19:00:00.000Z",
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
    createdAt: "2026-10-29T07:00:00.000Z",
    updatedAt: "2026-10-29T07:00:00.000Z",
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
    createdAt: "2026-10-24T14:00:00.000Z",
    updatedAt: "2026-10-26T09:00:00.000Z",
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
    createdAt: "2026-10-13T14:00:00.000Z",
    closedAt: "2026-10-20T14:00:00.000Z",
    updatedAt: "2026-10-20T14:00:00.000Z",
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
      flags: pricier ? ["price went up"] : ["in stock"],
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

/**
 * What a fresh Channel3 price check returns per need. Laundry detergent is funded and now cheaper
 * (surplus moves to the next need); Diapers, size 4 matches the PurchasePlan design once it's funded.
 */
export const freshOffers: Record<string, PurchaseOffer> = Object.fromEntries(
  [
    { id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000110", unitPriceCents: 1349 },
    { id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000101", unitPriceCents: 3699 },
  ].map(({ id, unitPriceCents }) => {
    const { product } = fixtureNeed(id).card;
    if (!product) throw new Error(`Mock fixture need ${id} has no product`);
    const offer = PurchaseOffer.parse({ ...toOffer(product), unitPriceCents });
    if (offer.unitPriceCents >= product.unitPriceCents) throw new Error("fresh offer must be cheaper");
    return [id, offer];
  }),
);

// ---------- impact ----------

export const DEMO_IMPACT_TOKEN = "demo-impact-token";

/** Sam's gift (ImpactPhone.dc.html): $14 finished Diapers, size 3; the other $25 overflowed to socks. */
function buildDemoImpact(): ImpactRes {
  const items = [
    { id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000112", amountCents: 1400, reason: "direct" as const },
    { id: "4c1f7a2e-9b3d-4e5f-8a6b-000000000111", amountCents: 2500, reason: "overflow" as const },
  ].map(({ id, amountCents, reason }) => {
    const n = fixtureNeed(id);
    const org = orgs.find((o) => o.id === n.card.orgId);
    if (!org) throw new Error(`Mock fixture org ${n.card.orgId} is missing`);
    return { need: n.card, orgName: org.name, amountCents, reason, timeline: n.timeline, delivery: n.delivery };
  });
  return ImpactRes.parse({
    donorFirstName: "Sam",
    totalCents: items.reduce((sum, i) => sum + i.amountCents, 0),
    donatedAt: "2026-10-20T15:42:00.000Z",
    items,
  });
}

export const impacts: Record<string, ImpactRes> = { [DEMO_IMPACT_TOKEN]: buildDemoImpact() };

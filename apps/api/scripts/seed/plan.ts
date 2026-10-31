/**
 * Builds every seed row in memory, deterministically (no I/O). seed.ts writes the plan to the database.
 *
 * Money rules the plan guarantees (they're what `check:money` checks, AGENT_A_BACKEND.md §6):
 * - each donation has allocations that add up exactly to its amount (one direct allocation per donation)
 * - each need's fundedCents = the sum of its allocations, never above its target
 * - funded / ordered / delivered needs are fully funded; open needs keep at least $1 remaining
 * - timestamps are consistent: created < donations ≤ funded_at < ordered_at < delivered_at ≤ end
 */
import {
  computeTargetCents,
  formatUsd,
  type NeedStatus,
  type ProductSnapshot,
  type PurchaseOffer,
} from "@needgrid/shared";
import type { allocations, deliveries, donations, needs, purchases } from "../../src/db/schema";
import { CATALOG, HEROES, type NeedTemplate } from "./catalog";
import { SEED_ORGS, type SeedOrg } from "./orgs";
import { createRng, type Rng } from "./prng";
import { candidatesFor, manualSnapshot, type ProductCache } from "./products";

type NeedInsert = typeof needs.$inferInsert & { id: string; orgId: string };
type DonationInsert = typeof donations.$inferInsert & { id: string; orgId: string };
type AllocationInsert = typeof allocations.$inferInsert & { id: string };
type PurchaseInsert = typeof purchases.$inferInsert & { id: string };
type DeliveryInsert = typeof deliveries.$inferInsert & { id: string };

export interface PlanOrg {
  /** Placeholder id; seed.ts maps it to the real row id after the upsert. */
  id: string;
  org: SeedOrg;
}

export interface SeedPlan {
  orgs: PlanOrg[];
  needs: NeedInsert[];
  donations: DonationInsert[];
  allocations: AllocationInsert[];
  purchases: PurchaseInsert[];
  deliveries: DeliveryInsert[];
  /** needKey (`${slug}/${template.key}`) → need id, for the summary and tests. */
  needIds: Map<string, string>;
}

export interface PlanOptions {
  seed: number;
  /** History ends here (usually now). */
  end: Date;
  cache: ProductCache;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const HISTORY_DAYS = 56; // 8 weeks

/** Donation amounts in cents: mostly $10/$15/$25/$50. "Fund the rest" odd amounts come from finishing a tile. */
const AMOUNTS: ReadonlyArray<readonly [number, number]> = [
  [1000, 30],
  [1500, 20],
  [2000, 6],
  [2500, 26],
  [5000, 13],
  [10_000, 5],
];

const FIRST_NAMES = [
  "Ava",
  "Ben",
  "Carmen",
  "Dev",
  "Elena",
  "Femi",
  "Grace",
  "Hiro",
  "Isla",
  "Jamal",
  "Kai",
  "Lena",
  "Mateo",
  "Nora",
  "Omar",
  "Priya",
  "Quinn",
  "Rosa",
  "Sam",
  "Tara",
  "Uma",
  "Victor",
  "Wren",
  "Yusuf",
  "Zoe",
  "Aiden",
  "Bea",
  "Chloe",
  "Diego",
  "Emma",
  "Finn",
  "Gia",
  "Hana",
  "Ivan",
  "Jade",
  "Leo",
  "Maya",
  "Nico",
  "Olive",
  "Paul",
  "Ruby",
  "Sofia",
  "Theo",
  "Vera",
  "Will",
  "Ximena",
  "Yara",
  "Zane",
  "Alice",
  "Marcus",
  "Nadia",
  "Oscar",
  "Lucia",
  "Ravi",
  "Mei",
];

const ORDER_PREFIX: Record<string, string> = {
  "amazon.com": "AMZ",
  "walmart.com": "WMT",
  "target.com": "TGT",
  "chewy.com": "CHW",
  "petsmart.com": "PSM",
  "cvs.com": "CVS",
};

const between = (rng: Rng, lo: number, hi: number) => new Date(lo + rng.next() * Math.max(0, hi - lo));

function orderRef(rng: Rng, retailer: string): string {
  const prefix =
    ORDER_PREFIX[retailer.replace(/^www\./, "")] ??
    retailer
      .replace(/[^a-z]/gi, "")
      .slice(0, 3)
      .toUpperCase();
  return `${prefix}-${rng.int(100, 999)}-${rng.int(1_000_000, 9_999_999)}`;
}

/** "pack" + 150 per pack → "pack of 150" (matches what intake produces). */
function unitFor(t: NeedTemplate, p: ProductSnapshot): string {
  return t.unit === "pack" && p.packSize && p.packSize > 1 ? `pack of ${p.packSize}` : t.unit;
}

/** Quantity that gives a realistic target ($90–$420), unless the template fixes it. */
function quantityFor(rng: Rng, t: NeedTemplate, unitPriceCents: number): number {
  if (t.quantity) return t.quantity;
  const desired = rng.float(9_000, 42_000);
  return Math.min(24, Math.max(1, Math.round(desired / (unitPriceCents * 1.08))));
}

/**
 * Donation amounts that add up to exactly `total` when `exact`, or to at most `total` otherwise.
 * The last donation of an exact split is the odd "fund the rest" amount.
 */
export function splitDonations(rng: Rng, total: number, exact: boolean): number[] {
  const out: number[] = [];
  let left = total;
  while (left > 0) {
    const amount = rng.weighted(AMOUNTS);
    if (amount < left) {
      out.push(amount);
      left -= amount;
    } else {
      if (exact) out.push(left);
      break;
    }
  }
  return out;
}

/** Status counts for n needs: ~55% open, 15% funded, 10% ordered, 15% delivered, 5% closed. */
function statusPlan(n: number): NeedStatus[] {
  const closed = Math.max(1, Math.round(n * 0.05));
  const delivered = Math.round(n * 0.15);
  const ordered = Math.round(n * 0.1);
  const funded = Math.round(n * 0.15);
  const open = n - closed - delivered - ordered - funded;
  return [
    ...Array<NeedStatus>(open).fill("open"),
    ...Array<NeedStatus>(funded).fill("funded"),
    ...Array<NeedStatus>(ordered).fill("ordered"),
    ...Array<NeedStatus>(delivered).fill("delivered"),
    ...Array<NeedStatus>(closed).fill("closed"),
  ];
}

const isHero = (slug: string, key: string, h: { org: string; key: string }) => h.org === slug && h.key === key;
const isCoat = (slug: string, key: string) =>
  HEROES.coats.org === slug && (HEROES.coats.keys as readonly string[]).includes(key);

/** Fixed statuses for the demo-video needs; everything else is assigned by statusPlan. */
function forcedStatus(slug: string, key: string): NeedStatus | null {
  if (isHero(slug, key, HEROES.fourteenLeft) || isCoat(slug, key)) return "open";
  if (isHero(slug, key, HEROES.priceDrop)) return "funded";
  if (isHero(slug, key, HEROES.ordered)) return "ordered";
  return null;
}

export function buildPlan(opts: PlanOptions): SeedPlan {
  const rng = createRng(opts.seed);
  const end = opts.end.getTime();
  const start = end - HISTORY_DAYS * DAY;
  const plan: SeedPlan = {
    orgs: [],
    needs: [],
    donations: [],
    allocations: [],
    purchases: [],
    deliveries: [],
    needIds: new Map(),
  };

  for (const org of SEED_ORGS) {
    const orgId = rng.uuid();
    plan.orgs.push({ id: orgId, org });
    const templates = CATALOG[org.slug] ?? [];

    // Assign statuses: forced heroes first, the rest shuffled into the planned mix.
    const statuses = statusPlan(templates.length);
    const forced = new Map<string, NeedStatus>();
    for (const t of templates) {
      const s = forcedStatus(org.slug, t.key);
      if (s) {
        forced.set(t.key, s);
        const i = statuses.indexOf(s);
        if (i !== -1) statuses.splice(i, 1);
      }
    }
    // Hand-entered products have no image, so they can't be shown as delivered with an arrival photo.
    const free = rng.shuffle(templates.filter((t) => !forced.has(t.key)));
    const assigned = new Map(forced);
    const pool = rng.shuffle(statuses);
    for (const t of free.filter((t) => t.manual)) {
      const i = pool.findIndex((s) => s !== "delivered");
      assigned.set(t.key, pool.splice(i === -1 ? 0 : i, 1)[0] ?? "open");
    }
    for (const t of free.filter((t) => !t.manual)) assigned.set(t.key, pool.shift() ?? "open");

    let deadlines = 0;
    for (const t of templates) {
      const status = assigned.get(t.key)!;
      addNeed(plan, rng, {
        org,
        orgId,
        t,
        status,
        start,
        end,
        cache: opts.cache,
        deadline: deadlines < 2 && (t.urgency ?? 2) === 3 && status === "open",
      });
      if ((t.urgency ?? 2) === 3 && status === "open") deadlines++;
    }
  }
  return plan;
}

interface NeedArgs {
  org: SeedOrg;
  orgId: string;
  t: NeedTemplate;
  status: NeedStatus;
  start: number;
  end: number;
  cache: ProductCache;
  deadline: boolean;
}

function addNeed(plan: SeedPlan, rng: Rng, a: NeedArgs): void {
  const { org, orgId, t, status, start, end } = a;
  const slug = org.slug;
  const id = rng.uuid();
  plan.needIds.set(`${slug}/${t.key}`, id);

  // ---- product ----
  const candidates = t.manual ? [] : candidatesFor(a.cache, t, org.allowPetProducts);
  if (!t.manual && candidates.length === 0) {
    throw new Error(`No cached product matches ${slug}/${t.key} (query "${t.query}"). Run the seed online first.`);
  }
  let product: ProductSnapshot = t.manual ? manualSnapshot(t, new Date(start).toISOString()) : candidates[0]!;
  const alternatives = candidates.slice(1, 3);

  // Purchase-plan scene: the stored price is ~15% above today's, so the refresh finds it cheaper.
  if (isHero(slug, t.key, HEROES.priceDrop)) {
    product = { ...product, unitPriceCents: Math.ceil((product.unitPriceCents * 1.15) / 10) * 10 };
  }

  const quantity = quantityFor(rng, t, product.unitPriceCents);
  const targetCents = computeTargetCents(product.unitPriceCents, quantity);

  // ---- timeline ----
  let createdAt: number;
  let fundedAt: number | null = null;
  let orderedAt: number | null = null;
  let deliveredAt: number | null = null;
  let closedAt: number | null = null;

  switch (status) {
    case "delivered":
      fundedAt = between(rng, start + 10 * DAY, end - 12 * DAY).getTime();
      createdAt = fundedAt - rng.float(6, 20) * DAY;
      orderedAt = fundedAt + rng.float(1, 3) * DAY;
      deliveredAt = Math.min(orderedAt + rng.float(2, 7) * DAY, end - HOUR);
      break;
    case "ordered":
      fundedAt = between(rng, end - 9 * DAY, end - 3 * DAY).getTime();
      createdAt = fundedAt - rng.float(6, 18) * DAY;
      orderedAt = Math.min(fundedAt + rng.float(1, 2) * DAY, end - 2 * HOUR);
      break;
    case "funded":
      fundedAt = between(rng, end - 7 * DAY, end - 6 * HOUR).getTime();
      createdAt = fundedAt - rng.float(5, 18) * DAY;
      break;
    case "closed":
      createdAt = between(rng, start, end - 14 * DAY).getTime();
      closedAt = createdAt + rng.float(3, 10) * DAY;
      break;
    default:
      createdAt = isCoat(slug, t.key)
        ? between(rng, end - 12 * DAY, end - 8 * DAY).getTime()
        : between(rng, start - 7 * DAY, end - 5 * DAY).getTime();
  }

  // ---- money ----
  let fundedCents = 0;
  let amounts: number[] = [];
  if (status === "funded" || status === "ordered" || status === "delivered") {
    amounts = splitDonations(rng, targetCents, true);
  } else if (isHero(slug, t.key, HEROES.fourteenLeft)) {
    amounts = splitDonations(rng, targetCents - 1400, true); // exactly $14 left
  } else if (status === "open") {
    const coat = isCoat(slug, t.key);
    const fraction = coat
      ? rng.weighted([
          [0, 3],
          [0.15, 1],
        ] as const)
      : rng.weighted([
          [0, 2],
          [rng.float(0.05, 0.95), 8],
        ] as const);
    // Leave at least $1 so the tile stays donatable.
    amounts = splitDonations(rng, Math.min(Math.floor(targetCents * fraction), targetCents - 100), false);
  }

  const donateFrom = Math.max(createdAt + HOUR, start);
  const donateTo = fundedAt ?? end - HOUR;
  const times = amounts
    .map(() => donateFrom + Math.pow(rng.next(), 0.8) * (donateTo - donateFrom)) // skewed a little toward recent
    .sort((x, y) => x - y);
  if (fundedAt !== null && times.length > 0) times[times.length - 1] = fundedAt; // funded_at = the last donation

  amounts.forEach((amountCents, i) => {
    const at = new Date(times[i]!);
    const donationId = rng.uuid();
    plan.donations.push({
      id: donationId,
      orgId,
      amountCents,
      donorName: rng.chance(0.85) ? rng.pick(FIRST_NAMES) : null,
      donorEmail: null,
      rollOverConsent: rng.chance(0.9),
      source: "seed",
      status: "captured",
      impactToken: rng.token(16),
      createdAt: at,
    });
    plan.allocations.push({ id: rng.uuid(), donationId, needId: id, amountCents, reason: "direct", createdAt: at });
    fundedCents += amountCents;
  });

  // ---- purchase + delivery ----
  if (orderedAt !== null && fundedAt !== null) {
    const offer: PurchaseOffer = {
      channel3Id: product.channel3Id,
      title: product.title,
      retailer: product.retailer,
      url: product.url,
      imageUrl: product.imageUrl,
      unitPriceCents: product.unitPriceCents,
      inStock: product.inStock,
    };
    const proposedAt = fundedAt + rng.float(0.5, 4) * HOUR;
    plan.purchases.push({
      id: rng.uuid(),
      needId: id,
      offer,
      newTargetCents: targetCents,
      explanation: `Same product at ${product.retailer} for ${formatUsd(product.unitPriceCents)} each, the price it was posted at. The funding covers it exactly.`,
      flags: [],
      status: "ordered",
      orderRef: orderRef(rng, product.retailer),
      approvedAt: new Date(proposedAt + rng.float(1, 10) * HOUR),
      orderedAt: new Date(orderedAt),
      createdAt: new Date(proposedAt),
    });
  }
  if (deliveredAt !== null) {
    plan.deliveries.push({
      id: rng.uuid(),
      needId: id,
      photoUrl: product.imageUrl!, // delivered needs always have a Channel3 product with an image
      matchScore: Math.round(rng.float(0.8, 0.97) * 100) / 100,
      aiNotes: "The photo shows the same product as the listing: matching brand, label and pack.",
      needsReview: false,
      message: rng.pick(org.arrivalMessages).replace("{title}", t.title),
      createdAt: new Date(deliveredAt),
    });
  }

  const deadlineAt =
    a.deadline || isHero(slug, t.key, HEROES.fourteenLeft) ? new Date(end + rng.float(3, 10) * DAY) : null;
  const lastEvent = Math.max(createdAt, ...times, fundedAt ?? 0, orderedAt ?? 0, deliveredAt ?? 0, closedAt ?? 0);
  const stamp = new Date(createdAt).toISOString();

  plan.needs.push({
    id,
    orgId,
    title: t.title,
    description: t.description,
    category: t.category,
    urgency: isHero(slug, t.key, HEROES.fourteenLeft) ? 3 : (t.urgency ?? 2),
    quantity,
    unit: unitFor(t, product),
    status,
    targetCents,
    fundedCents,
    product: { ...product, fetchedAt: stamp },
    alternatives: alternatives.map((p) => ({ ...p, fetchedAt: stamp })),
    deadlineAt,
    fundedAt: fundedAt === null ? null : new Date(fundedAt),
    orderedAt: orderedAt === null ? null : new Date(orderedAt),
    deliveredAt: deliveredAt === null ? null : new Date(deliveredAt),
    closedAt: closedAt === null ? null : new Date(closedAt),
    createdAt: new Date(createdAt),
    updatedAt: new Date(lastEvent),
  });
}

/** In-memory version of the money invariants (same rules as money/invariants.ts). Returns problems found. */
export function checkPlan(plan: SeedPlan): string[] {
  const problems: string[] = [];
  const byNeed = new Map<string, number>();
  const byDonation = new Map<string, number>();
  for (const a of plan.allocations) {
    if (a.amountCents === 0) problems.push(`zero allocation ${a.id}`);
    byNeed.set(a.needId, (byNeed.get(a.needId) ?? 0) + a.amountCents);
    byDonation.set(a.donationId, (byDonation.get(a.donationId) ?? 0) + a.amountCents);
  }
  for (const n of plan.needs) {
    const funded = n.fundedCents ?? 0;
    if ((byNeed.get(n.id) ?? 0) !== funded) problems.push(`need ${n.title}: funded ${funded} ≠ allocations`);
    if (funded > n.targetCents) problems.push(`need ${n.title}: over target`);
    const full = n.status === "funded" || n.status === "ordered" || n.status === "delivered";
    if (full && funded !== n.targetCents) problems.push(`need ${n.title}: ${n.status} but not fully funded`);
    if (n.status === "open" && n.targetCents - funded < 100) problems.push(`need ${n.title}: open with < $1 left`);
    if (n.status === "closed" && funded !== 0) problems.push(`need ${n.title}: closed with money attached`);
    const t = (d: Date | null | undefined) => (d ? d.getTime() : null);
    const seq = [t(n.createdAt), t(n.fundedAt), t(n.orderedAt), t(n.deliveredAt)].filter(
      (x): x is number => x !== null,
    );
    if (seq.some((x, i) => i > 0 && x < seq[i - 1]!)) problems.push(`need ${n.title}: timestamps out of order`);
  }
  for (const d of plan.donations) {
    if ((byDonation.get(d.id) ?? 0) !== d.amountCents) problems.push(`donation ${d.id}: allocations ≠ amount`);
    if (d.amountCents <= 0) problems.push(`donation ${d.id}: amount ≤ 0`);
  }
  return problems;
}

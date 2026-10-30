/**
 * Tiny in-memory "database" behind the MSW handlers, so mock mode behaves like the real API.
 * It starts as a deep copy of the fixtures and lives per browser tab (or per test, via `reset`).
 *
 * Donations mirror A's server code (apps/api/src/money/donations.ts, capture.ts, ledger.ts):
 * - create order: draft/unknown → not found; not donatable or nothing left → FULLY_FUNDED with the
 *   org's next most urgent need; otherwise amount = clampDonation(requested, remaining), held for
 *   HOLD_MINUTES.
 * - capture: idempotent per order; the hold becomes allocations via splitCapture: what still fits
 *   the tile is `direct`, the rest (with consent) is `overflow` to the org's most urgent needs,
 *   each filled up to its room (other donors' holds respected). A need reaching its target turns
 *   `funded`. Overflow without consent stays unallocated (the server proposes a refund).
 *
 * Live updates: every change to a need's card (a hold from create order, a capture, a publish, a
 * staff edit) is sent to `subscribeNeedUpdates` listeners as `NeedCard` JSON, like the API's
 * `need.updated` SSE event (core/needs.ts → publishNeedUpdated: drafts are never sent). The state
 * lives in this tab, so mock live updates only reach screens in the same tab.
 */
import {
  clampDonation,
  computeTargetCents,
  DONATABLE_STATUSES,
  formatUsd,
  HOLD_MINUTES,
  MIN_DONATION_CENTS,
  remainingCents,
  splitCapture,
  type AllocationReason,
  type CaptureRes,
  type CreateOrderReq,
  type CreateOrderRes,
  type ErrorCode,
  type ImpactRes,
  type NeedCard,
  type NeedDetailRes,
  type NeedStatus,
  type OrgPageRes,
  type OrgPublic,
  type OrgStats,
  type OrgSummary,
  type PatchNeedReq,
  type PublishNeedReq,
  type StaffNeedDetailRes,
  type TimelineEvent,
} from "@needgrid/shared";
import * as fixtures from "./fixtures";
import type { MockScenario } from "./scenarios";

type Reservation = {
  orderId: string;
  needId: string;
  amountCents: number;
  rollOverConsent: boolean;
  expiresAtMs: number;
  status: "active" | "converted";
};

type Donation = {
  id: string;
  orderId: string;
  impactToken: string;
  amountCents: number;
  createdAt: string;
};

type Allocation = { donationId: string; needId: string; amountCents: number; reason: AllocationReason; at: string };

type State = {
  orgs: OrgPublic[];
  needs: Map<string, fixtures.MockNeed>;
  impacts: Map<string, ImpactRes>;
  /** Fixture holds ("someone is paying right now"). They never expire. */
  fixtureHeld: Map<string, number>;
  reservations: Map<string, Reservation>;
  donations: Donation[];
  allocations: Allocation[];
  /** When a need became funded in this tab (the timeline's "Fully funded" event). */
  fundedAt: Map<string, string>;
  scenarios: Set<MockScenario>;
};

function freshState(): State {
  return {
    orgs: structuredClone(fixtures.orgs),
    needs: new Map(fixtures.needs.map((n) => [n.card.id, structuredClone(n)])),
    impacts: new Map(Object.entries(structuredClone(fixtures.impacts))),
    fixtureHeld: new Map(fixtures.needs.map((n) => [n.card.id, n.card.heldCents])),
    reservations: new Map(),
    donations: [],
    allocations: [],
    fundedAt: new Map(),
    scenarios: new Set(),
  };
}

let state = freshState();

/** `data` of a `need.updated` event: one NeedCard as JSON, exactly what the SSE route writes. */
export type NeedUpdatedListener = (data: string) => void;

/** Per org slug. Outside `state`, so `reset` (between tests) doesn't drop open tile walls. */
const needListeners = new Map<string, Set<NeedUpdatedListener>>();

/** Statuses hidden from the public site (same as the API). */
const NOT_PUBLIC: NeedStatus[] = ["draft", "closed"];
const FUNDED_STATUSES: NeedStatus[] = ["funded", "ordered", "delivered"];
const OPEN_STATUSES: readonly NeedStatus[] = DONATABLE_STATUSES;
/** The server spreads overflow over at most this many needs (ledger.ts → distribute). */
const OVERFLOW_NEEDS_MAX = 10;

const isDonatable = (status: NeedStatus) => OPEN_STATUSES.includes(status);
const nowIso = () => new Date().toISOString();

/** "Most urgent" order: urgency desc, deadline asc (none last), oldest first. */
function mostUrgentFirst(a: NeedCard, b: NeedCard): number {
  if (a.urgency !== b.urgency) return b.urgency - a.urgency;
  if (a.deadlineAt !== b.deadlineAt) {
    if (a.deadlineAt === null) return 1;
    if (b.deadlineAt === null) return -1;
    return a.deadlineAt.localeCompare(b.deadlineAt);
  }
  return a.createdAt.localeCompare(b.createdAt);
}

// ---------- ids (same shapes as the real ones) ----------

const ORDER_ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** PayPal-like order id; the capture route only accepts `^[A-Z0-9]{5,40}$`. */
function newOrderId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(13));
  return `MOCK${Array.from(bytes, (b) => ORDER_ID_ALPHABET[b % ORDER_ID_ALPHABET.length]).join("")}`;
}

/** 128-bit random, base64url, like the server's `newImpactToken`. */
function newImpactToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ---------- holds and cards ----------

/** Active, unexpired holds on a need (optionally ignoring one order's own hold). */
function heldFor(needId: string, excludeOrderId?: string): number {
  const now = Date.now();
  let held = state.fixtureHeld.get(needId) ?? 0;
  for (const r of state.reservations.values()) {
    if (r.needId === needId && r.status === "active" && r.expiresAtMs > now && r.orderId !== excludeOrderId) {
      held += r.amountCents;
    }
  }
  return held;
}

/** The card as the API would build it right now (holds expire with the clock). */
function cardOf(need: fixtures.MockNeed): NeedCard {
  const heldCents = heldFor(need.card.id);
  return { ...need.card, heldCents, remainingCents: remainingCents({ ...need.card, heldCents }) };
}

/** Like the API's publishNeedUpdated: the need's current card to its org's open screens, never a draft. */
function publishNeedUpdated(needId: string): void {
  const need = state.needs.get(needId);
  if (!need || need.card.status === "draft") return;
  const card = cardOf(need);
  const data = JSON.stringify(card);
  for (const listener of [...(needListeners.get(card.orgSlug) ?? [])]) {
    try {
      listener(data);
    } catch (error) {
      // A broken screen must not fail the request that changed the need (same rule as the API).
      console.error("[mocks] a need.updated listener failed", error);
    }
  }
}

/** Room left on a need: target − funded − holds, and 0 unless it accepts donations (ledger.ts → roomCents). */
function roomFor(need: fixtures.MockNeed, excludeOrderId?: string): number {
  if (!isDonatable(need.card.status)) return 0;
  return remainingCents({ ...need.card, heldCents: heldFor(need.card.id, excludeOrderId) });
}

function orgNeeds(orgId: string): fixtures.MockNeed[] {
  return [...state.needs.values()].filter((n) => n.card.orgId === orgId);
}

/** Open/topping_up needs with room, most urgent first (core/needs.ts → listDonatableNeeds). */
function donatableNeeds(orgId: string, excludeNeedId: string, limit: number): fixtures.MockNeed[] {
  return orgNeeds(orgId)
    .filter((n) => n.card.id !== excludeNeedId && isDonatable(n.card.status) && roomFor(n) > 0)
    .sort((a, b) => mostUrgentFirst(a.card, b.card))
    .slice(0, limit);
}

function nextMostUrgentNeed(orgId: string, excludeNeedId: string): NeedCard | null {
  const [next] = donatableNeeds(orgId, excludeNeedId, 1);
  return next ? cardOf(next) : null;
}

function statsFor(orgId: string): OrgStats {
  const cards = orgNeeds(orgId).map((n) => n.card);
  return {
    raisedCents: cards.reduce((sum, c) => sum + c.fundedCents, 0),
    itemsFunded: cards.filter((c) => FUNDED_STATUSES.includes(c.status)).length,
    itemsDelivered: cards.filter((c) => c.status === "delivered").length,
    openNeeds: cards.filter((c) => OPEN_STATUSES.includes(c.status)).length,
  };
}

function findOrg(predicate: (o: OrgPublic) => boolean): OrgPublic | null {
  return state.orgs.find(predicate) ?? null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Fixture history plus what happened in this tab: donations grouped per UTC day ("1 donor gave
 * $14.00") and "Fully funded" when a gift finished the tile. "Price went up" only while topping up.
 */
function timelineOf(need: fixtures.MockNeed): TimelineEvent[] {
  const id = need.card.id;
  const events = need.timeline.filter((e) => e.type !== "topping_up" || need.card.status === "topping_up");
  const days = new Map<string, Allocation[]>();
  for (const a of state.allocations) {
    if (a.needId !== id || a.amountCents <= 0) continue;
    const day = a.at.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), a]);
  }
  for (const list of days.values()) {
    const donors = new Set(list.map((a) => a.donationId)).size;
    const cents = list.reduce((sum, a) => sum + a.amountCents, 0);
    const at = list[0]?.at ?? nowIso();
    events.push({
      type: "donation",
      at,
      label: `${plural(donors, "donor", "donors")} gave ${formatUsd(cents)}`,
      amountCents: cents,
    });
  }
  const fundedAt = state.fundedAt.get(id);
  if (fundedAt && !events.some((e) => e.type === "funded")) {
    events.push({ type: "funded", at: fundedAt, label: "Fully funded", amountCents: need.card.fundedCents });
  }
  // Stable sort keeps same-time events in the order pushed above (like the server).
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

// ---------- money ----------

/** Insert one allocation and move fundedCents with it (ledger.ts → allocate + refreshNeedStatus). */
function allocate(donation: Donation, need: fixtures.MockNeed, cents: number, reason: AllocationReason): void {
  const card = need.card;
  const firstFromDonation = !state.allocations.some((a) => a.donationId === donation.id && a.needId === card.id);
  const at = nowIso();
  state.allocations.push({ donationId: donation.id, needId: card.id, amountCents: cents, reason, at });
  card.fundedCents += cents;
  if (firstFromDonation) card.donorCount += 1;
  card.updatedAt = at;
  if (isDonatable(card.status) && card.targetCents > 0 && card.fundedCents >= card.targetCents) {
    card.status = "funded";
    if (!state.fundedAt.has(card.id)) state.fundedAt.set(card.id, at);
  }
}

/** Overflow to the org's most urgent needs, each up to its room. Returns what couldn't be placed. */
function distribute(donation: Donation, orgId: string, cents: number, excludeNeedId: string): number {
  let left = cents;
  for (const candidate of donatableNeeds(orgId, excludeNeedId, OVERFLOW_NEEDS_MAX)) {
    if (left === 0) break;
    const give = Math.min(left, roomFor(candidate));
    if (give <= 0) continue;
    allocate(donation, candidate, give, "overflow");
    left -= give;
  }
  return left;
}

/** What one donation paid for, per need and reason, in placement order (capture.ts → buildCaptureRes). */
function captureResOf(donation: Donation): CaptureRes {
  const groups = new Map<string, { needId: string; reason: AllocationReason; amountCents: number }>();
  for (const a of state.allocations) {
    if (a.donationId !== donation.id) continue;
    const key = `${a.needId}:${a.reason}`;
    const group = groups.get(key) ?? { needId: a.needId, reason: a.reason, amountCents: 0 };
    group.amountCents += a.amountCents;
    groups.set(key, group);
  }
  const allocations = [...groups.values()]
    .filter((g) => g.amountCents > 0)
    .map((g) => ({ ...g, needTitle: state.needs.get(g.needId)?.card.title ?? "" }));
  return { donationId: donation.id, impactToken: donation.impactToken, amountCents: donation.amountCents, allocations };
}

/** One donor's items with their current status (core/impact.ts → getImpact). */
function impactOf(donation: Donation): ImpactRes {
  const perNeed = new Map<string, { amountCents: number; reason: AllocationReason }>();
  for (const a of state.allocations) {
    if (a.donationId !== donation.id) continue;
    const item = perNeed.get(a.needId) ?? { amountCents: 0, reason: a.reason };
    item.amountCents += a.amountCents;
    perNeed.set(a.needId, item);
  }
  const items = [...perNeed.entries()].flatMap(([needId, { amountCents, reason }]) => {
    const need = state.needs.get(needId);
    const org = need ? findOrg((o) => o.id === need.card.orgId) : null;
    if (!need || !org || amountCents <= 0) return [];
    return [
      {
        need: cardOf(need),
        orgName: org.name,
        amountCents,
        reason,
        timeline: timelineOf(need),
        delivery: need.delivery,
      },
    ];
  });
  return { donorFirstName: null, totalCents: donation.amountCents, donatedAt: donation.createdAt, items };
}

export type CreateOrderResult =
  { kind: "ok"; order: CreateOrderRes } | { kind: "notFound" } | { kind: "fullyFunded"; nextNeed: NeedCard | null };

export type CaptureResult = { kind: "ok"; capture: CaptureRes } | { kind: "notFound" } | { kind: "declined" };

/** A staff write the server would refuse (same status, code and wording as the real routes). */
export type StaffRefusal = { kind: "refused"; status: number; code: ErrorCode; message: string; details?: unknown };

export type StaffNeedResult = { kind: "ok"; need: NeedCard } | { kind: "notFound" } | StaffRefusal;

const refused = (status: number, code: ErrorCode, message: string, details?: unknown): StaffRefusal =>
  details === undefined
    ? { kind: "refused", status, code, message }
    : { kind: "refused", status, code, message, details };

const invalidState = (message: string, details?: unknown) => refused(409, "INVALID_STATE", message, details);

/** core/needs.ts assertMinTarget: a target under the minimum gift could never be funded. */
function checkMinTarget(targetCents: number): StaffRefusal | null {
  return targetCents < MIN_DONATION_CENTS
    ? refused(400, "VALIDATION", `The target must be at least ${formatUsd(MIN_DONATION_CENTS)}`)
    : null;
}

/** Statuses where a need can still be edited and its target changed (core/needs.ts). */
const EDITABLE_TARGET: NeedStatus[] = ["draft", "open", "topping_up", "funded"];
const PRE_FUNDING: NeedStatus[] = ["draft", "open", "topping_up"];

export const mockDb = {
  /** Back to the fixtures (tests call this between cases). */
  reset(): void {
    state = freshState();
  },

  /** Arm a dev-only scenario (see scenarios.ts). */
  armScenario(scenario: MockScenario): void {
    state.scenarios.add(scenario);
  },

  /**
   * In-page stand-in for `GET /api/orgs/:slug/stream`: `listener` gets each `need.updated` payload
   * for that org. Returns the unsubscribe function.
   */
  subscribeNeedUpdates(orgSlug: string, listener: NeedUpdatedListener): () => void {
    const listeners = needListeners.get(orgSlug) ?? new Set<NeedUpdatedListener>();
    listeners.add(listener);
    needListeners.set(orgSlug, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) needListeners.delete(orgSlug);
    };
  },

  /** True once per arming: the caller applies the scenario now. */
  takeScenario(scenario: MockScenario): boolean {
    return state.scenarios.delete(scenario);
  },

  listOrgSummaries(): OrgSummary[] {
    return [...state.orgs]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((org) => ({ ...org, stats: statsFor(org.id) }));
  },

  getOrgPage(slug: string): OrgPageRes | null {
    const org = findOrg((o) => o.slug === slug);
    if (!org) return null;
    const needs = orgNeeds(org.id)
      .map(cardOf)
      .filter((c) => !NOT_PUBLIC.includes(c.status))
      .sort(mostUrgentFirst);
    return { org, stats: statsFor(org.id), needs };
  },

  /** Public need page: drafts are not public. */
  getNeedDetail(id: string): NeedDetailRes | null {
    const need = state.needs.get(id);
    if (!need || need.card.status === "draft") return null;
    const org = findOrg((o) => o.id === need.card.orgId);
    if (!org) return null;
    return { need: cardOf(need), org, timeline: timelineOf(need), delivery: need.delivery };
  },

  getImpact(token: string): ImpactRes | null {
    const fixture = state.impacts.get(token);
    if (fixture) return fixture;
    const donation = state.donations.find((d) => d.impactToken === token);
    return donation ? impactOf(donation) : null;
  },

  /** POST /api/donations/orders (money/donations.ts → createDonationOrder). */
  createOrder(req: CreateOrderReq): CreateOrderResult {
    const need = state.needs.get(req.needId);
    if (!need || need.card.status === "draft") return { kind: "notFound" };
    const fullyFunded = (): CreateOrderResult => ({
      kind: "fullyFunded",
      nextNeed: nextMostUrgentNeed(need.card.orgId, need.card.id),
    });
    if (!isDonatable(need.card.status)) return fullyFunded();

    if (mockDb.takeScenario("fullyFunded")) {
      // Another donor starts paying for everything that's left, a moment before this request.
      const rest = roomFor(need);
      if (rest > 0) {
        const orderId = newOrderId();
        state.reservations.set(orderId, {
          orderId,
          needId: need.card.id,
          amountCents: rest,
          rollOverConsent: true,
          expiresAtMs: Date.now() + HOLD_MINUTES * 60_000,
          status: "active",
        });
        publishNeedUpdated(need.card.id);
      }
    }

    const clamped = clampDonation(req.amountCents, roomFor(need));
    if (!clamped) return fullyFunded();

    const orderId = newOrderId();
    const expiresAtMs = Date.now() + HOLD_MINUTES * 60_000;
    state.reservations.set(orderId, {
      orderId,
      needId: need.card.id,
      amountCents: clamped.amountCents,
      rollOverConsent: req.rollOverConsent,
      expiresAtMs,
      status: "active",
    });
    publishNeedUpdated(need.card.id); // other screens now show the amount on hold
    return {
      kind: "ok",
      order: {
        orderId,
        amountCents: clamped.amountCents,
        wasClamped: clamped.wasClamped,
        holdExpiresAt: new Date(expiresAtMs).toISOString(),
      },
    };
  },

  /** POST /api/donations/orders/:orderId/capture (money/capture.ts → captureDonationOrder). */
  capture(orderId: string): CaptureResult {
    const existing = state.donations.find((d) => d.orderId === orderId);
    if (existing) return { kind: "ok", capture: captureResOf(existing) };

    const reservation = state.reservations.get(orderId);
    const need = reservation ? state.needs.get(reservation.needId) : undefined;
    if (!reservation || !need) return { kind: "notFound" };
    // PayPal refused the payment method: nothing is recorded and the hold stays until it expires.
    if (mockDb.takeScenario("declined")) return { kind: "declined" };

    const donation: Donation = {
      id: crypto.randomUUID(),
      orderId,
      impactToken: newImpactToken(),
      amountCents: reservation.amountCents,
      createdAt: nowIso(),
    };
    state.donations.push(donation);

    // Room on the tile, ignoring this donation's own hold (it is being converted now).
    const { directCents, overflowCents } = splitCapture(reservation.amountCents, roomFor(need, orderId));
    if (directCents > 0) allocate(donation, need, directCents, "direct");
    if (overflowCents > 0 && reservation.rollOverConsent) {
      distribute(donation, need.card.orgId, overflowCents, need.card.id);
    }
    reservation.status = "converted";
    // The tile (its hold is gone even if nothing fit) and every need the overflow reached.
    const touched = new Set([need.card.id]);
    for (const a of state.allocations) if (a.donationId === donation.id) touched.add(a.needId);
    for (const needId of touched) publishNeedUpdated(needId);
    return { kind: "ok", capture: captureResOf(donation) };
  },

  orgByStaffKey(key: string | null): OrgPublic | null {
    const orgId = key ? fixtures.STAFF_PASSCODES[key] : undefined;
    return orgId ? findOrg((o) => o.id === orgId) : null;
  },

  /** Staff list: includes drafts, newest update first. */
  listStaffNeeds(orgId: string, status?: NeedStatus): NeedCard[] {
    return orgNeeds(orgId)
      .map(cardOf)
      .filter((c) => !status || c.status === status)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  getStaffNeedDetail(orgId: string, id: string): StaffNeedDetailRes | null {
    const need = state.needs.get(id);
    if (!need || need.card.orgId !== orgId) return null;
    return {
      need: cardOf(need),
      alternatives: need.alternatives,
      purchases: need.purchases,
      delivery: need.deliveryView,
      timeline: timelineOf(need),
    };
  },

  /**
   * POST /api/staff/needs (core/needs.ts createNeed). Target = staff override or unit price x quantity
   * + 8% rounded up to the dollar; published needs are open at once, drafts stay private. The new
   * need is in this tab's tile wall immediately.
   */
  createStaffNeed(orgId: string, req: PublishNeedReq): StaffNeedResult {
    const org = findOrg((o) => o.id === orgId);
    if (!org) return { kind: "notFound" };
    const targetCents = req.targetCents ?? computeTargetCents(req.product.unitPriceCents, req.quantity);
    const tooSmall = checkMinTarget(targetCents);
    if (tooSmall) return tooSmall;

    const at = nowIso();
    const card: NeedCard = {
      id: crypto.randomUUID(),
      orgId,
      orgSlug: org.slug,
      title: req.title,
      description: req.description,
      category: req.category,
      urgency: req.urgency,
      quantity: req.quantity,
      unit: req.unit,
      status: req.publish ? "open" : "draft",
      targetCents,
      fundedCents: 0,
      heldCents: 0,
      remainingCents: targetCents,
      donorCount: 0,
      product: req.product,
      deadlineAt: req.deadlineAt,
      createdAt: at,
      updatedAt: at,
    };
    const created: fixtures.MockNeed = {
      card,
      timeline: [{ type: "created", at, label: "Need posted", amountCents: null }],
      delivery: null,
      alternatives: req.alternatives,
      purchases: [],
      deliveryView: null,
    };
    state.needs.set(card.id, created);
    publishNeedUpdated(card.id); // drafts stay private: nothing is sent for them
    return { kind: "ok", need: cardOf(created) };
  },

  /**
   * PATCH /api/staff/needs/:id (core/needs.ts patchNeed), rule for rule:
   * delivered and closed needs can't be edited; quantity is locked once money is in (funded + held);
   * a product swap only before funding; the target never drops below funded + held and is
   * recomputed when quantity or product change without an explicit one; "open" publishes a draft that
   * has a product; "closed" is refused while money is attached; afterwards funded/open is re-derived.
   */
  patchStaffNeed(orgId: string, id: string, patch: PatchNeedReq): StaffNeedResult {
    const need = state.needs.get(id);
    if (!need || need.card.orgId !== orgId) return { kind: "notFound" };
    const card = need.card;
    const status = card.status;
    if (status === "delivered" || status === "closed") return invalidState(`A ${status} need can't be edited`);

    const moneyIn = card.fundedCents + heldFor(id);
    const updates: Partial<NeedCard> = {};
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.description !== undefined) updates.description = patch.description;
    if (patch.urgency !== undefined) updates.urgency = patch.urgency;
    if (patch.deadlineAt !== undefined) updates.deadlineAt = patch.deadlineAt;

    const quantityChanged = patch.quantity !== undefined && patch.quantity !== card.quantity;
    if (quantityChanged) {
      if (moneyIn > 0) return invalidState("The quantity can't change once donations have started");
      updates.quantity = patch.quantity;
    }
    if (patch.product) {
      if (!PRE_FUNDING.includes(status))
        return invalidState("The product can only be changed before the item is funded");
      updates.product = patch.product;
    }

    const product = patch.product ?? card.product;
    const quantity = patch.quantity ?? card.quantity;
    let targetCents = card.targetCents;
    if (patch.targetCents !== undefined) targetCents = patch.targetCents;
    else if ((quantityChanged || patch.product) && product) {
      targetCents = computeTargetCents(product.unitPriceCents, quantity);
    }

    if (targetCents !== card.targetCents) {
      if (!EDITABLE_TARGET.includes(status)) return invalidState(`The target can't change once the item is ${status}`);
      const tooSmall = checkMinTarget(targetCents);
      if (tooSmall) return tooSmall;
      if (targetCents < moneyIn) {
        return invalidState(`The target can't be below what's already raised or on hold (${formatUsd(moneyIn)})`, {
          minTargetCents: moneyIn,
        });
      }
      updates.targetCents = targetCents;
    }

    let nextStatus: NeedStatus = status;
    if (patch.status === "open" && status !== "open") {
      if (status !== "draft") return invalidState(`Only a draft can be published (this need is ${status})`);
      if (!product) return invalidState("Choose a product before publishing");
      nextStatus = "open";
    }
    if (patch.status === "closed") {
      if (moneyIn > 0) return invalidState("This need has donations attached, so it can't be closed yet");
      nextStatus = "closed";
    }

    const at = nowIso();
    if (
      (nextStatus === "open" || nextStatus === "topping_up") &&
      card.fundedCents > 0 &&
      card.fundedCents >= targetCents
    ) {
      nextStatus = "funded";
      if (!state.fundedAt.has(id)) state.fundedAt.set(id, at);
    } else if (nextStatus === "funded" && card.fundedCents < targetCents) {
      nextStatus = "open";
    }
    if (nextStatus !== status) updates.status = nextStatus;

    if (Object.keys(updates).length > 0) {
      Object.assign(card, updates, { updatedAt: at });
      if (nextStatus === "closed") {
        need.timeline.push({ type: "closed", at, label: "Closed", amountCents: null });
      }
      publishNeedUpdated(id);
    }
    return { kind: "ok", need: cardOf(need) };
  },
};

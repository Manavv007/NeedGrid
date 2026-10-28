/**
 * Tiny in-memory "database" behind the MSW handlers, so mock mode behaves like the real API.
 * It starts as a deep copy of the fixtures and lives per browser tab (or per test, via `reset`).
 *
 * C-1 has reads only. Later tasks add the money rules here (create order → hold, capture → funded,
 * clamping, FULLY_FUNDED with nextNeed) plus an in-page event emitter for live updates.
 */
import {
  DONATABLE_STATUSES,
  type ImpactRes,
  type NeedCard,
  type NeedDetailRes,
  type NeedStatus,
  type OrgPageRes,
  type OrgPublic,
  type OrgStats,
  type OrgSummary,
  type StaffNeedDetailRes,
} from "@needgrid/shared";
import * as fixtures from "./fixtures";

type State = {
  orgs: OrgPublic[];
  needs: Map<string, fixtures.MockNeed>;
  impacts: Map<string, ImpactRes>;
};

function freshState(): State {
  return {
    orgs: structuredClone(fixtures.orgs),
    needs: new Map(fixtures.needs.map((n) => [n.card.id, structuredClone(n)])),
    impacts: new Map(Object.entries(structuredClone(fixtures.impacts))),
  };
}

let state = freshState();

/** Statuses hidden from the public site (same as the API). */
const NOT_PUBLIC: NeedStatus[] = ["draft", "closed"];
const FUNDED_STATUSES: NeedStatus[] = ["funded", "ordered", "delivered"];
const OPEN_STATUSES: readonly NeedStatus[] = DONATABLE_STATUSES;

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

function orgNeeds(orgId: string): fixtures.MockNeed[] {
  return [...state.needs.values()].filter((n) => n.card.orgId === orgId);
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

export const mockDb = {
  /** Back to the fixtures (tests call this between cases). */
  reset(): void {
    state = freshState();
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
      .map((n) => n.card)
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
    return { need: need.card, org, timeline: need.timeline, delivery: need.delivery };
  },

  getImpact(token: string): ImpactRes | null {
    return state.impacts.get(token) ?? null;
  },

  orgByStaffKey(key: string | null): OrgPublic | null {
    const orgId = key ? fixtures.STAFF_PASSCODES[key] : undefined;
    return orgId ? findOrg((o) => o.id === orgId) : null;
  },

  /** Staff list: includes drafts, newest update first. */
  listStaffNeeds(orgId: string, status?: NeedStatus): NeedCard[] {
    return orgNeeds(orgId)
      .map((n) => n.card)
      .filter((c) => !status || c.status === status)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  getStaffNeedDetail(orgId: string, id: string): StaffNeedDetailRes | null {
    const need = state.needs.get(id);
    if (!need || need.card.orgId !== orgId) return null;
    return {
      need: need.card,
      alternatives: need.alternatives,
      purchases: need.purchases,
      delivery: need.deliveryView,
      timeline: need.timeline,
    };
  },
};

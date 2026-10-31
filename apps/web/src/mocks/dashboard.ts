/**
 * Mocks for B's dashboard reads (HANDOFF 2026-10-31 from B, NOTES.md §16), so `/dashboard` works with
 * VITE_USE_MOCKS=true:
 *
 * - `GET /api/dashboard/datasets/:name` (`needs`, `donations`, `allocations`): the shared `DatasetRes`
 *   built from the mock ledger the same way B's apps/api/src/ai/datasets.ts builds it from the
 *   database: drafts left out, USD as numbers (`centsToUsdNumber`), `month` "YYYY-MM" in UTC,
 *   `daysFundedToDelivered` and `photoUrl` only for delivered needs. **No personal data**: donations
 *   are identified by an opaque hash-like `donationKey`, never a donor name, email, id or impact token.
 * - `GET /api/ai/dashboard-complete` → `{ enabled: false, dailyLimit: 300 }`: the AI chat stays hidden
 *   in mock mode. The POST (B's relay) has no mock.
 */
import {
  centsToUsdNumber,
  DATASETS,
  DatasetRes,
  type DatasetAllocationRow,
  type DatasetDonationRow,
  type DatasetName,
  type DatasetNeedRow,
  type TimelineEvent,
} from "@needgrid/shared";
import { http, HttpResponse } from "msw";
import { mockDb, type LedgerSnapshot } from "./mockDb";
import { latency, notFound } from "./respond";

/** What B's GET answers when the AI is off (B-internal shape, apps/api/src/ai/routes/dashboardAi.ts). */
export const MOCK_DASHBOARD_AI = { enabled: false, dailyLimit: 300 } as const;

const DAY_MS = 86_400_000;

/**
 * Stands in for B's HMAC: 16 hex characters from two 32-bit FNV-1a hashes of the donation id with a
 * fixed salt. Stable within a tab (allocations join to donations), and shows nothing of the id.
 */
export function mockDonationKey(donationId: string): string {
  const fnv = (text: string) => {
    let hash = 0x811c9dc5;
    for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
    return hash.toString(16).padStart(8, "0");
  };
  return `${fnv(`needgrid-mock:${donationId}`)}${fnv(`${donationId}:needgrid-mock`)}`;
}

const monthOf = (iso: string) => iso.slice(0, 7);

/** When a need's timeline says something happened (funded, ordered, delivered), or null. */
function timeOf(timeline: readonly TimelineEvent[], type: TimelineEvent["type"]): string | null {
  return timeline.find((event) => event.type === type)?.at ?? null;
}

/** Whole days between funded and delivered, rounded, never negative (B's `daysBetween`). */
function daysBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  return Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS));
}

function needRows(ledger: LedgerSnapshot): DatasetNeedRow[] {
  const orgById = new Map(ledger.orgs.map((org) => [org.id, org]));
  return ledger.needs
    .filter(({ card }) => card.status !== "draft")
    .flatMap(({ card, timeline, delivery }) => {
      const org = orgById.get(card.orgId);
      if (!org) return [];
      const delivered = card.status === "delivered";
      const fundedAt = timeOf(timeline, "funded");
      const deliveredAt = timeOf(timeline, "delivered");
      return [
        {
          needId: card.id,
          orgSlug: org.slug,
          orgName: org.name,
          title: card.title,
          category: card.category,
          urgency: card.urgency,
          status: card.status,
          quantity: card.quantity,
          unit: card.unit,
          retailer: card.product?.retailer ?? null,
          targetUsd: centsToUsdNumber(card.targetCents),
          fundedUsd: centsToUsdNumber(card.fundedCents),
          createdAt: card.createdAt,
          fundedAt,
          orderedAt: timeOf(timeline, "ordered"),
          deliveredAt,
          daysFundedToDelivered: delivered ? daysBetween(fundedAt, deliveredAt) : null,
          photoUrl: delivered ? (delivery?.photoUrl ?? null) : null,
        },
      ];
    })
    .sort((a, b) => a.orgSlug.localeCompare(b.orgSlug) || a.createdAt.localeCompare(b.createdAt));
}

function donationRows(ledger: LedgerSnapshot): DatasetDonationRow[] {
  const slugById = new Map(ledger.orgs.map((org) => [org.id, org.slug]));
  return ledger.donations
    .flatMap((donation) => {
      const orgSlug = slugById.get(donation.orgId);
      if (!orgSlug) return [];
      return [
        {
          donationKey: mockDonationKey(donation.id),
          orgSlug,
          amountUsd: centsToUsdNumber(donation.amountCents),
          source: donation.source,
          donatedAt: donation.at,
          month: monthOf(donation.at),
        },
      ];
    })
    .sort((a, b) => a.donatedAt.localeCompare(b.donatedAt));
}

function allocationRows(ledger: LedgerSnapshot): DatasetAllocationRow[] {
  const slugById = new Map(ledger.orgs.map((org) => [org.id, org.slug]));
  const needById = new Map(ledger.needs.map(({ card }) => [card.id, card]));
  return ledger.allocations
    .flatMap((allocation) => {
      const need = needById.get(allocation.needId);
      const orgSlug = need ? slugById.get(need.orgId) : undefined;
      // Same filter as the needs dataset, so every allocation joins to a needs row.
      if (!need || !orgSlug || need.status === "draft") return [];
      return [
        {
          allocationId: allocation.id,
          donationKey: mockDonationKey(allocation.donationId),
          needId: allocation.needId,
          orgSlug,
          category: need.category,
          amountUsd: centsToUsdNumber(allocation.amountCents), // signed: negative = moved out of this need
          reason: allocation.reason,
          allocatedAt: allocation.at,
          month: monthOf(allocation.at),
        },
      ];
    })
    .sort((a, b) => a.allocatedAt.localeCompare(b.allocatedAt));
}

const isDataset = (name: string): name is DatasetName => (DATASETS as readonly string[]).includes(name);

/** One dataset as B's route answers it right now, validated; null for an unknown name. */
export function mockDataset(name: string): DatasetRes | null {
  if (!isDataset(name)) return null;
  const ledger = mockDb.ledgerSnapshot();
  const rows =
    name === "needs" ? needRows(ledger) : name === "donations" ? donationRows(ledger) : allocationRows(ledger);
  return DatasetRes.parse({ name, generatedAt: new Date().toISOString(), rows });
}

export const dashboardHandlers = [
  http.get("*/api/dashboard/datasets/:name", async ({ params }) => {
    await latency();
    const dataset = mockDataset(String(params.name));
    return dataset ? HttpResponse.json(dataset) : notFound("Dataset");
  }),

  http.get("*/api/ai/dashboard-complete", async () => {
    await latency();
    return HttpResponse.json(MOCK_DASHBOARD_AI);
  }),
];

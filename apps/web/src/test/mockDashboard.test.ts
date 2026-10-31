import {
  ApiError,
  DatasetAllocationRow,
  DatasetDonationRow,
  DatasetNeedRow,
  DatasetRes,
  paths,
  type CreateOrderReq,
} from "@needgrid/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildStudioData, fetchDashboardData } from "@/dashboard/data";
import { isDashboardAiEnabled } from "@/dashboard/geminiAdapter";
import { DEMO_IMPACT_TOKEN, impactRecords, orgs } from "@/mocks/fixtures";
import { MOCK_DASHBOARD_AI } from "@/mocks/dashboard";
import { mockDb } from "@/mocks/mockDb";

const API = "http://api.test";
const DIAPERS_4 = "4c1f7a2e-9b3d-4e5f-8a6b-000000000101"; // Harbor, open, $14 left

async function get(path: string) {
  const res = await fetch(`${API}${path}`);
  return { status: res.status, json: (await res.json()) as unknown };
}

async function dataset<T extends z.ZodType>(name: string, row: T): Promise<{ text: string; rows: z.infer<T>[] }> {
  const res = await get(paths.dataset(name));
  expect(res.status).toBe(200);
  const parsed = DatasetRes.parse(res.json);
  expect(parsed.name).toBe(name);
  return { text: JSON.stringify(res.json), rows: z.array(row).parse(parsed.rows) };
}

/** Every impact token and donor name the mock ledger knows (none may leak into a dataset). */
function personalData(): string[] {
  const names = impactRecords.flatMap((r) => (r.donorFirstName ? [r.donorFirstName] : []));
  return [DEMO_IMPACT_TOKEN, ...impactRecords.map((r) => r.token), ...names];
}

describe("mock dashboard datasets (B's GET /api/dashboard/datasets/:name)", () => {
  it("needs: every org, every public status, USD numbers and the delivery facts", async () => {
    const { rows } = await dataset("needs", DatasetNeedRow);
    expect(new Set(rows.map((r) => r.orgSlug))).toEqual(new Set(orgs.map((o) => o.slug)));
    expect(new Set(rows.map((r) => r.status))).toEqual(
      new Set(["open", "funded", "ordered", "delivered", "topping_up", "closed"]),
    );
    const diapers = rows.find((r) => r.needId === DIAPERS_4);
    expect(diapers).toMatchObject({ orgName: "Harbor Food Bank", targetUsd: 84, fundedUsd: 70, fundedAt: null });
    for (const row of rows.filter((r) => r.status === "delivered")) {
      expect(row.fundedAt).not.toBeNull();
      expect(row.deliveredAt).not.toBeNull();
      expect(row.daysFundedToDelivered).toBeGreaterThanOrEqual(0);
      expect(row.photoUrl).toMatch(/^https?:\/\//);
    }
    for (const row of rows.filter((r) => r.status !== "delivered")) {
      expect(row.daysFundedToDelivered).toBeNull();
      expect(row.photoUrl).toBeNull();
    }
    expect(rows.some((r) => r.orderedAt !== null)).toBe(true);
  });

  it("donations and allocations join on donationKey and add up to the funded amounts", async () => {
    const needs = await dataset("needs", DatasetNeedRow);
    const donations = await dataset("donations", DatasetDonationRow);
    const allocations = await dataset("allocations", DatasetAllocationRow);
    expect(donations.rows.length).toBeGreaterThan(10);
    for (const row of donations.rows) {
      expect(row.donationKey).toMatch(/^[0-9a-f]{16}$/);
      expect(row.month).toBe(row.donatedAt.slice(0, 7));
      expect(row.source).toBe("seed");
    }
    const keys = new Set(donations.rows.map((r) => r.donationKey));
    expect(keys.size).toBe(donations.rows.length);
    for (const row of allocations.rows) expect(keys.has(row.donationKey)).toBe(true);

    const fundedByNeed = new Map<string, number>();
    for (const row of allocations.rows) {
      fundedByNeed.set(row.needId, (fundedByNeed.get(row.needId) ?? 0) + Math.round(row.amountUsd * 100));
    }
    for (const need of needs.rows) {
      expect(fundedByNeed.get(need.needId) ?? 0).toBe(Math.round(need.fundedUsd * 100));
    }
  });

  it("a mock checkout shows up as an `order` donation", async () => {
    const req: CreateOrderReq = { needId: DIAPERS_4, amountCents: 1000, rollOverConsent: true };
    const order = mockDb.createOrder(req);
    if (order.kind !== "ok") throw new Error("expected an order");
    expect(mockDb.capture(order.order.orderId).kind).toBe("ok");
    const { rows } = await dataset("donations", DatasetDonationRow);
    expect(rows.filter((r) => r.source === "order").map((r) => r.amountUsd)).toEqual([10]);
  });

  it("has no personal data: no emails, donor names, impact tokens or donation ids", async () => {
    // A real checkout too, so this tab's own donations are covered.
    const order = mockDb.createOrder({ needId: DIAPERS_4, amountCents: 500, rollOverConsent: true });
    if (order.kind === "ok") mockDb.capture(order.order.orderId);
    const ledger = mockDb.ledgerSnapshot();
    for (const name of ["needs", "donations", "allocations"]) {
      const res = await get(paths.dataset(name));
      const text = JSON.stringify(res.json);
      expect(text).not.toContain("@");
      for (const secret of personalData()) expect(text).not.toContain(secret);
      for (const donation of ledger.donations) expect(text).not.toContain(donation.id);
    }
  });

  it("an unknown dataset is 404 NOT_FOUND", async () => {
    const res = await get(paths.dataset("donors"));
    expect(res.status).toBe(404);
    expect(ApiError.parse(res.json).error.code).toBe("NOT_FOUND");
  });
});

describe("mock dashboard AI check (B's GET /api/ai/dashboard-complete)", () => {
  it("says the AI is off, so the dashboard hides its chat in mock mode", async () => {
    const res = await get(paths.dashboardComplete);
    expect(res).toEqual({ status: 200, json: { enabled: false, dailyLimit: 300 } });
    expect(MOCK_DASHBOARD_AI).toEqual({ enabled: false, dailyLimit: 300 });
    expect(await isDashboardAiEnabled()).toBe(false);
  });
});

describe("B's dashboard loader against the mocks", () => {
  it("loads all three datasets and builds the AG Studio sources (no error state)", async () => {
    const data = await fetchDashboardData();
    expect(data.needs.length).toBeGreaterThan(30);
    expect(data.donations.length).toBeGreaterThan(10);
    expect(data.allocations.length).toBeGreaterThan(10);
    const studio = buildStudioData(data);
    expect(studio.sources?.map((s) => s.id)).toEqual(["needs", "donations", "allocations"]);
  });
});

import {
  ApiError,
  DatasetAllocationRow,
  DatasetDonationRow,
  DatasetNeedRow,
  DatasetRes,
  type DatasetName,
} from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { CATALOG } from "../../scripts/seed/catalog";
import { buildPlan, type SeedPlan } from "../../scripts/seed/plan";
import { loadCache } from "../../scripts/seed/products";
import { writePlan } from "../../scripts/seed/seed";
import { buildApp } from "../app";
import { closeDb } from "../db/client";
import { createTestDb, hasTestDb, migrateTestDb, truncateAll, type TestDb } from "../test/db";
import { nextIp } from "../test/fixtures";
import { clearDatasetCache, daysBetween, donationKey, monthOf } from "./datasets";

describe("helpers", () => {
  it("donationKey is 16 hex chars, stable for the same secret, different for another", () => {
    const id = "6f1c1d1e-2b3c-4d5e-8f90-123456789abc";
    expect(donationKey(id, "s1")).toMatch(/^[0-9a-f]{16}$/);
    expect(donationKey(id, "s1")).toBe(donationKey(id, "s1"));
    expect(donationKey(id, "s2")).not.toBe(donationKey(id, "s1"));
    expect(donationKey(id, "s1")).not.toContain(id.slice(0, 8));
  });
  it("monthOf uses UTC", () => {
    expect(monthOf(new Date("2026-11-01T02:00:00Z"))).toBe("2026-11");
    expect(monthOf(new Date("2026-10-31T23:59:00Z"))).toBe("2026-10");
  });
  it("daysBetween rounds to whole days and is null without both dates", () => {
    expect(daysBetween(new Date("2026-11-01T00:00:00Z"), new Date("2026-11-04T13:00:00Z"))).toBe(4);
    expect(daysBetween(null, new Date())).toBeNull();
  });
});

describe("GET /api/dashboard/datasets/:name without a database", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  it("unknown name → 404 NOT_FOUND", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/datasets/donors",
      headers: { "x-forwarded-for": nextIp() },
    });
    expect(res.statusCode).toBe(404);
    expect(ApiError.parse(res.json()).error.code).toBe("NOT_FOUND");
  });
});

describe.skipIf(!hasTestDb)("datasets on seeded data (test database)", () => {
  let t: TestDb;
  let app: FastifyInstance;
  let plan: SeedPlan;
  const bodies: Partial<Record<DatasetName, string>> = {};

  beforeAll(async () => {
    t = createTestDb();
    await migrateTestDb(t);
    await truncateAll(t);
    plan = buildPlan({ seed: 2026, end: new Date("2026-11-09T20:00:00Z"), cache: loadCache() });
    await writePlan(t.db, plan, { reset: true });
    clearDatasetCache();
    app = await buildApp({ logger: false });
    await app.ready();
    for (const name of ["needs", "donations", "allocations"] as const) {
      const res = await app.inject({
        method: "GET",
        url: `/api/dashboard/datasets/${name}`,
        headers: { "x-forwarded-for": nextIp() },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toBe("public, max-age=60");
      bodies[name] = res.body;
    }
  });

  afterAll(async () => {
    await app?.close();
    await truncateAll(t);
    await t.pool.end();
    await closeDb();
  });

  const rows = <T extends z.ZodType>(name: DatasetName, row: T): z.infer<T>[] => {
    const parsed = DatasetRes.parse(JSON.parse(bodies[name]!));
    expect(parsed.name).toBe(name);
    return z.array(row).parse(parsed.rows);
  };

  it("needs: every non-draft need, money in USD, delivered ones with days and a photo", () => {
    const needs = rows("needs", DatasetNeedRow);
    expect(needs).toHaveLength(plan.needs.length);
    const expected = new Map(plan.needs.map((n) => [n.id, n]));
    for (const r of needs) {
      const n = expected.get(r.needId)!;
      expect(r.targetUsd).toBe(n.targetCents / 100);
      expect(r.fundedUsd).toBe((n.fundedCents ?? 0) / 100);
      if (r.status === "delivered") {
        expect(r.photoUrl).not.toBeNull();
        expect(r.daysFundedToDelivered).toBeGreaterThanOrEqual(1);
        expect(r.daysFundedToDelivered).toBeLessThanOrEqual(10);
      } else {
        expect(r.photoUrl).toBeNull();
        expect(r.daysFundedToDelivered).toBeNull();
      }
    }
    expect(new Set(needs.map((r) => r.orgSlug))).toEqual(new Set(Object.keys(CATALOG)));
  });

  it("donations and allocations join on donationKey, and every allocation's need is in the needs dataset", () => {
    const donations = rows("donations", DatasetDonationRow);
    const allocations = rows("allocations", DatasetAllocationRow);
    const needIds = new Set(rows("needs", DatasetNeedRow).map((r) => r.needId));
    expect(donations).toHaveLength(plan.donations.length);
    expect(allocations).toHaveLength(plan.allocations.length);
    const keys = new Set(donations.map((d) => d.donationKey));
    expect(keys.size).toBe(donations.length); // no collisions
    for (const a of allocations) {
      expect(keys.has(a.donationKey)).toBe(true);
      expect(needIds.has(a.needId)).toBe(true);
    }
    const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100);
    expect(sum(allocations.map((a) => a.amountUsd))).toBe(sum(donations.map((d) => d.amountUsd)));
    for (const d of donations) expect(d.month).toBe(d.donatedAt.slice(0, 7));
  });

  it("contains NO personal data: no emails, donor names, donation ids or impact tokens", () => {
    const all = Object.values(bodies).join("\n");
    expect(all).not.toContain("@");
    for (const d of plan.donations) {
      expect(all).not.toContain(d.id);
      expect(all).not.toContain(d.impactToken);
    }
    const names = new Set(plan.donations.map((d) => d.donorName).filter((n): n is string => Boolean(n)));
    for (const name of names) expect(all).not.toMatch(new RegExp(`\\b${name}\\b`));
    for (const field of ["donorName", "donorEmail", "impactToken", "captureId", "paypalOrderId", "staffKeyHash"]) {
      expect(all).not.toContain(`"${field}"`);
    }
  });
});

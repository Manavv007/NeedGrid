/**
 * proposeAction + GET /api/staff/agent/actions + listRecordedDonations against a real Postgres (TEST_DATABASE_URL).
 * The rule under test: proposing NEVER calls PayPal, and every amount comes from the database.
 */
import { AgentActionListRes, ApiError } from "@needgrid/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app";
import { listRecordedDonations, proposeAction } from "../core";
import { closeDb } from "../db/client";
import { agentActions, allocations, donations, reservations, sponsorInvoices } from "../db/schema";
import { createTestDb, hasTestDb, migrateTestDb, truncateAll, type TestDb } from "../test/db";
import { seedNeed, seedOrg } from "../test/fixtures";

const KEY = "harbor-demo-2026";

describe.skipIf(!hasTestDb)("money actions: propose", () => {
  let t: TestDb;
  let app: FastifyInstance;
  let orgId: string;
  let otherOrgId: string;
  const fetchSpy = vi.fn();

  beforeAll(async () => {
    t = createTestDb();
    await migrateTestDb(t);
    app = await buildApp({ logger: false });
    await app.ready();
  });
  beforeEach(async () => {
    await truncateAll(t);
    orgId = (await seedOrg(t, "room-12-readers", KEY)).id;
    otherOrgId = (await seedOrg(t, "second-chance-paws", "paws-demo-2026")).id;
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy); // any PayPal call would show up here
  });
  afterEach(() => {
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await app?.close();
    await t?.pool.end();
    await closeDb();
  });

  /** The 4 winter coats from the demo script. */
  const coats = async () => {
    const a = await seedNeed(t, orgId, { title: "Winter coat, size 8", category: "clothing", targetCents: 4500 });
    const b = await seedNeed(t, orgId, {
      title: "Winter coat, size 10",
      category: "clothing",
      targetCents: 4500,
      fundedCents: 1500,
    });
    const c = await seedNeed(t, orgId, { title: "Winter coat, size 12", category: "clothing", targetCents: 5000 });
    const d = await seedNeed(t, orgId, {
      title: "Winter coat, size 14",
      category: "clothing",
      targetCents: 5000,
      fundedCents: 5000,
      status: "funded",
    });
    return { a, b, c, d };
  };

  it("invoice: server computes what's left per need (holds included); the AI passes no amounts", async () => {
    const { a, b, c } = await coats();
    await t.db
      .insert(reservations)
      .values({ needId: c.id, amountCents: 1000, expiresAt: new Date(Date.now() + 600_000) });
    const action = await proposeAction({
      orgId,
      tool: "create_invoice",
      args: { needIds: [a.id, b.id, c.id], recipientEmail: "sponsor@acme.example", recipientName: "Acme Hardware" },
      origin: "assistant",
    });
    expect(action).toMatchObject({ tool: "create_invoice", status: "proposed", origin: "assistant", result: null });
    expect(action.args).toMatchObject({ needIds: [a.id, b.id, c.id], send: true });
    expect(action.computed).toEqual({
      planned: [
        { needId: a.id, title: "Winter coat, size 8", amountCents: 4500 },
        { needId: b.id, title: "Winter coat, size 10", amountCents: 3000 },
        { needId: c.id, title: "Winter coat, size 12", amountCents: 4000 },
      ],
      totalCents: 11_500,
    });
    expect(action.preview).toMatchObject({ title: "Invoice Acme Hardware for 3 items", totalCents: 11_500 });
    expect(action.preview.lines).toContainEqual({ label: "Total (computed by NeedGrid)", value: "$115.00" });
  });

  it("invoice: an amount smuggled into the args is ignored, not used", async () => {
    const { a } = await coats();
    const action = await proposeAction({
      orgId,
      tool: "create_invoice",
      args: { needIds: [a.id], recipientEmail: "x@acme.example", amountCents: 1, totalCents: 1 },
      origin: "assistant",
    });
    expect(action.args).not.toHaveProperty("amountCents");
    expect(action.computed).toMatchObject({ totalCents: 4500 });
  });

  it("invoice guards: other org's need, funded need, all covered, bad email → 400 and nothing stored", async () => {
    const { a, d } = await coats();
    const foreign = await seedNeed(t, otherOrgId, { title: "Dog food", category: "pet", targetCents: 3000 });
    const bad = (args: unknown) => proposeAction({ orgId, tool: "create_invoice", args, origin: "assistant" });
    await expect(bad({ needIds: [a.id, foreign.id], recipientEmail: "s@x.example" })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining(foreign.id),
    });
    await expect(bad({ needIds: [d.id], recipientEmail: "s@x.example" })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("funded"),
    });
    await t.db
      .insert(reservations)
      .values({ needId: a.id, amountCents: 4500, expiresAt: new Date(Date.now() + 600_000) });
    await expect(bad({ needIds: [a.id], recipientEmail: "s@x.example" })).rejects.toMatchObject({ status: 400 });
    await expect(bad({ needIds: [a.id], recipientEmail: "not-an-email" })).rejects.toMatchObject({ status: 400 });
    expect(await t.db.select().from(agentActions)).toHaveLength(0);
  });

  it("send_invoice: only this org's drafts", async () => {
    const [draft] = await t.db
      .insert(sponsorInvoices)
      .values({ orgId, recipientEmail: "s@acme.example", recipientName: "Acme", amountCents: 9000, status: "draft" })
      .returning();
    const action = await proposeAction({
      orgId,
      tool: "send_invoice",
      args: { sponsorInvoiceId: draft!.id },
      origin: "assistant",
    });
    expect(action).toMatchObject({ computed: { amountCents: 9000 }, preview: { totalCents: 9000 } });

    await expect(
      proposeAction({
        orgId: otherOrgId,
        tool: "send_invoice",
        args: { sponsorInvoiceId: draft!.id },
        origin: "assistant",
      }),
    ).rejects.toMatchObject({ status: 400 });
    await t.db.update(sponsorInvoices).set({ status: "sent" }).where(eq(sponsorInvoices.id, draft!.id));
    await expect(
      proposeAction({ orgId, tool: "send_invoice", args: { sponsorInvoiceId: draft!.id }, origin: "assistant" }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("sent") });
  });

  it("refund: unallocated money + shares of needs not yet bought; spent money is excluded", async () => {
    const open = await seedNeed(t, orgId, { title: "Wipes", targetCents: 3000 });
    const ordered = await seedNeed(t, orgId, { title: "Formula", targetCents: 3000, status: "ordered" });
    const [don] = await t.db
      .insert(donations)
      .values({
        orgId,
        amountCents: 2500,
        unallocatedCents: 500,
        source: "order",
        captureId: "CAP-R1",
        paypalOrderId: "ORD-R1",
        impactToken: "tok-refund-1",
      })
      .returning();
    await t.db.insert(allocations).values([
      { donationId: don!.id, needId: open.id, amountCents: 1200, reason: "direct" },
      { donationId: don!.id, needId: ordered.id, amountCents: 800, reason: "overflow" },
    ]);
    const action = await proposeAction({
      orgId,
      tool: "create_refund",
      args: { donationId: don!.id, reason: "Donor asked" },
      origin: "assistant",
    });
    expect(action.computed).toMatchObject({ refundCents: 1700, captureId: "CAP-R1" });
    expect(action.preview).toMatchObject({ title: "Refund $17.00 to a donor", totalCents: 1700 });

    const [seed] = await t.db
      .insert(donations)
      .values({ orgId, amountCents: 1000, source: "seed", impactToken: "tok-seed-r" })
      .returning();
    await expect(
      proposeAction({
        orgId,
        tool: "create_refund",
        args: { donationId: seed!.id, reason: "test" },
        origin: "assistant",
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      proposeAction({
        orgId: otherOrgId,
        tool: "create_refund",
        args: { donationId: don!.id, reason: "test" },
        origin: "assistant",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("GET /api/staff/agent/actions lists only this org's actions, newest first, with a status filter", async () => {
    const { a, b } = await coats();
    await proposeAction({
      orgId,
      tool: "create_invoice",
      args: { needIds: [a.id], recipientEmail: "s@x.example" },
      origin: "assistant",
    });
    await proposeAction({
      orgId,
      tool: "create_invoice",
      args: { needIds: [b.id], recipientEmail: "s@x.example" },
      origin: "assistant",
    });
    const foreign = await seedNeed(t, otherOrgId, { title: "Dog food", category: "pet", targetCents: 3000 });
    await proposeAction({
      orgId: otherOrgId,
      tool: "create_invoice",
      args: { needIds: [foreign.id], recipientEmail: "s@x.example" },
      origin: "assistant",
    });

    const get = (url: string, key = KEY) => app.inject({ method: "GET", url, headers: { "x-staff-key": key } });
    const list = AgentActionListRes.parse((await get("/api/staff/agent/actions")).json());
    expect(list.actions).toHaveLength(2);
    expect(list.actions[0]!.computed).toMatchObject({ totalCents: 3000 }); // b (newest) first
    const proposed = AgentActionListRes.parse((await get("/api/staff/agent/actions?status=proposed")).json());
    expect(proposed.actions).toHaveLength(2);
    expect(
      AgentActionListRes.parse((await get("/api/staff/agent/actions?status=executed")).json()).actions,
    ).toHaveLength(0);
    expect((await get("/api/staff/agent/actions?status=bogus")).statusCode).toBe(400);
    const noKey = await app.inject({ method: "GET", url: "/api/staff/agent/actions" });
    expect(ApiError.parse(noKey.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("listRecordedDonations: this org's real donations in the window, seed history excluded", async () => {
    const now = Date.now();
    await t.db.insert(donations).values([
      {
        orgId,
        amountCents: 1400,
        source: "order",
        captureId: "CAP-1",
        impactToken: "tok-a",
        createdAt: new Date(now - 2 * 86_400_000),
      },
      { orgId, amountCents: 900, source: "seed", impactToken: "tok-b", createdAt: new Date(now - 86_400_000) },
      {
        orgId,
        amountCents: 500,
        source: "order",
        captureId: "CAP-OLD",
        impactToken: "tok-c",
        createdAt: new Date(now - 40 * 86_400_000),
      },
      { orgId: otherOrgId, amountCents: 700, source: "order", captureId: "CAP-X", impactToken: "tok-d" },
    ]);
    const rows = await listRecordedDonations({
      orgId,
      start: new Date(now - 7 * 86_400_000),
      end: new Date(now + 60_000),
    });
    expect(rows).toEqual([expect.objectContaining({ captureId: "CAP-1", amountCents: 1400, paypalInvoiceId: null })]);
    await expect(
      listRecordedDonations({ orgId, start: new Date(now - 40 * 86_400_000), end: new Date(now) }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

/**
 * Roll-over of needs past their deadline, against a real Postgres (TEST_DATABASE_URL).
 * The rule under test: closing an underfunded need never strands or invents money. Consenting donors' money moves
 * to the most urgent open needs; everything else is set aside and a refund is PROPOSED (never sent automatically).
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approveAction } from "../agent/executors";
import { getNeedCard } from "../core/needs";
import { closeDb } from "../db/client";
import { agentActions, allocations, donations, needs, type NeedRow } from "../db/schema";
import { assertMoneyInvariants } from "../money/invariants";
import { FakePayPalRefunds } from "../paypal/__fakes__";
import { realRefundsGateway, setRefundsGateway } from "../paypal/refunds";
import { createTestDb, hasTestDb, migrateTestDb, truncateAll, type TestDb } from "../test/db";
import { seedNeed, seedOrg } from "../test/fixtures";
import { rollOverExpiredNeeds } from "./rollover";

const DAY = 86_400_000;

describe.skipIf(!hasTestDb)("roll-over of expired needs", () => {
  let t: TestDb;
  let orgId: string;
  let refunds: FakePayPalRefunds;
  let seq = 0;

  beforeAll(async () => {
    t = createTestDb();
    await migrateTestDb(t);
  });
  beforeEach(async () => {
    await truncateAll(t);
    orgId = (await seedOrg(t)).id;
    refunds = new FakePayPalRefunds();
    setRefundsGateway(refunds);
  });
  afterEach(async () => {
    await assertMoneyInvariants(t.db);
  });
  afterAll(async () => {
    setRefundsGateway(realRefundsGateway);
    await t?.pool.end();
    await closeDb();
  });

  /** A PayPal checkout donation of `cents` on `need`. */
  const give = async (need: NeedRow, cents: number, rollOverConsent = true) => {
    const n = ++seq;
    const [don] = await t.db
      .insert(donations)
      .values({
        orgId,
        amountCents: cents,
        source: "order",
        captureId: `CAP-RO-${n}`,
        paypalOrderId: `ORD-RO-${n}`,
        impactToken: `tok-ro-${n}`,
        rollOverConsent,
      })
      .returning();
    await t.db
      .insert(allocations)
      .values({ donationId: don!.id, needId: need.id, amountCents: cents, reason: "direct" });
    const [row] = await t.db.select().from(needs).where(eq(needs.id, need.id));
    await t.db
      .update(needs)
      .set({ fundedCents: row!.fundedCents + cents })
      .where(eq(needs.id, need.id));
    return don!;
  };
  const expired = (title: string, targetCents: number, extra: Partial<typeof needs.$inferInsert> = {}) =>
    seedNeed(t, orgId, { title, targetCents, deadlineAt: new Date(Date.now() - DAY), ...extra });
  const netOn = async (donationId: string, needId: string) =>
    (await t.db.select().from(allocations).where(eq(allocations.donationId, donationId)))
      .filter((a) => a.needId === needId)
      .reduce((s, a) => s + a.amountCents, 0);

  it("consenting donors' money moves to the most urgent open need with paired rows; the need closes", async () => {
    const old = await expired("Winter coats", 9000);
    const urgent = await seedNeed(t, orgId, { title: "Formula", targetCents: 5000, urgency: 3 });
    const calm = await seedNeed(t, orgId, { title: "Crayons", targetCents: 5000, urgency: 1 });
    const future = await seedNeed(t, orgId, {
      title: "Hats",
      targetCents: 3000,
      deadlineAt: new Date(Date.now() + DAY),
    });
    const fundedLate = await expired("Gloves", 2000, { fundedCents: 2000, status: "funded" });
    const a = await give(old, 2500);
    const b = await give(old, 1500);

    const done = await rollOverExpiredNeeds();
    expect(done).toEqual([
      { needId: old.id, title: "Winter coats", movedCents: 4000, setAsideCents: 0, refundProposals: 0 },
    ]);
    expect(await getNeedCard(old.id)).toMatchObject({ status: "closed", fundedCents: 0 });
    expect((await t.db.select().from(needs).where(eq(needs.id, old.id)))[0]!.closedAt).toBeInstanceOf(Date);
    expect((await getNeedCard(urgent.id))!.fundedCents).toBe(4000);
    expect((await getNeedCard(calm.id))!.fundedCents).toBe(0);
    expect(await getNeedCard(future.id)).toMatchObject({ status: "open", fundedCents: 0 });
    expect((await getNeedCard(fundedLate.id))!.status).toBe("funded"); // funded in time: never rolled over
    expect(await netOn(a.id, urgent.id)).toBe(2500);

    const rows = await t.db.select().from(allocations).where(eq(allocations.donationId, b.id));
    const out = rows.find((r) => r.reason === "rollover" && r.amountCents < 0)!;
    const into = rows.find((r) => r.reason === "rollover" && r.amountCents > 0)!;
    expect([out.needId, out.amountCents, into.needId, into.amountCents]).toEqual([old.id, -1500, urgent.id, 1500]);
    expect(into.relatedAllocationId).toBe(out.id);

    expect(await rollOverExpiredNeeds()).toEqual([]); // safe to run again
    expect(await t.db.select().from(agentActions)).toHaveLength(0);
  });

  it("no consent → set aside with a refund PROPOSAL that, once approved, refunds exactly that money", async () => {
    const old = await expired("Bus passes", 6000);
    await seedNeed(t, orgId, { title: "Formula", targetCents: 5000, urgency: 3 });
    const keeper = await give(old, 2000, false);

    const [result] = await rollOverExpiredNeeds();
    expect(result).toMatchObject({ movedCents: 0, setAsideCents: 2000, refundProposals: 1 });
    expect(refunds.calls).toHaveLength(0); // nothing is sent without a human
    const [don] = await t.db.select().from(donations).where(eq(donations.id, keeper.id));
    expect(don!.unallocatedCents).toBe(2000);

    const [proposal] = await t.db.select().from(agentActions);
    expect(proposal).toMatchObject({ tool: "create_refund", origin: "system", status: "proposed" });
    const done = await approveAction(orgId, proposal!.id);
    expect(done).toMatchObject({ status: "executed", result: { refundCents: 2000 } });
    expect(refunds.calls[0]).toMatchObject({ captureId: keeper.captureId, amountCents: 2000 });
  });

  it("nowhere to go: consenting money is set aside too; seed money gets no refund proposal", async () => {
    const old = await expired("Desk lamps", 8000, { fundedCents: 1000 }); // 1000 from a seed donation
    const don = await give(old, 3000);

    const [result] = await rollOverExpiredNeeds();
    expect(result).toMatchObject({ movedCents: 0, setAsideCents: 4000, refundProposals: 1 });
    const [after] = await t.db.select().from(donations).where(eq(donations.id, don.id));
    expect(after!.unallocatedCents).toBe(3000);
    const proposals = await t.db.select().from(agentActions);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.args).toMatchObject({ donationId: don.id });
  });

  it("an older system refund proposal for the same donation is replaced by one for the new total", async () => {
    const first = await expired("Socks", 5000);
    const second = await expired("Scarves", 5000);
    const don = await give(first, 1000, false);
    // The same donor also gave to the second need (e.g. an overflow), without consent.
    await t.db
      .insert(allocations)
      .values({ donationId: don.id, needId: second.id, amountCents: 700, reason: "direct" });
    await t.db.update(donations).set({ amountCents: 1700 }).where(eq(donations.id, don.id));
    await t.db.update(needs).set({ fundedCents: 700 }).where(eq(needs.id, second.id));

    expect(await rollOverExpiredNeeds()).toHaveLength(2);
    const actions = await t.db.select().from(agentActions);
    expect(actions.map((a) => a.status).sort()).toEqual(["failed", "proposed"]);
    const live = actions.find((a) => a.status === "proposed")!;
    expect(live.computed).toMatchObject({ refundCents: 1700 });
    expect((await approveAction(orgId, live.id)).status).toBe("executed");
  });
});

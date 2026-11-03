/** recordDelivery / confirmDelivery against a real Postgres (TEST_DATABASE_URL). */
import { ImpactRes, NeedDetailRes, OrgPageRes } from "@needgrid/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { closeDb } from "../db/client";
import { deliveries, donations } from "../db/schema";
import { createTestDb, hasTestDb, migrateTestDb, truncateAll, type TestDb } from "../test/db";
import { seedNeed, seedOrg } from "../test/fixtures";
import { confirmDelivery, recordDelivery } from "./deliveries";
import { getNeedCard } from "./needs";

const PHOTO = "https://res.cloudinary.com/demo/image/upload/v1/needgrid/arrival.jpg";
const check = (needId: string, needsReview: boolean, message: string | null = "Thank you! The diapers arrived.") => ({
  needId,
  photoUrl: PHOTO,
  matchScore: needsReview ? 0.3 : 0.92,
  aiNotes: needsReview ? "Box looks different" : "Matches the product",
  needsReview,
  message,
});

describe.skipIf(!hasTestDb)("deliveries", () => {
  let t: TestDb;
  let app: FastifyInstance;
  let orgId: string;

  beforeAll(async () => {
    t = createTestDb();
    await migrateTestDb(t);
    app = await buildApp({ logger: false });
    await app.ready();
  });
  beforeEach(async () => {
    await truncateAll(t);
    orgId = (await seedOrg(t)).id;
  });
  afterAll(async () => {
    await app?.close();
    await t?.pool.end();
    await closeDb();
  });

  const orderedNeed = () =>
    seedNeed(t, orgId, { title: "Diapers, size 4", targetCents: 3000, fundedCents: 3000, status: "ordered" });

  it("a passing check marks the need delivered; the photo shows on the card, the need page and the impact page", async () => {
    const need = await orderedNeed();
    const { delivery, need: card } = await recordDelivery(check(need.id, false));
    expect(delivery).toMatchObject({
      needsReview: false,
      matchScore: 0.92,
      message: "Thank you! The diapers arrived.",
    });
    expect(card).toMatchObject({ status: "delivered", deliveryPhotoUrl: PHOTO });

    const page = OrgPageRes.parse((await app.inject({ method: "GET", url: "/api/orgs/harbor-food-bank" })).json());
    expect(page.needs[0]!.deliveryPhotoUrl).toBe(PHOTO);
    const detail = NeedDetailRes.parse((await app.inject({ method: "GET", url: `/api/needs/${need.id}` })).json());
    expect(detail.delivery).toMatchObject({ photoUrl: PHOTO, message: "Thank you! The diapers arrived." });
    expect(detail.timeline.at(-1)!.type).toBe("delivered");

    const [don] = await t.db.select().from(donations).limit(1);
    const impact = ImpactRes.parse(
      (await app.inject({ method: "GET", url: `/api/impact/${don!.impactToken}` })).json(),
    );
    expect(impact.items[0]!.delivery?.photoUrl).toBe(PHOTO);
  });

  it("needs review: stays ordered with no public photo until staff confirm", async () => {
    const need = await orderedNeed();
    const { delivery, need: card } = await recordDelivery(check(need.id, true));
    expect(card).toMatchObject({ status: "ordered", deliveryPhotoUrl: null });

    const kept = await confirmDelivery(delivery.id, orgId); // message undefined → keep it
    expect(kept.delivery.message).toBe("Thank you! The diapers arrived.");
    expect(kept.delivery.confirmedAt).not.toBeNull();
    expect(kept.need).toMatchObject({ status: "delivered", deliveryPhotoUrl: PHOTO });

    const cleared = await confirmDelivery(delivery.id, orgId, ""); // "" → no donor message
    expect(cleared.delivery.message).toBeNull();
    const edited = await confirmDelivery(delivery.id, orgId, "  Arrived Friday.  ");
    expect(edited.delivery.message).toBe("Arrived Friday.");
  });

  it("a retake after a failed check works; the passing photo is the one shown", async () => {
    const need = await orderedNeed();
    await recordDelivery(check(need.id, true));
    const second = {
      ...check(need.id, false),
      photoUrl: "https://res.cloudinary.com/demo/image/upload/v1/needgrid/retake.jpg",
    };
    await recordDelivery(second);
    expect((await getNeedCard(need.id))!.deliveryPhotoUrl).toBe(second.photoUrl);
    expect(await t.db.select().from(deliveries).where(eq(deliveries.needId, need.id))).toHaveLength(2);
  });

  it("guards: not ordered → 409, foreign image host → 400, bad score → 400, other org → 404", async () => {
    const open = await seedNeed(t, orgId, { title: "Wipes", targetCents: 3000 });
    await expect(recordDelivery(check(open.id, false))).rejects.toMatchObject({ status: 409 });
    const need = await orderedNeed();
    await expect(
      recordDelivery({ ...check(need.id, false), photoUrl: "https://evil.example/x.jpg" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(recordDelivery({ ...check(need.id, false), matchScore: 1.5 })).rejects.toMatchObject({ status: 400 });

    const { delivery } = await recordDelivery(check(need.id, true));
    const other = await seedOrg(t, "second-chance-paws", "paws-demo-2026");
    await expect(confirmDelivery(delivery.id, other.id)).rejects.toMatchObject({ status: 404 });
    await expect(confirmDelivery("00000000-0000-4000-8000-000000000000", orgId)).rejects.toMatchObject({ status: 404 });
  });
});

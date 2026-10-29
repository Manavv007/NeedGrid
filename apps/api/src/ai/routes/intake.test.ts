import { ApiError, IntakeRes } from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { clearChannel3Cache, setChannel3Gateway } from "../../channel3";
import { FakeChannel3, fakeProduct } from "../../channel3/__fakes__";
import { hashStaffKey } from "../../lib/crypto";
import type { StaffOrg } from "../../plugins/staffAuth";
import { nextIp } from "../../test/fixtures";
import { featureOf, scriptedModel } from "../__fakes__";
import { setAiModels } from "../models";

const KEY = "harbor-demo-2026";
const org: StaffOrg = {
  id: "6f1c1d1e-2b3c-4d5e-8f90-123456789abc",
  slug: "harbor-food-bank",
  name: "Harbor Food Bank",
  city: "Portland, OR",
  description: "",
  causeTags: [],
  logoUrl: null,
};

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({
    logger: false,
    deps: { findOrgByStaffKeyHash: async (h) => (h === hashStaffKey(KEY) ? org : null) },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

afterEach(() => {
  setAiModels(null);
  setChannel3Gateway(null);
  clearChannel3Cache();
});

const post = (payload: unknown, headers: Record<string, string> = { "x-staff-key": KEY }) =>
  app.inject({
    method: "POST",
    url: "/api/staff/intake",
    headers: { ...headers, "x-forwarded-for": nextIp() },
    payload: payload as Record<string, unknown>,
  });

describe("POST /api/staff/intake", () => {
  it("401 without a staff key", async () => {
    const res = await post({ text: "diapers" }, {});
    expect(res.statusCode).toBe(401);
  });

  it("400 unless exactly one of imageUrl / text is sent", async () => {
    expect((await post({})).statusCode).toBe(400);
    expect((await post({ text: "a", imageUrl: "https://res.cloudinary.com/demo/image/upload/a.jpg" })).statusCode).toBe(
      400,
    );
  });

  it("503 UPSTREAM when the AI isn't configured (tests have no Gemini key)", async () => {
    const res = await post({ text: "300 diapers" });
    expect(res.statusCode).toBe(503);
    expect(ApiError.parse(res.json()).error).toMatchObject({ code: "UPSTREAM", message: "AI is not configured" });
  });

  it("200 with drafts matching IntakeRes", async () => {
    const fake = new FakeChannel3();
    fake.searchResults.set("pampers size 4 diapers", [fakeProduct()]);
    setChannel3Gateway(fake);
    setAiModels({
      language: scriptedModel((call) =>
        featureOf(call) === "intake"
          ? {
              items: [
                {
                  title: "Diapers, size 4",
                  quantity: 300,
                  unit: "diaper",
                  quantityIsLooseItems: true,
                  category: "baby",
                  urgency: 2,
                  notes: null,
                  searchQuery: "pampers size 4 diapers",
                  confidence: 0.9,
                },
              ],
              warnings: [],
            }
          : { items: [{ item: 0, rankings: [{ index: 0, fitScore: 0.95, fitReason: "Size 4, 150 per pack" }] }] },
      ),
    });
    const res = await post({ text: "300 size 4 diapers" });
    expect(res.statusCode).toBe(200);
    const body = IntakeRes.parse(res.json());
    expect(body.drafts[0]).toMatchObject({
      extracted: { quantity: 2, unit: "pack of 150" },
      suggestedTargetCents: 8400,
    });
  });

  it("400 for an image that isn't on our Cloudinary", async () => {
    setAiModels({ language: scriptedModel(() => ({ items: [], warnings: [] })) });
    const res = await post({ imageUrl: "https://evil.example/x.jpg" });
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).error.code).toBe("VALIDATION");
  });
});

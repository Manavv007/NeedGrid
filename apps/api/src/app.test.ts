import { ApiError, StaffMeRes } from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildApp } from "./app";
import { hashStaffKey } from "./lib/crypto";
import { HttpError } from "./lib/http";
import type { StaffOrg } from "./plugins/staffAuth";

const DEMO_KEY = "harbor-demo-2026";
const demoOrg: StaffOrg = {
  id: "6f1c1d1e-2b3c-4d5e-8f90-123456789abc",
  slug: "harbor-food-bank",
  name: "Harbor Food Bank",
  city: "Portland, OR",
  description: "Demo org",
  causeTags: ["food"],
  logoUrl: null,
};

let app: FastifyInstance;
let dbUp = true;

beforeAll(async () => {
  app = await buildApp({
    logger: false,
    deps: {
      pingDb: async () => dbUp,
      // In-memory lookup: tests never need a database.
      findOrgByStaffKeyHash: async (hash) => (hash === hashStaffKey(DEMO_KEY) ? demoOrg : null),
    },
  });
  // Test-only routes to exercise the error handler.
  app.post("/__test/zod", async (req) => z.object({ n: z.number() }).parse(req.body));
  app.get("/__test/http-error", async () => {
    throw new HttpError(409, "FULLY_FUNDED", "Already funded", { nextNeed: null });
  });
  app.get("/__test/crash", async () => {
    throw new Error("boom");
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("GET /api/health", () => {
  it("reports ok and db status", async () => {
    dbUp = true;
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: true });
    expect(res.headers["cache-control"]).toBe("no-store");
  });
  it("still answers when the database is down", async () => {
    dbUp = false;
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: false });
    dbUp = true;
  });
});

describe("staff auth (GET /api/staff/me)", () => {
  it("401 without a key, in the shared error shape", async () => {
    const res = await app.inject({ method: "GET", url: "/api/staff/me" });
    expect(res.statusCode).toBe(401);
    expect(ApiError.parse(res.json()).error.code).toBe("UNAUTHORIZED");
  });
  it("401 with a wrong key", async () => {
    const res = await app.inject({ method: "GET", url: "/api/staff/me", headers: { "x-staff-key": "nope" } });
    expect(res.statusCode).toBe(401);
    expect(ApiError.parse(res.json()).error.code).toBe("UNAUTHORIZED");
  });
  it("401 with an absurdly long key (no hashing of huge input)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/staff/me", headers: { "x-staff-key": "x".repeat(500) } });
    expect(res.statusCode).toBe(401);
  });
  it("200 with the demo key, response matches StaffMeRes", async () => {
    const res = await app.inject({ method: "GET", url: "/api/staff/me", headers: { "x-staff-key": DEMO_KEY } });
    expect(res.statusCode).toBe(200);
    expect(StaffMeRes.parse(res.json()).org.slug).toBe("harbor-food-bank");
  });
});

describe("error handler", () => {
  it("ZodError → 400 VALIDATION with issues", async () => {
    const res = await app.inject({ method: "POST", url: "/__test/zod", payload: { n: "x" } });
    expect(res.statusCode).toBe(400);
    const body = ApiError.parse(res.json());
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.details).toMatchObject({ issues: [{ path: ["n"] }] });
  });
  it("HttpError keeps its status, code and details", async () => {
    const res = await app.inject({ method: "GET", url: "/__test/http-error" });
    expect(res.statusCode).toBe(409);
    expect(ApiError.parse(res.json())).toEqual({
      error: { code: "FULLY_FUNDED", message: "Already funded", details: { nextNeed: null } },
    });
  });
  it("unknown errors → 500 INTERNAL", async () => {
    const res = await app.inject({ method: "GET", url: "/__test/crash" });
    expect(res.statusCode).toBe(500);
    expect(ApiError.parse(res.json()).error.code).toBe("INTERNAL");
  });
  it("malformed JSON → 400 VALIDATION", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/__test/zod",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).error.code).toBe("VALIDATION");
  });
  it("unknown route → 404 NOT_FOUND", async () => {
    const res = await app.inject({ method: "GET", url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(ApiError.parse(res.json()).error.code).toBe("NOT_FOUND");
  });
});

describe("CORS", () => {
  it("allows the configured web origin", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/staff/me",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET",
        "access-control-request-headers": "x-staff-key",
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(String(res.headers["access-control-allow-headers"])).toContain("x-staff-key");
  });
  it("does not allow other origins", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health", headers: { origin: "https://evil.example" } });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

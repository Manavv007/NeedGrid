import { describe, expect, it } from "vitest";
import { CreateOrderReq, IntakeReq, NeedCard, PatchNeedReq, paths } from "./index";

describe("contract smoke tests", () => {
  it("CreateOrderReq defaults rollOverConsent to true and enforces min/max", () => {
    const needId = "6f1c1d1e-2b3c-4d5e-8f90-123456789abc";
    expect(CreateOrderReq.parse({ needId, amountCents: 1400 }).rollOverConsent).toBe(true);
    expect(CreateOrderReq.safeParse({ needId, amountCents: 99 }).success).toBe(false);
    expect(CreateOrderReq.safeParse({ needId, amountCents: 100_001 }).success).toBe(false);
    expect(CreateOrderReq.safeParse({ needId, amountCents: 10.5 }).success).toBe(false);
  });

  it("IntakeReq requires exactly one of imageUrl or text", () => {
    expect(IntakeReq.safeParse({ text: "10 packs of diapers" }).success).toBe(true);
    expect(IntakeReq.safeParse({}).success).toBe(false);
    expect(
      IntakeReq.safeParse({ text: "x", imageUrl: "https://res.cloudinary.com/demo/image/upload/a.jpg" }).success,
    ).toBe(false);
  });

  it("PatchNeedReq is fully partial", () => {
    expect(PatchNeedReq.parse({})).toEqual({});
    expect(PatchNeedReq.parse({ urgency: 3 })).toEqual({ urgency: 3 });
  });

  it("NeedCard rejects float money", () => {
    const base = {
      id: "6f1c1d1e-2b3c-4d5e-8f90-123456789abc",
      orgId: "6f1c1d1e-2b3c-4d5e-8f90-123456789abd",
      orgSlug: "harbor-food-bank",
      title: "Diapers, size 4",
      description: "",
      category: "baby",
      urgency: 3,
      quantity: 2,
      unit: "pack of 150",
      status: "open",
      targetCents: 8400,
      fundedCents: 7000,
      heldCents: 0,
      remainingCents: 1400,
      donorCount: 5,
      product: null,
      deadlineAt: null,
      createdAt: "2026-10-27T00:00:00.000Z",
      updatedAt: "2026-10-27T00:00:00.000Z",
    };
    expect(NeedCard.safeParse(base).success).toBe(true);
    expect(NeedCard.safeParse({ ...base, fundedCents: 70.5 }).success).toBe(false);
  });

  it("paths encode user input", () => {
    expect(paths.org("a b")).toBe("/api/orgs/a%20b");
    expect(paths.staff.approveAction("x")).toBe("/api/staff/agent/actions/x/approve");
  });
});

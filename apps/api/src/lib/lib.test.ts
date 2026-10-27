import { describe, expect, it } from "vitest";
import { hashStaffKey, safeEqualHex } from "./crypto";
import { assertCloudinaryUrl, HttpError } from "./http";

describe("hashStaffKey", () => {
  it("is lowercase SHA-256 hex of the UTF-8 passcode (B's seed must match)", () => {
    expect(hashStaffKey("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashStaffKey("harbor-demo-2026")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("safeEqualHex compares digests", () => {
    const h = hashStaffKey("x");
    expect(safeEqualHex(h, h)).toBe(true);
    expect(safeEqualHex(h, hashStaffKey("y"))).toBe(false);
    expect(safeEqualHex(h, "")).toBe(false);
  });
});

describe("assertCloudinaryUrl (CLOUDINARY_CLOUD_NAME=demo in tests)", () => {
  it("accepts our cloud", () => {
    expect(() => assertCloudinaryUrl("https://res.cloudinary.com/demo/image/upload/v1/needgrid/a.jpg")).not.toThrow();
  });
  it.each([
    "http://res.cloudinary.com/demo/image/upload/a.jpg", // not https
    "https://res.cloudinary.com/other/image/upload/a.jpg", // other cloud
    "https://res.cloudinary.com.evil.com/demo/a.jpg", // lookalike host
    "https://user:pw@res.cloudinary.com/demo/a.jpg", // credentials
    "https://169.254.169.254/latest/meta-data", // SSRF target
    "not a url",
  ])("rejects %s", (url) => {
    expect(() => assertCloudinaryUrl(url)).toThrow(HttpError);
  });
});

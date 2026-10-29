import { describe, expect, it } from "vitest";
import { parseEnv } from "@/env";

describe("parseEnv", () => {
  it("parses a full config and trims the API URL's trailing slash", () => {
    const res = parseEnv({
      VITE_API_URL: "https://needgrid-api.onrender.com/",
      VITE_USE_MOCKS: "false",
      VITE_PAYPAL_CLIENT_ID: "sb-client",
      VITE_CLOUDINARY_CLOUD_NAME: "demo",
      VITE_CLOUDINARY_UPLOAD_PRESET: "needgrid",
      VITE_DEMO_STAFF_KEY: "harbor-demo-2026",
    });
    expect(res).toEqual({
      ok: true,
      env: {
        VITE_API_URL: "https://needgrid-api.onrender.com",
        VITE_USE_MOCKS: false,
        VITE_PAYPAL_CLIENT_ID: "sb-client",
        VITE_CLOUDINARY_CLOUD_NAME: "demo",
        VITE_CLOUDINARY_UPLOAD_PRESET: "needgrid",
        VITE_DEMO_STAFF_KEY: "harbor-demo-2026",
      },
    });
  });

  it("boots in mock mode with PayPal, Cloudinary and the API URL empty", () => {
    const res = parseEnv({
      VITE_USE_MOCKS: "true",
      VITE_API_URL: "",
      VITE_PAYPAL_CLIENT_ID: "",
      VITE_CLOUDINARY_CLOUD_NAME: " ",
    });
    expect(res.ok).toBe(true);
    expect(res.env).toMatchObject({ VITE_USE_MOCKS: true, VITE_API_URL: null, VITE_PAYPAL_CLIENT_ID: null });
  });

  it("defaults VITE_USE_MOCKS to false", () => {
    expect(parseEnv({ VITE_API_URL: "http://localhost:3000" }).env.VITE_USE_MOCKS).toBe(false);
  });

  it("reports a missing API URL when mocks are off", () => {
    const res = parseEnv({ VITE_USE_MOCKS: "false" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.problems.join(" ")).toMatch(/VITE_API_URL is missing/);
  });

  it("rejects a non-http API URL and a non-boolean mocks flag", () => {
    const res = parseEnv({ VITE_API_URL: "javascript:alert(1)", VITE_USE_MOCKS: "yes" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.problems.some((p) => p.startsWith("VITE_API_URL"))).toBe(true);
      expect(res.problems.some((p) => p.startsWith("VITE_USE_MOCKS"))).toBe(true);
      expect(res.env.VITE_USE_MOCKS).toBe(false);
    }
  });
});

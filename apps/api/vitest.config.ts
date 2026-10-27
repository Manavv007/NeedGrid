import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // Tests must never need real keys. Minimal env so env.ts parses.
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgres://test:test@localhost:5432/needgrid_test",
      PAYPAL_ENV: "sandbox",
      PAYPAL_CLIENT_ID: "test-client-id",
      PAYPAL_CLIENT_SECRET: "test-client-secret",
      WEB_ORIGIN: "http://localhost:5173",
      CLOUDINARY_CLOUD_NAME: "demo",
      LOG_LEVEL: "silent",
    },
  },
});

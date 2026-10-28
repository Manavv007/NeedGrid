import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.{ts,tsx}"],
      setupFiles: ["./src/test/setup.ts"],
      css: false,
      // Tests never use the browser worker or a real API: MSW's node server answers this fake origin.
      env: {
        VITE_API_URL: "http://api.test",
        VITE_USE_MOCKS: "false",
        VITE_DEMO_STAFF_KEY: "harbor-demo-2026",
      },
    },
  }),
);

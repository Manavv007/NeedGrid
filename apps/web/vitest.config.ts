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
      // Route tests render the whole app with MSW and jsdom; with many workers on a Windows laptop the
      // first test in a file (and the long intake flows) can pass 5 s, so allow more before failing.
      testTimeout: 20_000,
      // Each jsdom worker needs a few hundred MB. With one per core (the default), a laptop with ~1 GB
      // free started swapping: the run took 250 s and timing-sensitive tests failed. Half the cores ran
      // it green in 150 s (C-8). A 4-core CI runner still gets 2 workers.
      maxWorkers: "50%",
      // Tests never use the browser worker or a real API: MSW's node server answers this fake origin.
      env: {
        VITE_API_URL: "http://api.test",
        VITE_USE_MOCKS: "false",
        VITE_DEMO_STAFF_KEY: "harbor-demo-2026",
      },
    },
  }),
);

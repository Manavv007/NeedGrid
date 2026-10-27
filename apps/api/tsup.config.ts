import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // @needgrid/shared is TypeScript source, so it must be bundled into the server build.
  noExternal: ["@needgrid/shared"],
});

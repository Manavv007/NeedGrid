import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// No dev proxy: the app always calls VITE_API_URL directly (the API allows http://localhost:5173 via CORS).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks cache well between deploys and keep every chunk under 500 kB.
        codeSplitting: {
          groups: [
            { name: "react-vendor", test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/ },
            { name: "data-vendor", test: /node_modules[\\/](zod|@tanstack)[\\/]/ },
          ],
        },
      },
    },
  },
});

import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyInstance {
    /** True when `origin` may call the API from a browser. Used by hijacked (SSE/NDJSON) responses. */
    isAllowedOrigin: (origin: string) => boolean;
  }
}

export const corsPlugin = fp(
  async (app: FastifyInstance, opts: { origins: string[] }) => {
    const allowed = new Set(opts.origins);
    app.decorate("isAllowedOrigin", (origin: string) => allowed.has(origin));
    await app.register(cors, {
      // No origin header = server-to-server (PayPal webhooks, curl, health checks): allowed, no CORS headers needed.
      origin: (origin, cb) => cb(null, !origin || allowed.has(origin)),
      methods: ["GET", "POST", "PATCH", "OPTIONS"],
      allowedHeaders: ["content-type", "x-staff-key"],
      maxAge: 600,
    });
  },
  { name: "needgrid-cors" },
);

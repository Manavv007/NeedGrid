import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { HttpError } from "../lib/http";

/**
 * Rate limiting is opt-in per route (global: false). Usage on a route:
 *   app.post("/api/match", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, handler)
 * Keys on req.ip, which is the real client IP because the app is created with trustProxy: true.
 */
export const rateLimitPlugin = fp(
  async (app: FastifyInstance) => {
    await app.register(rateLimit, {
      global: false,
      errorResponseBuilder: (_req, ctx) =>
        new HttpError(429, "RATE_LIMITED", `Too many requests. Try again in ${ctx.after}.`, { retryAfter: ctx.after }),
    });
  },
  { name: "needgrid-rate-limit" },
);

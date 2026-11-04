import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

/**
 * Small, JSON-API-appropriate response headers (AGENT_A_BACKEND.md §8.10):
 * - nosniff, no framing, no referrer leaks
 * - staff responses are never cached by browsers or proxies (they hold donor and sponsor details)
 * Hijacked responses (SSE / NDJSON) set their own headers and skip onSend.
 */
export const securityHeadersPlugin = fp(
  async (app: FastifyInstance) => {
    app.addHook("onSend", async (req, reply, payload) => {
      reply.header("x-content-type-options", "nosniff");
      reply.header("x-frame-options", "DENY");
      reply.header("referrer-policy", "no-referrer");
      if (req.url.startsWith("/api/staff/") && !reply.hasHeader("cache-control")) {
        reply.header("cache-control", "no-store");
      }
      return payload;
    });
  },
  { name: "needgrid-security-headers" },
);

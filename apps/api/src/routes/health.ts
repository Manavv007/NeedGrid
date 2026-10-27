import { paths } from "@needgrid/shared";
import type { FastifyInstance } from "fastify";

/** GET /api/health → { ok: true, db: boolean }. Render's health check and the uptime monitor hit this. */
export async function healthRoutes(app: FastifyInstance, opts: { pingDb: () => Promise<boolean> }) {
  app.get(paths.health, async (_req, reply) => {
    reply.header("cache-control", "no-store");
    return { ok: true as const, db: await opts.pingDb() };
  });
}

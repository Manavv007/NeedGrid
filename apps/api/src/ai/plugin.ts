// OWNER: B (AI & Data). A registers this plugin once in app.ts (after CORS, rate-limit and staff auth)
// and never edits it. Use `preHandler: app.requireStaff` + getStaffOrg(req) for staff routes and
// `config: { rateLimit: { max, timeWindow } }` for rate limits.
import type { FastifyPluginAsync } from "fastify";

export const aiPlugin: FastifyPluginAsync = async (_app) => {
  // B registers: POST /api/staff/intake, POST /api/staff/needs/:id/purchase-plan, POST /api/staff/needs/:id/delivery,
  // POST /api/staff/deliveries/:id/confirm, POST /api/staff/agent/chat, POST /api/match,
  // GET /api/dashboard/datasets/:name, POST /api/ai/dashboard-complete
};

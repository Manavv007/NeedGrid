// OWNER: B (AI & Data). A registers this plugin once in app.ts (after CORS, rate-limit and staff auth)
// and never edits it. Staff routes use `preHandler: app.requireStaff` + getStaffOrg(req);
// rate limits use `config: { rateLimit: { max, timeWindow } }`.
import type { FastifyPluginAsync } from "fastify";
import { dashboardRoutes } from "./routes/dashboard";
import { dashboardAiRoutes } from "./routes/dashboardAi";
import { intakeRoutes } from "./routes/intake";

export const aiPlugin: FastifyPluginAsync = async (app) => {
  await app.register(intakeRoutes);
  await app.register(dashboardRoutes);
  await app.register(dashboardAiRoutes);
  // Still to come: POST /api/staff/needs/:id/purchase-plan, POST /api/staff/needs/:id/delivery,
  // POST /api/staff/deliveries/:id/confirm, POST /api/staff/agent/chat, POST /api/match
};

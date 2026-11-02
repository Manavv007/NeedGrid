// OWNER: B (AI & Data). A registers this plugin once in app.ts (after CORS, rate-limit and staff auth)
// and never edits it. Staff routes use `preHandler: app.requireStaff` + getStaffOrg(req);
// rate limits use `config: { rateLimit: { max, timeWindow } }`.
import type { FastifyPluginAsync } from "fastify";
import { assistantRoutes } from "./routes/assistant";
import { dashboardRoutes } from "./routes/dashboard";
import { dashboardAiRoutes } from "./routes/dashboardAi";
import { deliveryRoutes } from "./routes/delivery";
import { intakeRoutes } from "./routes/intake";
import { matchRoutes } from "./routes/match";
import { purchasePlanRoutes } from "./routes/purchasePlan";

export const aiPlugin: FastifyPluginAsync = async (app) => {
  await app.register(intakeRoutes);
  await app.register(purchasePlanRoutes);
  await app.register(deliveryRoutes);
  await app.register(assistantRoutes);
  await app.register(matchRoutes);
  await app.register(dashboardRoutes);
  await app.register(dashboardAiRoutes);
};

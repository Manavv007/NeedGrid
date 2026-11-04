import { AGENT_ACTION_STATUSES, AgentActionListRes, paths } from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listAgentActions } from "../agent/actions";
import { getStaffOrg } from "../plugins/staffAuth";

const ListQuery = z.object({ status: z.enum(AGENT_ACTION_STATUSES).optional() });

/** GET /api/staff/agent/actions?status= — this org's money actions, newest first (max 100). Approve/reject: Phase 8. */
export async function actionRoutes(app: FastifyInstance) {
  app.get(paths.staff.actions, { preHandler: app.requireStaff }, async (req) => {
    const { status } = ListQuery.parse(req.query);
    return AgentActionListRes.parse({ actions: await listAgentActions(getStaffOrg(req).id, status) });
  });
}

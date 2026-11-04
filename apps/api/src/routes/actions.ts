import { AGENT_ACTION_STATUSES, AgentActionListRes, AgentActionRes, Id, paths } from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listAgentActions } from "../agent/actions";
import { approveAction, rejectAction } from "../agent/executors";
import { notFound } from "../lib/http";
import { getStaffOrg } from "../plugins/staffAuth";

const ListQuery = z.object({ status: z.enum(AGENT_ACTION_STATUSES).optional() });

const actionId = (params: unknown) => {
  const id = Id.safeParse((params as { id?: unknown }).id);
  if (!id.success) throw notFound("Action");
  return id.data;
};

/**
 * GET  /api/staff/agent/actions?status=     this org's money actions, newest first (max 100)
 * POST /api/staff/agent/actions/:id/approve  runs the stored action (no body is read); returns the final action
 * POST /api/staff/agent/actions/:id/reject   discards it; nothing runs
 */
export async function actionRoutes(app: FastifyInstance) {
  app.get(paths.staff.actions, { preHandler: app.requireStaff }, async (req) => {
    const { status } = ListQuery.parse(req.query);
    return AgentActionListRes.parse({ actions: await listAgentActions(getStaffOrg(req).id, status) });
  });

  const decide = { preHandler: app.requireStaff, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };

  app.post(paths.staff.approveAction(":id"), decide, async (req) =>
    AgentActionRes.parse({ action: await approveAction(getStaffOrg(req).id, actionId(req.params)) }),
  );

  app.post(paths.staff.rejectAction(":id"), decide, async (req) =>
    AgentActionRes.parse({ action: await rejectAction(getStaffOrg(req).id, actionId(req.params)) }),
  );
}

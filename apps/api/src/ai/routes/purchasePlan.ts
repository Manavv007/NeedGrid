import { Id, paths } from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { getStaffOrg } from "../../plugins/staffAuth";
import { notFound } from "../../lib/http";
import { planPurchase } from "../purchasePlan";

/** POST /api/staff/needs/:id/purchase-plan (staff, 10/min). Body `{}`. Proposes a purchase; staff approve it (A's route). */
export async function purchasePlanRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>(
    paths.staff.purchasePlan(":id"),
    { preHandler: app.requireStaff, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req) => {
      const org = getStaffOrg(req);
      const id = Id.safeParse(req.params.id);
      if (!id.success) throw notFound("Need");
      return planPurchase(id.data, org.id);
    },
  );
}

import { Id, MarkOrderedReq, paths } from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { notFound } from "../lib/http";
import { approvePurchase, markPurchaseOrdered } from "../money/purchases";
import { getStaffOrg } from "../plugins/staffAuth";

/** Staff purchase actions. Proposals come from B's purchase-plan route. */
export async function purchaseRoutes(app: FastifyInstance) {
  const opts = { preHandler: app.requireStaff, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };

  const purchaseId = (params: unknown) => {
    const id = Id.safeParse((params as { id?: unknown }).id);
    if (!id.success) throw notFound("Purchase");
    return id.data;
  };

  app.post(paths.staff.approvePurchase(":id"), opts, async (req) =>
    approvePurchase(getStaffOrg(req).id, purchaseId(req.params)),
  );

  app.post(paths.staff.markOrdered(":id"), opts, async (req) => {
    const { orderRef } = MarkOrderedReq.parse(req.body ?? {});
    return markPurchaseOrdered(getStaffOrg(req).id, purchaseId(req.params), orderRef);
  });
}

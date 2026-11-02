import { ConfirmDeliveryReq, DELIVERY_MATCH_THRESHOLD, DeliveryReq, DeliveryRes, Id, paths } from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import * as core from "../../core";
import { assertCloudinaryUrl, invalidState, notFound } from "../../lib/http";
import { getStaffOrg } from "../../plugins/staffAuth";
import { checkDeliveryPhoto, writeImpactNote } from "../delivery";

/**
 * POST /api/staff/needs/:id/delivery (staff, 10/min): arrival photo → vision check → delivery row.
 * Below DELIVERY_MATCH_THRESHOLD, or when the check didn't run, the delivery needs review: never auto-approved.
 * POST /api/staff/deliveries/:id/confirm (staff, 30/min): staff approve a delivery that needed review.
 */
export async function deliveryRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>(
    paths.staff.delivery(":id"),
    { preHandler: app.requireStaff, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req) => {
      const org = getStaffOrg(req);
      const id = Id.safeParse(req.params.id);
      if (!id.success) throw notFound("Need");
      const body = DeliveryReq.parse(req.body ?? {});
      assertCloudinaryUrl(body.photoUrl);

      const need = await core.getNeedCard(id.data);
      // Another org's need answers 404, not 403: staff can't probe other orgs' ids.
      if (!need || need.orgId !== org.id) throw notFound("Need");
      if (need.status !== "ordered") {
        throw invalidState(`Only an ordered need can be marked delivered (this one is ${need.status})`);
      }

      const staffNote = body.staffNote.trim();
      const [check, message] = await Promise.all([
        checkDeliveryPhoto(body.photoUrl, {
          title: need.product?.title ?? need.title,
          quantity: need.quantity,
          unit: need.unit,
          imageUrl: need.product?.imageUrl ?? null,
        }),
        staffNote ? writeImpactNote(staffNote, need.title) : Promise.resolve(null),
      ]);

      const res = await core.recordDelivery({
        needId: need.id,
        photoUrl: body.photoUrl,
        matchScore: check.matchScore,
        aiNotes: check.notes,
        needsReview: !check.checked || check.matchScore < DELIVERY_MATCH_THRESHOLD,
        message,
      });
      return DeliveryRes.parse(res);
    },
  );

  app.post<{ Params: { id: string } }>(
    paths.staff.confirmDelivery(":id"),
    { preHandler: app.requireStaff, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req) => {
      const org = getStaffOrg(req);
      const id = Id.safeParse(req.params.id);
      if (!id.success) throw notFound("Delivery");
      const body = ConfirmDeliveryReq.parse(req.body ?? {});
      // undefined = keep the message as it is; "" = no donor message (core stores null; HANDOFF to A, Nov 1).
      const message = body.message === undefined ? undefined : body.message.trim();
      return DeliveryRes.parse(await core.confirmDelivery(id.data, org.id, message));
    },
  );
}

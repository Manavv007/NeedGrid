import {
  NeedRes,
  NeedStatus,
  PatchNeedReq,
  paths,
  PublishNeedReq,
  StaffMeRes,
  StaffNeedDetailRes,
  StaffNeedListRes,
} from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createNeed, getStaffNeedDetail, listStaffNeeds, patchNeed } from "../core/needs";
import { notFound } from "../lib/http";
import { getStaffOrg } from "../plugins/staffAuth";

const ListQuery = z.object({ status: NeedStatus.optional() });
const IdParams = z.object({ id: z.string() });

function needIdFrom(params: unknown): string {
  const { id } = IdParams.parse(params);
  if (!z.uuid().safeParse(id).success) throw notFound("Need");
  return id;
}

/** Staff routes owned by A. Every route acts only on the caller's own organization. */
export async function staffRoutes(app: FastifyInstance) {
  const staff = { preHandler: app.requireStaff };

  app.get(paths.staff.me, staff, async (req) => {
    const org = getStaffOrg(req);
    return StaffMeRes.parse({
      org: {
        id: org.id,
        slug: org.slug,
        name: org.name,
        city: org.city,
        description: org.description,
        causeTags: org.causeTags,
        logoUrl: org.logoUrl,
      },
    });
  });

  app.get(paths.staff.needs, staff, async (req) => {
    const { status } = ListQuery.parse(req.query);
    return StaffNeedListRes.parse({ needs: await listStaffNeeds(getStaffOrg(req).id, status) });
  });

  app.get("/api/staff/needs/:id", staff, async (req) => {
    return StaffNeedDetailRes.parse(await getStaffNeedDetail(getStaffOrg(req).id, needIdFrom(req.params)));
  });

  app.post(paths.staff.needs, staff, async (req, reply) => {
    const body = PublishNeedReq.parse(req.body);
    const need = await createNeed(getStaffOrg(req).id, body);
    return reply.status(201).send(NeedRes.parse({ need }));
  });

  app.patch("/api/staff/needs/:id", staff, async (req) => {
    const body = PatchNeedReq.parse(req.body ?? {});
    return NeedRes.parse({ need: await patchNeed(getStaffOrg(req).id, needIdFrom(req.params), body) });
  });
}

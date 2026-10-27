import { paths, StaffMeRes } from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { getStaffOrg } from "../plugins/staffAuth";

/** Staff routes owned by A. More arrive in Phase 2 (needs list/detail, publish, patch). */
export async function staffRoutes(app: FastifyInstance) {
  app.get(paths.staff.me, { preHandler: app.requireStaff }, async (req) => {
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
}

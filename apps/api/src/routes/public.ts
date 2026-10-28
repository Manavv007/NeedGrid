import { NeedDetailRes, OrgListRes, OrgPageRes, paths } from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getOrgPage, getPublicNeedDetail, listOrgSummaries } from "../core/needs";
import { notFound } from "../lib/http";

const SlugParams = z.object({ slug: z.string().min(1).max(100) });
const IdParams = z.object({ id: z.string() });

/** Public read endpoints (no auth). Responses never include personal data. */
export async function publicRoutes(app: FastifyInstance) {
  app.get(paths.orgs, async () => OrgListRes.parse({ orgs: await listOrgSummaries() }));

  app.get("/api/orgs/:slug", async (req) => {
    const { slug } = SlugParams.parse(req.params);
    return OrgPageRes.parse(await getOrgPage(slug));
  });

  app.get("/api/needs/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    // A malformed id is simply "not found" (and never reaches Postgres as an invalid uuid).
    if (!z.uuid().safeParse(id).success) throw notFound("Need");
    return NeedDetailRes.parse(await getPublicNeedDetail(id));
  });
}

import { DATASETS, DatasetRes, paths, type DatasetName } from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { notFound } from "../../lib/http";
import { getDataset } from "../datasets";

const isDataset = (n: string): n is DatasetName => (DATASETS as readonly string[]).includes(n);

/** GET /api/dashboard/datasets/:name (public). Flat no-personal-data tables for AG Studio. */
export async function dashboardRoutes(app: FastifyInstance) {
  app.get<{ Params: { name: string } }>(
    paths.dataset(":name"),
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { name } = req.params;
      if (!isDataset(name)) throw notFound("Dataset");
      const res = DatasetRes.parse(await getDataset(name));
      // Data is at most 60 s old on the server anyway; let browsers and proxies reuse it for as long.
      reply.header("cache-control", "public, max-age=60");
      return res;
    },
  );
}

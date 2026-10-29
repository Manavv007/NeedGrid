import { IntakeReq, IntakeRes, paths } from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { HttpError } from "../../lib/http";
import { runIntake } from "../intake";
import { AI_NOT_CONFIGURED, isAiConfigured } from "../models";

/** POST /api/staff/intake (staff, 10/min). Photo or text → drafts. Nothing is saved. */
export async function intakeRoutes(app: FastifyInstance) {
  app.post(
    paths.staff.intake,
    { preHandler: app.requireStaff, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req) => {
      const body = IntakeReq.parse(req.body ?? {});
      if (!isAiConfigured()) throw new HttpError(503, "UPSTREAM", AI_NOT_CONFIGURED);
      return IntakeRes.parse(await runIntake(body));
    },
  );
}

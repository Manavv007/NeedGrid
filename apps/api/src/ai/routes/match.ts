import { MatchReq, MatchRes, paths } from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { takeDailyBudget } from "../dailyCap";
import { matchNeeds } from "../match";

/**
 * POST /api/match (public, 10/min per IP, DAILY_CAPS.match per Pacific day). Works without an AI key too (keyword
 * ranking + plain reasons), so it never answers 503 "not configured"; it does answer 503 "resting" at the daily cap.
 */
export async function matchRoutes(app: FastifyInstance) {
  app.post(paths.match, { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const body = MatchReq.parse(req.body ?? {});
    takeDailyBudget("match");
    return MatchRes.parse(await matchNeeds(body));
  });
}

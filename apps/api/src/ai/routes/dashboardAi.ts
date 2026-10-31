import { paths } from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { HttpError } from "../../lib/http";
import { DAILY_CAPS, takeDailyBudget } from "../dailyCap";
import { RelayReq, runDashboardTurn } from "../dashboardRelay";
import { AI_NOT_CONFIGURED, isAiConfigured } from "../models";

/** Studio's turn requests carry its instructions and tool schemas: allow up to 200 KB, reject more (§10.3). */
export const RELAY_BODY_LIMIT = 200 * 1024;

/**
 * POST /api/ai/dashboard-complete (public, 20/min per IP, 300/day in total): one AG Studio AI turn.
 * GET  /api/ai/dashboard-complete: { enabled } so the dashboard can hide the chat when the AI is off (§10.4).
 */
export async function dashboardAiRoutes(app: FastifyInstance) {
  app.get(paths.dashboardComplete, async (_req, reply) => {
    reply.header("cache-control", "no-store");
    return { enabled: isAiConfigured(), dailyLimit: DAILY_CAPS.dashboard };
  });

  app.post(
    paths.dashboardComplete,
    { bodyLimit: RELAY_BODY_LIMIT, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!isAiConfigured()) throw new HttpError(503, "UPSTREAM", AI_NOT_CONFIGURED);
      const body = RelayReq.parse(req.body ?? {});
      takeDailyBudget("dashboard");
      // Cancel the Gemini call when the reader stops the chat (the browser aborts the fetch).
      const abort = new AbortController();
      req.raw.on("close", () => {
        if (!reply.raw.writableEnded) abort.abort();
      });
      reply.header("cache-control", "no-store");
      return runDashboardTurn(body, abort.signal);
    },
  );
}

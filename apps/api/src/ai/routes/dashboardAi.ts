import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { paths } from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { env } from "../../env";
import { HttpError } from "../../lib/http";
import { DAILY_CAPS, takeDailyBudget } from "../dailyCap";
import { RelayReq, runDashboardTurn } from "../dashboardRelay";
import { AI_NOT_CONFIGURED, CallCancelled, isAiConfigured } from "../models";

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
      // Cancel the Gemini call when the reader stops the chat (the browser aborts the fetch). Listen on the
      // RESPONSE: on Node 24 the request's own "close" fires as soon as its body has been read, which would
      // cancel every turn at once.
      const abort = new AbortController();
      reply.raw.on("close", () => {
        if (!reply.raw.writableEnded) abort.abort();
      });
      reply.header("cache-control", "no-store");
      try {
        return await runDashboardTurn(body, abort.signal);
      } catch (err) {
        // The reader cancelled: nobody is waiting for an answer, and it isn't a failure.
        if (err instanceof CallCancelled) return reply.code(499).send();
        if (env.NODE_ENV === "development") saveFailedTurn(body);
        throw err;
      }
    },
  );
}

/**
 * Development only: keep the last failed turn so it can be replayed offline (scripts/replay-dashboard-turn).
 * The dashboard has no personal data, so the body is safe to write to the temp folder. Never in production.
 */
export const FAILED_TURN_FILE = path.join(os.tmpdir(), "needgrid-dashboard-failed-turn.json");
function saveFailedTurn(body: unknown) {
  try {
    writeFileSync(FAILED_TURN_FILE, JSON.stringify(body));
    console.warn(`[ai] dashboard turn failed; request saved to ${FAILED_TURN_FILE} (dev only)`);
  } catch {
    /* ignore */
  }
}

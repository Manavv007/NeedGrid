import { AgentChatReq, paths } from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { HttpError, sendNdjson } from "../../lib/http";
import { getStaffOrg } from "../../plugins/staffAuth";
import { runAssistantChat } from "../assistant/chat";
import { AI_NOT_CONFIGURED, isAiConfigured } from "../models";

/** POST /api/staff/agent/chat (staff, 20/min): NDJSON, one AgentStreamEvent per line, always ending with `done`. */
export async function assistantRoutes(app: FastifyInstance) {
  app.post(
    paths.staff.agentChat,
    { preHandler: app.requireStaff, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const org = getStaffOrg(req);
      // Validation and configuration errors are normal JSON errors, before the stream starts.
      const body = AgentChatReq.parse(req.body ?? {});
      if (body.messages.at(-1)?.role !== "user") {
        throw new HttpError(400, "VALIDATION", "The last message must be from staff");
      }
      if (!isAiConfigured()) throw new HttpError(503, "UPSTREAM", AI_NOT_CONFIGURED);

      // Stop the model when the browser goes away. reply.raw, not req.raw: Node 24 emits the request's "close"
      // as soon as its body has been read (NOTES §16).
      const abort = new AbortController();
      reply.raw.on("close", () => {
        if (!reply.raw.writableEnded) abort.abort();
      });
      const stream = sendNdjson(reply);
      try {
        await runAssistantChat({ org, messages: body.messages, write: stream.write, signal: abort.signal });
      } finally {
        stream.end();
      }
    },
  );
}

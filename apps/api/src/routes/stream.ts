/**
 * GET /api/orgs/:slug/stream: Server-Sent Events, event `need.updated`, data = NeedCard JSON.
 * One API instance, so updates fan out in-process (lib/events.ts).
 */
import { NEED_UPDATED_EVENT } from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { findOrgIdBySlug } from "../core/orgs";
import { onNeedUpdated } from "../lib/events";
import { notFound } from "../lib/http";

const SlugParams = z.object({ slug: z.string().min(1).max(100) });

export async function streamRoutes(app: FastifyInstance, opts: { pingMs?: number } = {}) {
  const pingMs = opts.pingMs ?? 25_000;
  const open = new Set<() => void>();
  // End every stream when shutdown starts. Must be preClose: onClose only runs after in-flight
  // requests finish, and an open stream never finishes, so app.close() would hang forever.
  app.addHook("preClose", async () => {
    for (const close of [...open]) close();
  });

  app.get("/api/orgs/:slug/stream", async (req, reply) => {
    const { slug } = SlugParams.parse(req.params);
    if (!(await findOrgIdBySlug(slug))) throw notFound("Charity");

    reply.hijack(); // we own the socket from here; Fastify (and @fastify/cors) won't touch the response
    const raw = reply.raw;
    const origin = req.headers.origin;
    raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      ...(origin && app.isAllowedOrigin(origin) ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
    });
    raw.write("retry: 3000\n\n");

    const off = onNeedUpdated(slug, (card) => {
      raw.write(`event: ${NEED_UPDATED_EVENT}\ndata: ${JSON.stringify(card)}\n\n`);
    });
    const ping = setInterval(() => raw.write(": ping\n\n"), pingMs);
    const close = () => {
      if (!open.delete(close)) return;
      clearInterval(ping);
      off();
      if (!raw.writableEnded) raw.end();
    };
    open.add(close);
    req.raw.on("close", close);
  });
}

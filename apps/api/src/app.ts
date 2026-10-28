import Fastify, { type FastifyInstance } from "fastify";
import { aiPlugin } from "./ai/plugin";
import { findOrgByStaffKeyHash } from "./core/orgs";
import { pingDb } from "./db/client";
import { allowedOrigins, env } from "./env";
import { corsPlugin } from "./plugins/cors";
import { errorHandlerPlugin } from "./plugins/errorHandler";
import { rateLimitPlugin } from "./plugins/rateLimit";
import { staffAuthPlugin, type FindOrgByStaffKeyHash } from "./plugins/staffAuth";
import { healthRoutes } from "./routes/health";
import { donationRoutes } from "./routes/donations";
import { publicRoutes } from "./routes/public";
import { staffRoutes } from "./routes/staff";
import { streamRoutes } from "./routes/stream";

export interface BuildAppOptions {
  /** Pino logger on/off (tests pass false). */
  logger?: boolean;
  /** SSE heartbeat interval (tests shorten it). */
  ssePingMs?: number;
  /** Injectable dependencies so tests run without a database. */
  deps?: {
    pingDb?: () => Promise<boolean>;
    findOrgByStaffKeyHash?: FindOrgByStaffKeyHash;
  };
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const isDev = env.NODE_ENV === "development";
  const app = Fastify({
    trustProxy: true, // Render sits behind a proxy; rate limits must see the real client IP.
    bodyLimit: 1_048_576, // 1 MB
    logger:
      opts.logger === false
        ? false
        : {
            level: env.LOG_LEVEL,
            redact: {
              paths: [
                'req.headers["x-staff-key"]',
                "req.headers.authorization",
                'req.headers["paypal-transmission-sig"]',
                'req.headers["paypal-cert-url"]',
                'req.headers["paypal-auth-algo"]',
              ],
              censor: "[redacted]",
            },
            ...(isDev ? { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } } } : {}),
          },
  });

  // Order matters: B's aiPlugin relies on CORS, rate-limit and staff auth already being registered.
  await app.register(errorHandlerPlugin, { exposeInternalErrors: env.NODE_ENV !== "production" });
  await app.register(corsPlugin, { origins: allowedOrigins });
  await app.register(rateLimitPlugin);
  await app.register(staffAuthPlugin, {
    findOrgByStaffKeyHash: opts.deps?.findOrgByStaffKeyHash ?? findOrgByStaffKeyHash,
  });

  await app.register(healthRoutes, { pingDb: opts.deps?.pingDb ?? (() => pingDb()) });
  await app.register(publicRoutes);
  await app.register(streamRoutes, { pingMs: opts.ssePingMs });
  await app.register(donationRoutes);
  await app.register(staffRoutes);
  await app.register(aiPlugin);

  return app;
}

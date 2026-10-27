import type { ApiError, ErrorCode } from "@needgrid/shared";
import type { FastifyError, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { ZodError } from "zod";
import { HttpError } from "../lib/http";

function body(code: ErrorCode, message: string, details?: unknown): ApiError {
  return details === undefined ? { error: { code, message } } : { error: { code, message, details } };
}

/** Every non-2xx JSON response uses the shared ApiError shape. */
export const errorHandlerPlugin = fp(
  async (app: FastifyInstance, opts: { exposeInternalErrors: boolean }) => {
    app.setErrorHandler((err: FastifyError | HttpError | ZodError | Error, req, reply) => {
      if (err instanceof HttpError) {
        if (err.status >= 500) req.log.error({ err }, err.message);
        return reply.status(err.status).send(body(err.code, err.message, err.details));
      }
      if (err instanceof ZodError) {
        return reply.status(400).send(
          body("VALIDATION", "Request is invalid", {
            issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
          }),
        );
      }
      const statusCode = (err as FastifyError).statusCode;
      if (statusCode === 429) {
        return reply.status(429).send(body("RATE_LIMITED", "Too many requests"));
      }
      if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
        // Fastify's own client errors: bad JSON, body too large, unsupported content type...
        return reply.status(statusCode).send(body("VALIDATION", err.message));
      }
      req.log.error({ err }, "unhandled error");
      return reply
        .status(500)
        .send(body("INTERNAL", opts.exposeInternalErrors ? err.message : "Something went wrong on our side"));
    });

    app.setNotFoundHandler((req, reply) => {
      reply.status(404).send(body("NOT_FOUND", `Route ${req.method} ${req.url.split("?")[0]} not found`));
    });
  },
  { name: "needgrid-error-handler" },
);

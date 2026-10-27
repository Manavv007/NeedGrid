import type { AgentStreamEvent, ErrorCode } from "@needgrid/shared";
import type { FastifyReply } from "fastify";
import { env } from "../env";

/** Throw this anywhere in a handler; the error handler turns it into the shared ApiError shape. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (what = "Resource") => new HttpError(404, "NOT_FOUND", `${what} not found`);
export const invalidState = (message: string, details?: unknown) =>
  new HttpError(409, "INVALID_STATE", message, details);
export const upstream = (message: string, details?: unknown) => new HttpError(502, "UPSTREAM", message, details);

/**
 * Stream NDJSON (one AgentStreamEvent per line) for the staff assistant.
 * Takes over the raw response, so call it before anything else is written.
 */
export function sendNdjson(reply: FastifyReply): { write(ev: AgentStreamEvent): void; end(): void } {
  reply.hijack();
  const origin = reply.request.headers.origin;
  const raw = reply.raw;
  raw.statusCode = 200;
  raw.setHeader("content-type", "application/x-ndjson; charset=utf-8");
  raw.setHeader("cache-control", "no-cache, no-transform");
  raw.setHeader("x-accel-buffering", "no");
  // Hijacking bypasses @fastify/cors, so repeat the CORS headers here.
  if (origin && reply.request.server.isAllowedOrigin(origin)) {
    raw.setHeader("access-control-allow-origin", origin);
    raw.setHeader("vary", "Origin");
  }
  raw.flushHeaders();
  let ended = false;
  return {
    write(ev) {
      if (!ended) raw.write(`${JSON.stringify(ev)}\n`);
    },
    end() {
      if (!ended) {
        ended = true;
        raw.end();
      }
    },
  };
}

/** Only Cloudinary URLs for our own cloud are accepted as image inputs (prevents SSRF). */
export function assertCloudinaryUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(400, "VALIDATION", "Image URL is not a valid URL");
  }
  const ok =
    parsed.protocol === "https:" &&
    parsed.hostname === "res.cloudinary.com" &&
    parsed.pathname.startsWith(`/${env.CLOUDINARY_CLOUD_NAME}/`) &&
    parsed.username === "" &&
    parsed.password === "";
  if (!ok) throw new HttpError(400, "VALIDATION", "Images must be uploaded to the NeedGrid Cloudinary account");
}

/**
 * PayPal webhook signature verification (AGENT_A_BACKEND.md §8.4, money rule 10).
 *
 * We ask PayPal itself to verify (POST /v1/notifications/verify-webhook-signature). The event must be
 * sent back byte-for-byte as PayPal signed it, so the request body is built by string concatenation
 * around the raw event instead of re-serialising a parsed object.
 *
 * Note: events sent from the developer dashboard's webhook SIMULATOR can never be verified.
 * Test with real sandbox payments instead.
 */
import type { IncomingHttpHeaders } from "node:http";
import { env } from "../env";
import { HttpError } from "../lib/http";
import { paypalFetch } from "./client";

export interface WebhookHeaders {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
}

export interface WebhookVerifier {
  /** True only when PayPal confirms the event was signed for our webhook id. */
  verify(headers: WebhookHeaders, rawBody: string): Promise<boolean>;
}

const MAX_HEADER = 2000;

/** The five PayPal transmission headers, or null if any is missing or oversized. */
export function readWebhookHeaders(h: IncomingHttpHeaders): WebhookHeaders | null {
  const one = (name: string): string | null => {
    const v = h[name];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.length <= MAX_HEADER ? s : null;
  };
  const authAlgo = one("paypal-auth-algo");
  const certUrl = one("paypal-cert-url");
  const transmissionId = one("paypal-transmission-id");
  const transmissionSig = one("paypal-transmission-sig");
  const transmissionTime = one("paypal-transmission-time");
  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) return null;
  return { authAlgo, certUrl, transmissionId, transmissionSig, transmissionTime };
}

/** Header values are JSON-escaped; the event is inserted raw. `rawBody` must already be valid JSON. */
export function buildVerifyBody(h: WebhookHeaders, webhookId: string, rawBody: string): string {
  const j = JSON.stringify;
  return (
    `{"auth_algo":${j(h.authAlgo)},"cert_url":${j(h.certUrl)},"transmission_id":${j(h.transmissionId)},` +
    `"transmission_sig":${j(h.transmissionSig)},"transmission_time":${j(h.transmissionTime)},` +
    `"webhook_id":${j(webhookId)},"webhook_event":${rawBody}}`
  );
}

export const realWebhookVerifier: WebhookVerifier = {
  async verify(headers, rawBody) {
    if (!env.PAYPAL_WEBHOOK_ID) throw new HttpError(503, "UPSTREAM", "PayPal webhooks are not configured");
    const { data } = await paypalFetch<{ verification_status?: string }>(
      "POST",
      "/v1/notifications/verify-webhook-signature",
      {
        requestId: `verify-${headers.transmissionId}`,
        rawBody: buildVerifyBody(headers, env.PAYPAL_WEBHOOK_ID, rawBody),
      },
    );
    return data?.verification_status === "SUCCESS";
  },
};

let current: WebhookVerifier = realWebhookVerifier;

export function webhookVerifier(): WebhookVerifier {
  return current;
}

/** Tests only. */
export function setWebhookVerifier(v: WebhookVerifier): void {
  current = v;
}

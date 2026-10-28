/** Webhook signature verification with a stubbed fetch. No network. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { paypalClientConfig, resetPayPalTokenCache } from "./client";
import { buildVerifyBody, readWebhookHeaders, realWebhookVerifier, type WebhookHeaders } from "./webhooks";

const headers: WebhookHeaders = {
  authAlgo: "SHA256withRSA",
  certUrl: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77",
  transmissionId: "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
  transmissionSig:
    "lmI95Jx3Y9nhR5SJWlHVIWpg4AgFk7n9bCHSRxbrd8A9zrhdu2rMyFrmz+Zjh3s3boXB07VXCXUZy/UFzUlnGJn0wDugt7FlSvdKeIJenLRemUxYCPVoEZzg9VFNqOa48gMkvF+XTpxBeUx/kWy6B5cp7GkT2+pOowfRK7OaynuxUoKW3JcMWw272VKjLTtTAShncla7tGF+55rxyt2KNZIIqxNMJ48RDZheGU5w1npu9dZHnPgTXB9iomeVRoD8O/jhRpnKsGrDschyNdkeh81BJJMH4Ctc6lnCCquoP/GzCzz33MMsNdid7vL/NIWaCsekQpW26FpWPi/tfj8nLA==",
  transmissionTime: "2016-02-18T20:01:35Z",
};

describe("readWebhookHeaders", () => {
  const raw = {
    "paypal-auth-algo": headers.authAlgo,
    "paypal-cert-url": headers.certUrl,
    "paypal-transmission-id": headers.transmissionId,
    "paypal-transmission-sig": headers.transmissionSig,
    "paypal-transmission-time": headers.transmissionTime,
  };
  it("reads all five headers", () => {
    expect(readWebhookHeaders(raw)).toEqual(headers);
  });
  it("null when one is missing or oversized", () => {
    expect(readWebhookHeaders({ ...raw, "paypal-transmission-sig": undefined })).toBeNull();
    expect(readWebhookHeaders({ ...raw, "paypal-cert-url": "x".repeat(2001) })).toBeNull();
  });
});

describe("buildVerifyBody", () => {
  it("embeds the raw event byte-for-byte and escapes header values", () => {
    const raw = '{ "id" : "WH-1",\n  "event_type":"PAYMENT.CAPTURE.COMPLETED", "resource": {"x":"é"} }';
    const body = buildVerifyBody({ ...headers, authAlgo: 'weird"algo' }, "WH-ID", raw);
    expect(body.endsWith(`"webhook_event":${raw}}`)).toBe(true);
    const parsed = JSON.parse(body);
    expect(parsed).toMatchObject({
      auth_algo: 'weird"algo',
      webhook_id: "WH-ID",
      transmission_sig: headers.transmissionSig,
    });
    expect(parsed.webhook_event.resource.x).toBe("é");
  });
});

describe("realWebhookVerifier", () => {
  let sent: { url: string; body: string } | null = null;
  let status = "SUCCESS";

  beforeEach(() => {
    sent = null;
    paypalClientConfig.baseDelayMs = 0;
    resetPayPalTokenCache();
    vi.stubGlobal("fetch", async (input: URL | string, init: RequestInit = {}) => {
      const url = String(input);
      if (url.endsWith("/v1/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      }
      sent = { url, body: String(init.body) };
      return new Response(JSON.stringify({ verification_status: status }), { status: 200 });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    paypalClientConfig.baseDelayMs = 250;
  });

  it("posts our webhook id and the exact event, true on SUCCESS", async () => {
    status = "SUCCESS";
    const raw = '{"id":"WH-2","event_type":"X","resource":{}}';
    await expect(realWebhookVerifier.verify(headers, raw)).resolves.toBe(true);
    expect(sent!.url).toBe("https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature");
    expect(sent!.body).toBe(buildVerifyBody(headers, "WH-TEST-WEBHOOK-ID", raw));
  });

  it("false on FAILURE", async () => {
    status = "FAILURE";
    await expect(realWebhookVerifier.verify(headers, '{"id":"WH-3"}')).resolves.toBe(false);
  });
});

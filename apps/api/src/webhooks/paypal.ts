/**
 * POST /api/webhooks/paypal (AGENT_A_BACKEND.md §8.4, money rules 5 and 10).
 *
 * Order of work:
 *   1. keep the raw body (route-scoped JSON parser), check the event shape and the 5 PayPal headers
 *   2. ask PayPal to verify the signature. Unverified events are rejected (400) and NOT stored, so a
 *      forged request can never occupy a real event id in the dedupe table
 *   3. INSERT webhook_events … ON CONFLICT DO NOTHING (unique paypal_event_id). Already processed → 200
 *   4. process, then set processed_at. A processing error stores the message and returns 500 so PayPal
 *      retries later; processing is idempotent, so a retry is always safe.
 *
 * Webhooks are a BACKUP for the capture response (donor closed the page before capture finished),
 * and in Phase 9 the only signal that a sponsor invoice was paid.
 */
import { payPalValueToCents } from "@needgrid/shared";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client";
import { reservations, webhookEvents } from "../db/schema";
import { HttpError } from "../lib/http";
import { recordCapture } from "../money/capture";
import { readWebhookHeaders, webhookVerifier } from "../paypal/webhooks";

declare module "fastify" {
  interface FastifyRequest {
    /** Exact request body bytes; set only on the webhook route. */
    rawBody?: string;
  }
}

const EventSchema = z.object({
  id: z.string().min(1).max(100),
  event_type: z.string().min(1).max(100),
  resource: z.unknown(),
});
type PayPalEvent = z.infer<typeof EventSchema>;

const CaptureResource = z.object({
  id: z.string().min(1),
  status: z.string(),
  amount: z.object({ value: z.string(), currency_code: z.string() }),
  custom_id: z.string().optional(),
  supplementary_data: z.object({ related_ids: z.object({ order_id: z.string().optional() }).optional() }).optional(),
});

const isUuid = (s: string) => z.uuid().safeParse(s).success;

/** PAYMENT.CAPTURE.COMPLETED: record the donation if the page's capture call didn't (idempotent). */
async function handleCaptureCompleted(resource: unknown): Promise<string> {
  const c = CaptureResource.parse(resource);
  if (c.status !== "COMPLETED") return `ignored: capture status ${c.status}`;

  const orderId = c.supplementary_data?.related_ids?.order_id ?? null;
  let [res] = orderId
    ? await db.select().from(reservations).where(eq(reservations.paypalOrderId, orderId)).limit(1)
    : [];
  if (!res && c.custom_id && isUuid(c.custom_id)) {
    [res] = await db.select().from(reservations).where(eq(reservations.id, c.custom_id)).limit(1);
  }
  // Not one of our donation orders (e.g. an invoice payment also emits a capture event).
  if (!res) return "ignored: not a NeedGrid donation order";
  if (c.amount.currency_code !== "USD") throw new Error(`unexpected capture currency ${c.amount.currency_code}`);

  const finalOrderId = orderId ?? res.paypalOrderId;
  if (!finalOrderId) throw new Error("capture event has no order id and the reservation has none either");

  const result = await recordCapture({
    reservationId: res.id,
    orderId: finalOrderId,
    captureId: c.id,
    amountCents: payPalValueToCents(c.amount.value),
    donorName: null, // capture events carry no payer details
    donorEmail: null,
  });
  return `donation ${result.donationId}`;
}

export async function processPayPalEvent(event: PayPalEvent): Promise<string> {
  switch (event.event_type) {
    case "PAYMENT.CAPTURE.COMPLETED":
      return handleCaptureCompleted(event.resource);
    case "PAYMENT.CAPTURE.REFUNDED":
      // Refunds are recorded when our own executor runs them (Phase 10); this is just a receipt.
      return "logged: refund";
    case "INVOICING.INVOICE.PAID":
      // Sponsor invoices arrive in Phase 9. No invoices exist before then.
      return "logged: invoice paid (handler arrives in Phase 9)";
    default:
      return `ignored: ${event.event_type}`;
  }
}

export async function paypalWebhookRoutes(app: FastifyInstance) {
  // This plugin is encapsulated (not fastify-plugin), so the raw-body JSON parser only applies here.
  app.decorateRequest("rawBody", undefined);
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    req.rawBody = body as string;
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(new HttpError(400, "VALIDATION", "Body is not valid JSON"), undefined);
    }
  });

  app.post("/api/webhooks/paypal", async (req, reply) => {
    const raw = req.rawBody;
    if (!raw) throw new HttpError(400, "VALIDATION", "Expected a JSON body");
    const parsed = EventSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "VALIDATION", "Not a PayPal webhook event");
    const event = parsed.data;
    const headers = readWebhookHeaders(req.headers);
    if (!headers) throw new HttpError(400, "VALIDATION", "Missing PayPal transmission headers");

    const log = req.log.child({ paypalEventId: event.id, eventType: event.event_type });
    if (!(await webhookVerifier().verify(headers, raw))) {
      log.warn("webhook rejected: signature not verified");
      throw new HttpError(400, "VALIDATION", "Webhook signature could not be verified");
    }

    const [inserted] = await db
      .insert(webhookEvents)
      .values({ paypalEventId: event.id, type: event.event_type, payload: req.body, verified: true })
      .onConflictDoNothing()
      .returning();
    const row =
      inserted ?? (await db.select().from(webhookEvents).where(eq(webhookEvents.paypalEventId, event.id)).limit(1))[0];
    if (!row) throw new Error("webhook event row vanished");
    if (row.processedAt) {
      log.info("webhook duplicate: already processed");
      return reply.send({ ok: true, duplicate: true });
    }

    try {
      const outcome = await processPayPalEvent(event);
      await db
        .update(webhookEvents)
        .set({ processedAt: sql`now()`, error: null })
        .where(eq(webhookEvents.id, row.id));
      log.info({ outcome }, "webhook processed");
      return reply.send({ ok: true });
    } catch (err) {
      const message = (err as Error).message.slice(0, 500);
      await db.update(webhookEvents).set({ error: message }).where(eq(webhookEvents.id, row.id));
      log.error({ err }, "webhook processing failed; PayPal will retry");
      throw new HttpError(500, "INTERNAL", "Webhook processing failed");
    }
  });
}

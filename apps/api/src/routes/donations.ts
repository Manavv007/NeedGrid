import { CreateOrderReq, paths } from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getImpact } from "../core/impact";
import { notFound } from "../lib/http";
import { captureDonationOrder } from "../money/capture";
import { createDonationOrder } from "../money/donations";

/** PayPal order ids are short upper-case alphanumerics; anything else never reaches the database or PayPal. */
const OrderIdParams = z.object({ orderId: z.string() });
const ORDER_ID = /^[A-Z0-9]{5,40}$/;
const TokenParams = z.object({ token: z.string() });

/** Public donation endpoints. The server decides every amount (money rule 1). */
export async function donationRoutes(app: FastifyInstance) {
  app.post(paths.createOrder, { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = CreateOrderReq.parse(req.body);
    return reply.status(201).send(await createDonationOrder(body));
  });

  // Idempotent: calling it again (page refresh) returns the same donation.
  app.post("/api/donations/orders/:orderId/capture", async (req) => {
    const { orderId } = OrderIdParams.parse(req.params);
    if (!ORDER_ID.test(orderId)) throw notFound("Donation order");
    return captureDonationOrder(orderId);
  });

  app.get("/api/impact/:token", async (req, reply) => {
    const { token } = TokenParams.parse(req.params);
    reply.header("cache-control", "no-store");
    return getImpact(token);
  });
}

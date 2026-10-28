/**
 * Drizzle schema = AGENT_A_BACKEND.md §6. A owns this file and the migrations in apps/api/drizzle.
 *
 * Money rules baked into the schema:
 * - every money column is an integer number of cents (allocations.amount_cents is SIGNED: negative = moved out)
 * - funded_cents is only ever updated in the same transaction that inserts allocation rows (enforced in code)
 * - unique paypal_order_id / capture_id / paypal_event_id stop double counting
 *
 * This file must not import env.ts (drizzle-kit loads it without the app's environment).
 */
import {
  AGENT_ACTION_STATUSES,
  ALLOCATION_REASONS,
  CATEGORIES,
  DONATION_SOURCES,
  DONATION_STATUSES,
  MONEY_TOOLS,
  NEED_STATUSES,
  PURCHASE_STATUSES,
  RESERVATION_STATUSES,
  SPONSOR_INVOICE_STATUSES,
  type ActionPreview,
  type ProductSnapshot,
  type PurchaseOffer,
} from "@needgrid/shared";
import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
  type AnyPgColumn,
  type PgColumn,
} from "drizzle-orm/pg-core";

export const EMBEDDING_DIMENSIONS = 768;

/** CHECK (col IN ('a','b',...)) from one of the shared enum lists. Values are our own constants, never user input. */
function oneOf(column: PgColumn, values: readonly string[]): SQL {
  const list = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
  return sql`${column} in (${sql.raw(list)})`;
}

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

// ---------------------------------------------------------------------------------------------
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  city: text("city").notNull(),
  description: text("description").notNull().default(""),
  causeTags: text("cause_tags")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  logoUrl: text("logo_url"),
  payeeEmail: text("payee_email"), // P2
  staffKeyHash: text("staff_key_hash").notNull().unique(), // lowercase SHA-256 hex of the passcode
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------------------------
export const needs = pgTable(
  "needs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    category: text("category").notNull(),
    urgency: smallint("urgency").notNull().default(2),
    quantity: integer("quantity").notNull(),
    unit: text("unit").notNull(),
    status: text("status").notNull().default("draft"),
    targetCents: integer("target_cents").notNull(),
    fundedCents: integer("funded_cents").notNull().default(0),
    product: jsonb("product").$type<ProductSnapshot>(),
    alternatives: jsonb("alternatives")
      .$type<ProductSnapshot[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    deadlineAt: ts("deadline_at"),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    fundedAt: ts("funded_at"),
    orderedAt: ts("ordered_at"),
    deliveredAt: ts("delivered_at"),
    closedAt: ts("closed_at"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("needs_org_status_idx").on(t.orgId, t.status),
    index("needs_status_urgency_idx").on(t.status, t.urgency.desc()),
    check("needs_category_check", oneOf(t.category, CATEGORIES)),
    check("needs_status_check", oneOf(t.status, NEED_STATUSES)),
    check("needs_urgency_check", sql`${t.urgency} between 1 and 3`),
    check("needs_quantity_check", sql`${t.quantity} > 0`),
    check("needs_target_check", sql`${t.targetCents} >= 0`),
    check("needs_funded_check", sql`${t.fundedCents} >= 0`),
  ],
);

// ---------------------------------------------------------------------------------------------
// Defined before reservations/donations, which reference it.
export const sponsorInvoices = pgTable(
  "sponsor_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    paypalInvoiceId: text("paypal_invoice_id").unique(),
    recipientEmail: text("recipient_email").notNull(),
    recipientName: text("recipient_name"),
    needIds: uuid("need_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    planned: jsonb("planned")
      .$type<Array<{ needId: string; title: string; amountCents: number }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    amountCents: integer("amount_cents").notNull(),
    status: text("status").notNull().default("draft"),
    payerViewUrl: text("payer_view_url"),
    qrImageDataUrl: text("qr_image_data_url"),
    paidAt: ts("paid_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("sponsor_invoices_org_idx").on(t.orgId, t.createdAt),
    check("sponsor_invoices_status_check", oneOf(t.status, SPONSOR_INVOICE_STATUSES)),
    check("sponsor_invoices_amount_check", sql`${t.amountCents} > 0`),
  ],
);

// ---------------------------------------------------------------------------------------------
export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    needId: uuid("need_id")
      .notNull()
      .references(() => needs.id),
    paypalOrderId: text("paypal_order_id").unique(), // set right after the PayPal create call
    sponsorInvoiceId: uuid("sponsor_invoice_id").references(() => sponsorInvoices.id), // sponsor holds
    amountCents: integer("amount_cents").notNull(),
    rollOverConsent: boolean("roll_over_consent").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [
    // A hold counts only while status = 'active' AND expires_at > now().
    index("reservations_need_active_idx").on(t.needId, t.status, t.expiresAt),
    check("reservations_status_check", oneOf(t.status, RESERVATION_STATUSES)),
    check("reservations_amount_check", sql`${t.amountCents} > 0`),
  ],
);

// ---------------------------------------------------------------------------------------------
export const donations = pgTable(
  "donations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    paypalOrderId: text("paypal_order_id").unique(),
    captureId: text("capture_id").unique(),
    sponsorInvoiceId: uuid("sponsor_invoice_id").references(() => sponsorInvoices.id),
    amountCents: integer("amount_cents").notNull(),
    refundedCents: integer("refunded_cents").notNull().default(0),
    unallocatedCents: integer("unallocated_cents").notNull().default(0), // money with nowhere to go, awaiting a refund
    // PERSONAL DATA: never returned by public endpoints (first name only, on the donor's own impact page).
    donorName: text("donor_name"),
    donorEmail: text("donor_email"),
    rollOverConsent: boolean("roll_over_consent").notNull().default(true),
    source: text("source").notNull(),
    status: text("status").notNull().default("captured"),
    impactToken: text("impact_token").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [
    index("donations_org_created_idx").on(t.orgId, t.createdAt),
    check("donations_source_check", oneOf(t.source, DONATION_SOURCES)),
    check("donations_status_check", oneOf(t.status, DONATION_STATUSES)),
    check("donations_amount_check", sql`${t.amountCents} > 0`),
    check("donations_refunded_check", sql`${t.refundedCents} between 0 and ${t.amountCents}`),
    check("donations_unallocated_check", sql`${t.unallocatedCents} >= 0`),
  ],
);

// ---------------------------------------------------------------------------------------------
/** The single record of which item each dollar paid for. needs.funded_cents = SUM(amount_cents) per need. */
export const allocations = pgTable(
  "allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    donationId: uuid("donation_id")
      .notNull()
      .references(() => donations.id),
    needId: uuid("need_id")
      .notNull()
      .references(() => needs.id),
    amountCents: integer("amount_cents").notNull(), // SIGNED: negative = money moved out of this need
    reason: text("reason").notNull(),
    relatedAllocationId: uuid("related_allocation_id").references((): AnyPgColumn => allocations.id), // pairs a −/+ move
    createdAt: createdAt(),
  },
  (t) => [
    index("allocations_need_idx").on(t.needId),
    index("allocations_donation_idx").on(t.donationId),
    check("allocations_reason_check", oneOf(t.reason, ALLOCATION_REASONS)),
    check("allocations_nonzero_check", sql`${t.amountCents} <> 0`),
  ],
);

// ---------------------------------------------------------------------------------------------
export const purchases = pgTable(
  "purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    needId: uuid("need_id")
      .notNull()
      .references(() => needs.id),
    offer: jsonb("offer").$type<PurchaseOffer>().notNull(),
    newTargetCents: integer("new_target_cents").notNull(),
    explanation: text("explanation").notNull().default(""),
    flags: text("flags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text("status").notNull().default("proposed"),
    orderRef: text("order_ref"),
    approvedAt: ts("approved_at"),
    orderedAt: ts("ordered_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("purchases_need_idx").on(t.needId, t.createdAt),
    // At most one approved purchase per need at a time.
    uniqueIndex("purchases_one_approved_per_need")
      .on(t.needId)
      .where(sql`${t.status} = 'approved'`),
    check("purchases_status_check", oneOf(t.status, PURCHASE_STATUSES)),
    check("purchases_target_check", sql`${t.newTargetCents} >= 0`),
  ],
);

// ---------------------------------------------------------------------------------------------
export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    needId: uuid("need_id")
      .notNull()
      .references(() => needs.id),
    photoUrl: text("photo_url").notNull(),
    matchScore: real("match_score").notNull(),
    aiNotes: text("ai_notes").notNull().default(""),
    needsReview: boolean("needs_review").notNull(),
    message: text("message"),
    confirmedAt: ts("confirmed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("deliveries_need_idx").on(t.needId, t.createdAt),
    check("deliveries_score_check", sql`${t.matchScore} between 0 and 1`),
  ],
);

// ---------------------------------------------------------------------------------------------
/** Audit log of every money action the assistant (or the system) proposed. Never deleted. */
export const agentActions = pgTable(
  "agent_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    tool: text("tool").notNull(),
    args: jsonb("args").$type<Record<string, unknown>>().notNull(),
    computed: jsonb("computed")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    preview: jsonb("preview").$type<ActionPreview>().notNull(),
    status: text("status").notNull().default("proposed"),
    origin: text("origin").notNull(),
    result: jsonb("result"),
    error: text("error"),
    createdAt: createdAt(),
    decidedAt: ts("decided_at"),
    executedAt: ts("executed_at"),
  },
  (t) => [
    index("agent_actions_org_status_idx").on(t.orgId, t.status, t.createdAt),
    check("agent_actions_tool_check", oneOf(t.tool, MONEY_TOOLS)),
    check("agent_actions_status_check", oneOf(t.status, AGENT_ACTION_STATUSES)),
    check("agent_actions_origin_check", oneOf(t.origin, ["assistant", "system"])),
  ],
);

// ---------------------------------------------------------------------------------------------
export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  paypalEventId: text("paypal_event_id").notNull().unique(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  verified: boolean("verified").notNull().default(false),
  processedAt: ts("processed_at"),
  error: text("error"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------------------------
export type OrganizationRow = typeof organizations.$inferSelect;
export type NeedRow = typeof needs.$inferSelect;
export type NewNeedRow = typeof needs.$inferInsert;
export type ReservationRow = typeof reservations.$inferSelect;
export type DonationRow = typeof donations.$inferSelect;
export type AllocationRow = typeof allocations.$inferSelect;
export type PurchaseRow = typeof purchases.$inferSelect;
export type DeliveryRow = typeof deliveries.$inferSelect;
export type SponsorInvoiceRow = typeof sponsorInvoices.$inferSelect;
export type AgentActionRow = typeof agentActions.$inferSelect;
export type WebhookEventRow = typeof webhookEvents.$inferSelect;

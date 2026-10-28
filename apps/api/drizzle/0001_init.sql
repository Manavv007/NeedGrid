CREATE TABLE "agent_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"args" jsonb NOT NULL,
	"computed" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preview" jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"origin" text NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	CONSTRAINT "agent_actions_tool_check" CHECK ("agent_actions"."tool" in ('create_invoice', 'send_invoice', 'create_refund')),
	CONSTRAINT "agent_actions_status_check" CHECK ("agent_actions"."status" in ('proposed', 'approved', 'rejected', 'executed', 'failed')),
	CONSTRAINT "agent_actions_origin_check" CHECK ("agent_actions"."origin" in ('assistant', 'system'))
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"donation_id" uuid NOT NULL,
	"need_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"related_allocation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocations_reason_check" CHECK ("allocations"."reason" in ('direct', 'overflow', 'price_drop', 'rollover', 'sponsor', 'refund')),
	CONSTRAINT "allocations_nonzero_check" CHECK ("allocations"."amount_cents" <> 0)
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"need_id" uuid NOT NULL,
	"photo_url" text NOT NULL,
	"match_score" real NOT NULL,
	"ai_notes" text DEFAULT '' NOT NULL,
	"needs_review" boolean NOT NULL,
	"message" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_score_check" CHECK ("deliveries"."match_score" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "donations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"paypal_order_id" text,
	"capture_id" text,
	"sponsor_invoice_id" uuid,
	"amount_cents" integer NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"unallocated_cents" integer DEFAULT 0 NOT NULL,
	"donor_name" text,
	"donor_email" text,
	"roll_over_consent" boolean DEFAULT true NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'captured' NOT NULL,
	"impact_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donations_paypal_order_id_unique" UNIQUE("paypal_order_id"),
	CONSTRAINT "donations_capture_id_unique" UNIQUE("capture_id"),
	CONSTRAINT "donations_impact_token_unique" UNIQUE("impact_token"),
	CONSTRAINT "donations_source_check" CHECK ("donations"."source" in ('order', 'invoice', 'seed')),
	CONSTRAINT "donations_status_check" CHECK ("donations"."status" in ('captured', 'partially_refunded', 'refunded')),
	CONSTRAINT "donations_amount_check" CHECK ("donations"."amount_cents" > 0),
	CONSTRAINT "donations_refunded_check" CHECK ("donations"."refunded_cents" between 0 and "donations"."amount_cents"),
	CONSTRAINT "donations_unallocated_check" CHECK ("donations"."unallocated_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "needs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"urgency" smallint DEFAULT 2 NOT NULL,
	"quantity" integer NOT NULL,
	"unit" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"target_cents" integer NOT NULL,
	"funded_cents" integer DEFAULT 0 NOT NULL,
	"product" jsonb,
	"alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deadline_at" timestamp with time zone,
	"embedding" vector(768),
	"funded_at" timestamp with time zone,
	"ordered_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "needs_category_check" CHECK ("needs"."category" in ('food', 'hygiene', 'baby', 'clothing', 'bedding', 'school', 'pet', 'medical', 'household', 'other')),
	CONSTRAINT "needs_status_check" CHECK ("needs"."status" in ('draft', 'open', 'funded', 'ordered', 'delivered', 'topping_up', 'closed')),
	CONSTRAINT "needs_urgency_check" CHECK ("needs"."urgency" between 1 and 3),
	CONSTRAINT "needs_quantity_check" CHECK ("needs"."quantity" > 0),
	CONSTRAINT "needs_target_check" CHECK ("needs"."target_cents" >= 0),
	CONSTRAINT "needs_funded_check" CHECK ("needs"."funded_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"cause_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"logo_url" text,
	"payee_email" text,
	"staff_key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_staff_key_hash_unique" UNIQUE("staff_key_hash")
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"need_id" uuid NOT NULL,
	"offer" jsonb NOT NULL,
	"new_target_cents" integer NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"order_ref" text,
	"approved_at" timestamp with time zone,
	"ordered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchases_status_check" CHECK ("purchases"."status" in ('proposed', 'approved', 'ordered', 'rejected', 'superseded')),
	CONSTRAINT "purchases_target_check" CHECK ("purchases"."new_target_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"need_id" uuid NOT NULL,
	"paypal_order_id" text,
	"sponsor_invoice_id" uuid,
	"amount_cents" integer NOT NULL,
	"roll_over_consent" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_paypal_order_id_unique" UNIQUE("paypal_order_id"),
	CONSTRAINT "reservations_status_check" CHECK ("reservations"."status" in ('active', 'converted', 'released')),
	CONSTRAINT "reservations_amount_check" CHECK ("reservations"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "sponsor_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"paypal_invoice_id" text,
	"recipient_email" text NOT NULL,
	"recipient_name" text,
	"need_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"planned" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"payer_view_url" text,
	"qr_image_data_url" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sponsor_invoices_paypal_invoice_id_unique" UNIQUE("paypal_invoice_id"),
	CONSTRAINT "sponsor_invoices_status_check" CHECK ("sponsor_invoices"."status" in ('draft', 'sent', 'paid', 'cancelled')),
	CONSTRAINT "sponsor_invoices_amount_check" CHECK ("sponsor_invoices"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paypal_event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_paypal_event_id_unique" UNIQUE("paypal_event_id")
);
--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_donation_id_donations_id_fk" FOREIGN KEY ("donation_id") REFERENCES "public"."donations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_need_id_needs_id_fk" FOREIGN KEY ("need_id") REFERENCES "public"."needs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_related_allocation_id_allocations_id_fk" FOREIGN KEY ("related_allocation_id") REFERENCES "public"."allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_need_id_needs_id_fk" FOREIGN KEY ("need_id") REFERENCES "public"."needs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_sponsor_invoice_id_sponsor_invoices_id_fk" FOREIGN KEY ("sponsor_invoice_id") REFERENCES "public"."sponsor_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "needs" ADD CONSTRAINT "needs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_need_id_needs_id_fk" FOREIGN KEY ("need_id") REFERENCES "public"."needs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_need_id_needs_id_fk" FOREIGN KEY ("need_id") REFERENCES "public"."needs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_sponsor_invoice_id_sponsor_invoices_id_fk" FOREIGN KEY ("sponsor_invoice_id") REFERENCES "public"."sponsor_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_invoices" ADD CONSTRAINT "sponsor_invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_actions_org_status_idx" ON "agent_actions" USING btree ("org_id","status","created_at");--> statement-breakpoint
CREATE INDEX "allocations_need_idx" ON "allocations" USING btree ("need_id");--> statement-breakpoint
CREATE INDEX "allocations_donation_idx" ON "allocations" USING btree ("donation_id");--> statement-breakpoint
CREATE INDEX "deliveries_need_idx" ON "deliveries" USING btree ("need_id","created_at");--> statement-breakpoint
CREATE INDEX "donations_org_created_idx" ON "donations" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "needs_org_status_idx" ON "needs" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "needs_status_urgency_idx" ON "needs" USING btree ("status","urgency" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "purchases_need_idx" ON "purchases" USING btree ("need_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_one_approved_per_need" ON "purchases" USING btree ("need_id") WHERE "purchases"."status" = 'approved';--> statement-breakpoint
CREATE INDEX "reservations_need_active_idx" ON "reservations" USING btree ("need_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "sponsor_invoices_org_idx" ON "sponsor_invoices" USING btree ("org_id","created_at");
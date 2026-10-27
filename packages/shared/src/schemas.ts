import { z } from "zod";
import {
  AGENT_ACTION_STATUSES,
  ALLOCATION_REASONS,
  CATEGORIES,
  DATASETS,
  DONATION_SOURCES,
  ERROR_CODES,
  MONEY_TOOLS,
  NEED_STATUSES,
  PURCHASE_STATUSES,
  SPONSOR_INVOICE_STATUSES,
  URGENCY_MAX,
  URGENCY_MIN,
} from "./enums";
import { MAX_DONATION_CENTS, MIN_DONATION_CENTS } from "./money";

// ---------- primitives ----------
export const Cents = z.number().int().nonnegative();
export const SignedCents = z.number().int();
export const Id = z.uuid();
export const IsoDate = z.iso.datetime();
export const NeedStatus = z.enum(NEED_STATUSES);
export type NeedStatus = z.infer<typeof NeedStatus>;
export const Category = z.enum(CATEGORIES);
export type Category = z.infer<typeof Category>;
export const Urgency = z.number().int().min(URGENCY_MIN).max(URGENCY_MAX);
export const AllocationReason = z.enum(ALLOCATION_REASONS);
export type AllocationReason = z.infer<typeof AllocationReason>;

export const ApiError = z.object({
  error: z.object({ code: z.enum(ERROR_CODES), message: z.string(), details: z.unknown().optional() }),
});
export type ApiError = z.infer<typeof ApiError>;

// ---------- products (Channel3, normalised by B) ----------
export const ProductSnapshot = z.object({
  channel3Id: z.string(),
  title: z.string(),
  imageUrl: z.url().nullable(),
  retailer: z.string(),
  url: z.url(),
  unitPriceCents: Cents, // price of ONE purchasable unit (one pack)
  packSize: z.number().int().positive().nullable(), // items per pack if known (e.g. 150 diapers)
  inStock: z.boolean().nullable(),
  fetchedAt: IsoDate,
});
export type ProductSnapshot = z.infer<typeof ProductSnapshot>;

export const ProductOption = ProductSnapshot.extend({
  fitScore: z.number().min(0).max(1),
  fitReason: z.string(),
  pricePerItemCents: Cents.nullable(), // unitPriceCents / packSize, rounded
});
export type ProductOption = z.infer<typeof ProductOption>;

// ---------- orgs & needs (public) ----------
export const OrgPublic = z.object({
  id: Id,
  slug: z.string(),
  name: z.string(),
  city: z.string(),
  description: z.string(),
  causeTags: z.array(z.string()),
  logoUrl: z.url().nullable(),
});
export type OrgPublic = z.infer<typeof OrgPublic>;

export const OrgStats = z.object({
  raisedCents: Cents,
  itemsFunded: z.number().int(),
  itemsDelivered: z.number().int(),
  openNeeds: z.number().int(),
});
export const OrgSummary = OrgPublic.extend({ stats: OrgStats });
export const OrgListRes = z.object({ orgs: z.array(OrgSummary) });

export const NeedCard = z.object({
  id: Id,
  orgId: Id,
  orgSlug: z.string(),
  title: z.string(),
  description: z.string(),
  category: Category,
  urgency: Urgency,
  quantity: z.number().int().positive(), // number of purchasable units (packs)
  unit: z.string(), // e.g. "pack of 150", "coat", "bag"
  status: NeedStatus,
  targetCents: Cents,
  fundedCents: Cents,
  heldCents: Cents, // sum of active, unexpired holds
  remainingCents: Cents, // max(0, target − funded − held)
  donorCount: z.number().int().nonnegative(),
  product: ProductSnapshot.nullable(),
  deadlineAt: IsoDate.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type NeedCard = z.infer<typeof NeedCard>;
export const NeedRes = z.object({ need: NeedCard });

export const OrgPageRes = z.object({ org: OrgPublic, stats: OrgStats, needs: z.array(NeedCard) });
export type OrgPageRes = z.infer<typeof OrgPageRes>;

export const TimelineEvent = z.object({
  type: z.enum(["created", "donation", "funded", "purchase_approved", "topping_up", "ordered", "delivered", "closed"]),
  at: IsoDate,
  label: z.string(), // human text, e.g. "Funded by 6 donors"
  amountCents: Cents.nullable(),
});
export type TimelineEvent = z.infer<typeof TimelineEvent>;

export const DeliveryPublic = z.object({ photoUrl: z.url(), message: z.string().nullable(), deliveredAt: IsoDate });

export const NeedDetailRes = z.object({
  need: NeedCard,
  org: OrgPublic,
  timeline: z.array(TimelineEvent),
  delivery: DeliveryPublic.nullable(),
});
export type NeedDetailRes = z.infer<typeof NeedDetailRes>;

// ---------- donations ----------
export const CreateOrderReq = z.object({
  needId: Id,
  amountCents: Cents.min(MIN_DONATION_CENTS).max(MAX_DONATION_CENTS),
  /** One checkbox, ticked by default: "If this item is already covered, send my gift to the next most urgent need." Covers overflow AND roll-over. */
  rollOverConsent: z.boolean().default(true),
});
export type CreateOrderReq = z.infer<typeof CreateOrderReq>;

export const CreateOrderRes = z.object({
  orderId: z.string(),
  amountCents: Cents,
  wasClamped: z.boolean(),
  holdExpiresAt: IsoDate,
});
export type CreateOrderRes = z.infer<typeof CreateOrderRes>;

/** Sent in ApiError.details when code = FULLY_FUNDED. */
export const FullyFundedDetails = z.object({ nextNeed: NeedCard.nullable() });

export const AllocationPublic = z.object({
  needId: Id,
  needTitle: z.string(),
  amountCents: Cents,
  reason: AllocationReason,
});
export const CaptureRes = z.object({
  donationId: Id,
  impactToken: z.string(),
  amountCents: Cents,
  allocations: z.array(AllocationPublic),
});
export type CaptureRes = z.infer<typeof CaptureRes>;

export const ImpactItem = z.object({
  need: NeedCard,
  orgName: z.string(),
  amountCents: Cents, // net amount this donation contributed to this need
  reason: AllocationReason,
  timeline: z.array(TimelineEvent),
  delivery: DeliveryPublic.nullable(),
});
export const ImpactRes = z.object({
  donorFirstName: z.string().nullable(),
  totalCents: Cents,
  donatedAt: IsoDate,
  items: z.array(ImpactItem),
});
export type ImpactRes = z.infer<typeof ImpactRes>;

// ---------- match me (P1, B) ----------
export const MatchReq = z.object({
  text: z.string().trim().min(3).max(300),
  budgetCents: Cents.min(MIN_DONATION_CENTS).max(MAX_DONATION_CENTS),
});
export const MatchRes = z.object({
  matches: z.array(z.object({ need: NeedCard, orgName: z.string(), reason: z.string() })).max(3),
});
export type MatchRes = z.infer<typeof MatchRes>;

// ---------- staff ----------
export const StaffMeRes = z.object({ org: OrgPublic });
export const StaffNeedListRes = z.object({ needs: z.array(NeedCard) });

export const PurchaseOffer = z.object({
  channel3Id: z.string(),
  title: z.string(),
  retailer: z.string(),
  url: z.url(),
  imageUrl: z.url().nullable(),
  unitPriceCents: Cents,
  inStock: z.boolean().nullable(),
});
export const PurchaseView = z.object({
  id: Id,
  needId: Id,
  status: z.enum(PURCHASE_STATUSES),
  offer: PurchaseOffer,
  newTargetCents: Cents, // computeTargetCents(offer.unitPriceCents, need.quantity)
  explanation: z.string(), // AI text shown on the card
  flags: z.array(z.string()), // e.g. "price dropped 9%", "only 3 left"
  orderRef: z.string().nullable(),
  createdAt: IsoDate,
  approvedAt: IsoDate.nullable(),
  orderedAt: IsoDate.nullable(),
});
export type PurchaseView = z.infer<typeof PurchaseView>;
export const PurchaseRes = z.object({ purchase: PurchaseView, need: NeedCard });

export const DeliveryView = z.object({
  id: Id,
  needId: Id,
  photoUrl: z.url(),
  matchScore: z.number().min(0).max(1),
  aiNotes: z.string(),
  needsReview: z.boolean(),
  message: z.string().nullable(), // warm donor-facing note (AI-polished)
  createdAt: IsoDate,
  confirmedAt: IsoDate.nullable(),
});
export type DeliveryView = z.infer<typeof DeliveryView>;

export const StaffNeedDetailRes = z.object({
  need: NeedCard,
  alternatives: z.array(ProductSnapshot),
  purchases: z.array(PurchaseView), // newest first
  delivery: DeliveryView.nullable(),
  timeline: z.array(TimelineEvent),
});
export type StaffNeedDetailRes = z.infer<typeof StaffNeedDetailRes>;

// intake (B) — nothing is saved by intake; drafts live in the browser until published
export const IntakeReq = z
  .object({ imageUrl: z.url().optional(), text: z.string().max(5000).optional() })
  .refine((v) => Boolean(v.imageUrl) !== Boolean(v.text), { message: "Send exactly one of imageUrl or text" });
export type IntakeReq = z.infer<typeof IntakeReq>;

export const ExtractedNeed = z.object({
  title: z.string(), // "Diapers, size 4"
  quantity: z.number().int().positive(), // in `unit`s
  unit: z.string(), // "pack", "coat", "can"
  category: Category,
  urgency: Urgency,
  notes: z.string().nullable(),
  searchQuery: z.string(), // what B sends to Channel3
  confidence: z.number().min(0).max(1),
});
export type ExtractedNeed = z.infer<typeof ExtractedNeed>;

export const DraftNeed = z.object({
  draftId: z.string(), // temporary id for React keys
  extracted: ExtractedNeed,
  options: z.array(ProductOption).max(3), // best first; may be empty
  suggestedTargetCents: Cents.nullable(), // for options[0]
});
export type DraftNeed = z.infer<typeof DraftNeed>;
export const IntakeRes = z.object({ drafts: z.array(DraftNeed), warnings: z.array(z.string()) });
export type IntakeRes = z.infer<typeof IntakeRes>;

export const PublishNeedReq = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().max(1000).default(""),
  category: Category,
  urgency: Urgency,
  quantity: z.number().int().min(1).max(10_000),
  unit: z.string().trim().min(1).max(30),
  product: ProductSnapshot,
  alternatives: z.array(ProductSnapshot).max(5).default([]),
  targetCents: Cents.optional(), // staff override; otherwise computeTargetCents(product.unitPriceCents, quantity)
  deadlineAt: IsoDate.nullable().default(null),
  publish: z.boolean().default(true), // false → saved as draft
});
export type PublishNeedReq = z.infer<typeof PublishNeedReq>;

export const PatchNeedReq = z
  .object({
    title: z.string().trim().min(2).max(120),
    description: z.string().max(1000),
    urgency: Urgency,
    quantity: z.number().int().min(1).max(10_000), // only while funded_cents = 0
    targetCents: Cents, // never below funded_cents + held
    deadlineAt: IsoDate.nullable(),
    product: ProductSnapshot, // swap to an alternative
    status: z.enum(["open", "closed"]), // publish a draft, or close
  })
  .partial();
export type PatchNeedReq = z.infer<typeof PatchNeedReq>;

export const PurchasePlanRes = z.object({
  purchase: PurchaseView, // status "proposed"
  priceChange: z.enum(["same", "cheaper", "pricier"]),
  money: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("exact") }),
    z.object({ kind: z.literal("surplus"), cents: Cents, nextNeed: NeedCard.nullable() }),
    z.object({ kind: z.literal("gap"), cents: Cents }),
  ]),
  alternatives: z.array(PurchaseOffer).max(3),
});
export type PurchasePlanRes = z.infer<typeof PurchasePlanRes>;

export const ApprovePurchaseRes = z.object({
  purchase: PurchaseView,
  need: NeedCard,
  surplusMoved: z.object({ toNeedId: Id, toNeedTitle: z.string(), amountCents: Cents }).nullable(),
  gapCents: Cents.nullable(),
});
export type ApprovePurchaseRes = z.infer<typeof ApprovePurchaseRes>;

export const MarkOrderedReq = z.object({ orderRef: z.string().trim().min(1).max(100) });

export const DeliveryReq = z.object({ photoUrl: z.url(), staffNote: z.string().max(500).default("") });
export const DeliveryRes = z.object({ delivery: DeliveryView, need: NeedCard });
export type DeliveryRes = z.infer<typeof DeliveryRes>;
export const ConfirmDeliveryReq = z.object({ message: z.string().max(500).optional() });

// ---------- staff assistant & approvals ----------
export const CreateInvoiceArgs = z.object({
  needIds: z.array(Id).min(1).max(50),
  recipientEmail: z.email(),
  recipientName: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
  send: z.boolean().default(true), // create + send + QR in one approval
});
export const SendInvoiceArgs = z.object({ sponsorInvoiceId: Id });
export const CreateRefundArgs = z.object({ donationId: Id, reason: z.string().min(3).max(200) });
/** Map tool → args schema. The AI never supplies amounts; the server computes them into `computed`. */
export const MONEY_TOOL_ARGS = {
  create_invoice: CreateInvoiceArgs,
  send_invoice: SendInvoiceArgs,
  create_refund: CreateRefundArgs,
} as const;

export const ActionPreview = z.object({
  title: z.string(), // "Invoice Acme Hardware for 4 items"
  lines: z.array(z.object({ label: z.string(), value: z.string() })), // exact args + computed amounts, human-readable
  totalCents: Cents.nullable(),
});
export const AgentAction = z.object({
  id: Id,
  tool: z.enum(MONEY_TOOLS),
  args: z.record(z.string(), z.unknown()), // exactly as proposed (validated by MONEY_TOOL_ARGS)
  computed: z.record(z.string(), z.unknown()), // server-computed (amounts, line items). Used verbatim at execution.
  preview: ActionPreview,
  status: z.enum(AGENT_ACTION_STATUSES),
  origin: z.enum(["assistant", "system"]),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  createdAt: IsoDate,
  decidedAt: IsoDate.nullable(),
  executedAt: IsoDate.nullable(),
});
export type AgentAction = z.infer<typeof AgentAction>;
export const AgentActionRes = z.object({ action: AgentAction });
export const AgentActionListRes = z.object({ actions: z.array(AgentAction) });

export const AgentChatReq = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .min(1)
    .max(30),
});
export type AgentChatReq = z.infer<typeof AgentChatReq>;

export const ReconcileReport = z.object({
  periodStart: IsoDate,
  periodEnd: IsoDate,
  paypalTotalCents: Cents,
  recordedTotalCents: Cents,
  matchedCount: z.number().int(),
  mismatches: z.array(
    z.object({
      kind: z.enum(["missing_in_records", "missing_in_paypal", "amount_mismatch"]),
      paypalTransactionId: z.string().nullable(),
      donationId: Id.nullable(),
      paypalCents: Cents.nullable(),
      recordedCents: Cents.nullable(),
    }),
  ),
  ok: z.boolean(),
});
export type ReconcileReport = z.infer<typeof ReconcileReport>;

/** One JSON object per NDJSON line from POST /api/staff/agent/chat. */
export const AgentStreamEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), delta: z.string() }),
  z.object({ type: z.literal("tool_call"), tool: z.string(), summary: z.string() }), // "Checking PayPal transactions…"
  z.object({ type: z.literal("tool_result"), tool: z.string(), summary: z.string(), data: z.unknown().optional() }), // data = ReconcileReport when tool = "reconcile"
  z.object({ type: z.literal("action_proposed"), action: AgentAction }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("done") }),
]);
export type AgentStreamEvent = z.infer<typeof AgentStreamEvent>;

export const SponsorInvoiceView = z.object({
  id: Id,
  paypalInvoiceId: z.string().nullable(),
  recipientEmail: z.email(),
  recipientName: z.string().nullable(),
  needIds: z.array(Id),
  amountCents: Cents,
  status: z.enum(SPONSOR_INVOICE_STATUSES),
  payerViewUrl: z.url().nullable(),
  qrImageDataUrl: z.string().nullable(), // "data:image/png;base64,..."
  createdAt: IsoDate,
});
export const SponsorInvoiceListRes = z.object({ invoices: z.array(SponsorInvoiceView) });

// ---------- dashboard datasets (B) — NO personal data ----------
export const DatasetNeedRow = z.object({
  needId: Id,
  orgSlug: z.string(),
  orgName: z.string(),
  title: z.string(),
  category: Category,
  urgency: Urgency,
  status: NeedStatus,
  quantity: z.number().int(),
  unit: z.string(),
  retailer: z.string().nullable(),
  targetUsd: z.number(),
  fundedUsd: z.number(),
  createdAt: IsoDate,
  fundedAt: IsoDate.nullable(),
  orderedAt: IsoDate.nullable(),
  deliveredAt: IsoDate.nullable(),
  daysFundedToDelivered: z.number().nullable(),
  photoUrl: z.url().nullable(),
});
export const DatasetDonationRow = z.object({
  donationKey: z.string(), // HMAC of donation id — not reversible, no names/emails
  orgSlug: z.string(),
  amountUsd: z.number(),
  source: z.enum(DONATION_SOURCES),
  donatedAt: IsoDate,
  month: z.string(), // "2026-11"
});
export const DatasetAllocationRow = z.object({
  allocationId: Id,
  donationKey: z.string(),
  needId: Id,
  orgSlug: z.string(),
  category: Category,
  amountUsd: z.number(),
  reason: AllocationReason,
  allocatedAt: IsoDate,
  month: z.string(),
});
export const DatasetRes = z.object({
  name: z.enum(DATASETS),
  generatedAt: IsoDate,
  rows: z.union([z.array(DatasetNeedRow), z.array(DatasetDonationRow), z.array(DatasetAllocationRow)]),
});
export type DatasetRes = z.infer<typeof DatasetRes>;

// ---------- SSE ----------
export const NEED_UPDATED_EVENT = "need.updated" as const; // SSE `event:` name; `data:` is a NeedCard

// ---------- inferred types (added in 1.0.1; additive) ----------
export type OrgStats = z.infer<typeof OrgStats>;
export type OrgSummary = z.infer<typeof OrgSummary>;
export type OrgListRes = z.infer<typeof OrgListRes>;
export type NeedRes = z.infer<typeof NeedRes>;
export type DeliveryPublic = z.infer<typeof DeliveryPublic>;
export type FullyFundedDetails = z.infer<typeof FullyFundedDetails>;
export type AllocationPublic = z.infer<typeof AllocationPublic>;
export type ImpactItem = z.infer<typeof ImpactItem>;
export type MatchReq = z.infer<typeof MatchReq>;
export type StaffMeRes = z.infer<typeof StaffMeRes>;
export type StaffNeedListRes = z.infer<typeof StaffNeedListRes>;
export type PurchaseOffer = z.infer<typeof PurchaseOffer>;
export type PurchaseRes = z.infer<typeof PurchaseRes>;
export type MarkOrderedReq = z.infer<typeof MarkOrderedReq>;
export type DeliveryReq = z.infer<typeof DeliveryReq>;
export type ConfirmDeliveryReq = z.infer<typeof ConfirmDeliveryReq>;
export type CreateInvoiceArgs = z.infer<typeof CreateInvoiceArgs>;
export type SendInvoiceArgs = z.infer<typeof SendInvoiceArgs>;
export type CreateRefundArgs = z.infer<typeof CreateRefundArgs>;
export type ActionPreview = z.infer<typeof ActionPreview>;
export type AgentActionRes = z.infer<typeof AgentActionRes>;
export type AgentActionListRes = z.infer<typeof AgentActionListRes>;
export type SponsorInvoiceView = z.infer<typeof SponsorInvoiceView>;
export type SponsorInvoiceListRes = z.infer<typeof SponsorInvoiceListRes>;
export type DatasetNeedRow = z.infer<typeof DatasetNeedRow>;
export type DatasetDonationRow = z.infer<typeof DatasetDonationRow>;
export type DatasetAllocationRow = z.infer<typeof DatasetAllocationRow>;

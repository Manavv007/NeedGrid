// Type aliases for these enums (NeedStatus, Category, AllocationReason) are exported from schemas.ts via z.infer,
// so they are deliberately NOT exported here (avoids an `export *` name clash in index.ts).
export const NEED_STATUSES = ["draft", "open", "funded", "ordered", "delivered", "topping_up", "closed"] as const;

/** Statuses in which a need accepts donations. */
export const DONATABLE_STATUSES = ["open", "topping_up"] as const satisfies readonly (typeof NEED_STATUSES)[number][];

export const CATEGORIES = [
  "food",
  "hygiene",
  "baby",
  "clothing",
  "bedding",
  "school",
  "pet",
  "medical",
  "household",
  "other",
] as const;

/** 1 = low, 2 = medium, 3 = urgent. "Most urgent" ordering = urgency DESC, deadline_at ASC NULLS LAST, created_at ASC. */
export const URGENCY_MIN = 1;
export const URGENCY_MAX = 3;

export const RESERVATION_STATUSES = ["active", "converted", "released"] as const;
export const DONATION_SOURCES = ["order", "invoice", "seed"] as const;
export const DONATION_STATUSES = ["captured", "partially_refunded", "refunded"] as const;
export const ALLOCATION_REASONS = ["direct", "overflow", "price_drop", "rollover", "sponsor", "refund"] as const;

export const PURCHASE_STATUSES = ["proposed", "approved", "ordered", "rejected", "superseded"] as const;
export const SPONSOR_INVOICE_STATUSES = ["draft", "sent", "paid", "cancelled"] as const;

export const AGENT_ACTION_STATUSES = ["proposed", "approved", "rejected", "executed", "failed"] as const;
/** Money actions: ALWAYS need human approval. Executed only by the approve endpoint. */
export const MONEY_TOOLS = ["create_invoice", "send_invoice", "create_refund"] as const;
export type MoneyTool = (typeof MONEY_TOOLS)[number];
/** Read-only assistant tools: run immediately, no approval. */
export const READ_TOOLS = ["list_needs", "list_transactions", "reconcile"] as const;

export const DATASETS = ["needs", "donations", "allocations"] as const;
export type DatasetName = (typeof DATASETS)[number];

export const ERROR_CODES = [
  "VALIDATION",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "FULLY_FUNDED",
  "INVALID_STATE",
  "RATE_LIMITED",
  "UPSTREAM",
  "INTERNAL",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

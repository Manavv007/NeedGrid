# NeedGrid — Agent Brief A: Payments & Backend Lead

> **Give this file to your coding agent as its main instruction.** Also read `NEEDGRID_DEV_PLAN.md` for product context.
> If the two disagree: this file wins on *implementation details*, the plan wins on *scope and priorities*.
> Sibling briefs: `AGENT_B_AI_DATA.md` (AI & Data), `AGENT_C_FRONTEND.md` (Frontend & Demo). Sections 2–4 are identical in all three files.

---

## 0. Rules for the coding agent (read first)

1. **You work for Person A.** Only create or edit files in paths that §2 marks as **A**. If you need a change in someone else's path, stop and write the request into `HANDOFF.md` under the owner's heading (create the file if missing) instead of editing their code.
2. **Exception, Day 1 only:** task A-1 creates *stub* files inside B's folders (`apps/api/src/ai/**`, `apps/api/src/channel3/**`). After that PR merges, B owns them and you never edit them again.
3. **You own the contract** (`packages/shared`). Create it **verbatim** from §5. Later changes must be additive (new optional fields, new schemas) unless all three people agree. Bump `version` in `packages/shared/package.json` on every change and write one line in `packages/shared/CHANGELOG.md`.
4. **Don't trust your memory of third-party APIs.** Versions move fast. Before writing code against PayPal, Drizzle, Fastify, Neon or Render, check the current docs (APIMatic PayPal context plugin, Context7, official docs). Items marked **VERIFY** in this file were not confirmed against the live docs.
5. **Money code is sacred.** All amounts are integer cents. Never use floats, `parseFloat` or `toFixed` math on money. Only `packages/shared/src/money.ts` converts between cents and PayPal decimal strings.
6. Before every PR: `pnpm typecheck && pnpm lint && pnpm test` must pass. Keep PRs small (one task per PR).
7. Never commit secrets. Never print secret values in logs.
8. Pin dependencies exactly (`.npmrc` has `save-exact=true`).
9. Use made-up demo data only (no real people, emails or charities).

---

## 1. What we're building (one paragraph)

NeedGrid lets shelters, food banks, classrooms and animal rescues post the **exact items** they need. Staff photograph a shelf or a list; AI extracts items; Channel3 matches each to a real product and price; staff publish each as a **tile** with a funding target. Donors fund tiles through **PayPal**; progress bars fill live. When a tile is funded, AI re-checks the price and proposes a purchase; staff approve it. When the item arrives, staff upload a photo; AI verifies it; the donor's impact page shows "your item arrived". A staff **AI assistant** handles PayPal invoices/refunds/reconciliation with **human approval** for every money action. A public **AG Studio** dashboard lets anyone ask "what did November's donations buy?". Hackathon: PayPal AI Hackathon, submit **Wed Nov 11**, judged Dec 1–15 on the live URL.

---

## 2. Ownership map (identical in all three briefs)

| Path | Owner | Notes |
|---|---|---|
| `/` root config: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`, `.npmrc`, `.gitignore`, `.env.example`, `render.yaml`, `.github/**`, `README.md`, `LICENSE` | **A** | Others request changes via `HANDOFF.md` |
| `packages/shared/**` (the API contract + money helpers) | **A** | B and C may open a PR here only with A as reviewer |
| `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/drizzle.config.ts`, `apps/api/drizzle/**` (migrations) | **A** | Only A generates migrations |
| `apps/api/src/{server.ts,app.ts,env.ts}` | **A** | |
| `apps/api/src/{db,core,routes,money,paypal,webhooks,jobs,agent,lib,plugins}/**` | **A** | `core/` = functions B is allowed to call for writes |
| `apps/api/src/ai/**` | **B** | Includes B's Fastify route plugin `ai/plugin.ts` |
| `apps/api/src/channel3/**` | **B** | |
| `apps/api/scripts/seed/**`, `apps/api/src/ai/evals/**` | **B** | Seed + prompt test fixtures |
| `apps/web/**` | **C** | Except the next row |
| `apps/web/src/dashboard/**` | **B** | C's router lazy-loads `src/dashboard/DashboardPage.tsx` (default export) |
| `apps/web/src/mocks/**` | **C** | MSW mocks for every endpoint, including B's |
| `docs/**`, demo video, Devpost write-up | **C** | Each lead writes their own section |
| `HANDOFF.md` | everyone | Append only, under the owner's heading |

**Dependency installs:** to avoid lockfile fights, A installs all known API dependencies (including B's: `ai`, `@ai-sdk/google`, `@channel3/sdk`) in task A-1, and C installs all known web dependencies (including B's: `ag-studio`, `ag-studio-react`) in task C-1. If a lockfile conflict happens anyway: take `main`'s `pnpm-lock.yaml`, re-run `pnpm install`, commit.

---

## 3. Team-wide conventions (identical in all three briefs)

- **Stack:** Node 22 LTS, pnpm workspaces, TypeScript strict, ESM (`"type": "module"`) everywhere, `moduleResolution: "Bundler"`.
- **Packages:** `@needgrid/shared` (`packages/shared`), `@needgrid/api` (`apps/api`), `@needgrid/web` (`apps/web`). `@needgrid/shared` is consumed as **TypeScript source** (no build step): its `package.json` `exports` points at `./src/index.ts`. Vite and tsx read it directly; the API production build bundles it with tsup.
- **Validation:** zod **v4** (`import { z } from "zod"`). Every request body, query and response is defined in `@needgrid/shared` and parsed with `.parse()` at the boundary. The web app parses responses too (catches contract drift instantly).
- **Money:** integer cents (`*Cents` fields). The only places dollars appear: PayPal API strings (converted in `money.ts`), UI display (`formatUsd`), dashboard datasets (`*Usd` display fields).
- **IDs:** UUID v4 for all our rows. PayPal IDs are strings stored as-is.
- **Dates:** ISO 8601 strings in UTC over the wire (`new Date().toISOString()`).
- **Errors:** every non-2xx JSON response is `{ "error": { "code": ErrorCode, "message": string, "details"?: unknown } }` (`ApiError` schema). Codes: `VALIDATION, UNAUTHORIZED, NOT_FOUND, FULLY_FUNDED, INVALID_STATE, RATE_LIMITED, UPSTREAM, INTERNAL`.
- **Staff auth (demo-grade):** header `x-staff-key: <passcode>`. The API hashes it (SHA-256, lowercase hex of the UTF-8 passcode) and looks up the organization whose `staff_key_hash` matches. No match → `401 UNAUTHORIZED`. The web app stores the key in `sessionStorage` under `needgrid.staffKey`.
- **Live updates:** Server-Sent Events at `GET /api/orgs/:slug/stream`, event name `need.updated`, `data` = a `NeedCard` JSON. Heartbeat comment every 25 s.
- **Assistant streaming:** `POST /api/staff/agent/chat` returns **NDJSON** (`application/x-ndjson`), one `AgentStreamEvent` JSON per line. Not the AI SDK's own UI protocol, so the frontend doesn't depend on the AI SDK version.
- **Images:** the browser uploads directly to Cloudinary (unsigned upload preset) and sends the resulting `https://res.cloudinary.com/<cloud>/...` URL to the API. The API **rejects any image URL not on that host** (prevents SSRF).
- **Git:** `main` is protected and auto-deploys. Branches `feat/<area>-<thing>` / `fix/<area>-<thing>`. One approving review (reviewer pairs: B reviews A, A reviews B's backend, C reviews B's dashboard, B reviews C), CI green, squash-merge. Review within 12 h.
- **Commits:** conventional style (`feat(api): capture endpoint`).
- **Mock-first:** C builds against MSW mocks generated from the shared schemas, so no one waits on anyone. Set `VITE_USE_MOCKS=true` to use them.
- **Demo orgs (seeded by B):** `harbor-food-bank` (food bank), `second-chance-paws` (animal rescue), `room-12-readers` (classroom). Demo staff passcodes: `harbor-demo-2026`, `paws-demo-2026`, `room12-demo-2026`. These are public by design (judges use them) and only ever touch the PayPal **sandbox**.

---

## 4. API endpoint table (identical in all three briefs)

Request/response type names refer to zod schemas in `packages/shared/src/schemas.ts` (full code in §5 of `AGENT_A_BACKEND.md`). "Staff" = requires `x-staff-key`.

| Method & path | Auth | Request → Response | Owner |
|---|---|---|---|
| `GET /api/health` | public | → `{ ok: true, db: boolean }` | A |
| `GET /api/orgs` | public | → `OrgListRes` | A |
| `GET /api/orgs/:slug` | public | → `OrgPageRes` | A |
| `GET /api/orgs/:slug/stream` | public | SSE `need.updated` → `NeedCard` | A |
| `GET /api/needs/:id` | public | → `NeedDetailRes` | A |
| `POST /api/donations/orders` | public, rate-limited | `CreateOrderReq` → `CreateOrderRes`; `409 FULLY_FUNDED` with `details: FullyFundedDetails` | A |
| `POST /api/donations/orders/:orderId/capture` | public | `{}` → `CaptureRes` (idempotent) | A |
| `GET /api/impact/:token` | public | → `ImpactRes` | A |
| `POST /api/match` | public, rate-limited | `MatchReq` → `MatchRes` (P1) | B |
| `GET /api/dashboard/datasets/:name` | public | → `DatasetRes` (`name` ∈ `needs, donations, allocations`) | B |
| `POST /api/ai/dashboard-complete` | public, rate-limited | B-internal format (AG Studio adapter ↔ relay) | B |
| `POST /api/webhooks/paypal` | PayPal | PayPal event → `200` | A |
| `GET /api/staff/me` | staff | → `StaffMeRes` | A |
| `GET /api/staff/needs?status=` | staff | → `StaffNeedListRes` (includes drafts) | A |
| `GET /api/staff/needs/:id` | staff | → `StaffNeedDetailRes` | A |
| `POST /api/staff/intake` | staff, rate-limited | `IntakeReq` → `IntakeRes` (nothing saved) | B |
| `POST /api/staff/needs` | staff | `PublishNeedReq` → `NeedRes` | A |
| `PATCH /api/staff/needs/:id` | staff | `PatchNeedReq` → `NeedRes` | A |
| `POST /api/staff/needs/:id/purchase-plan` | staff | `{}` → `PurchasePlanRes` | B |
| `POST /api/staff/purchases/:id/approve` | staff | `{}` → `ApprovePurchaseRes` | A |
| `POST /api/staff/purchases/:id/ordered` | staff | `MarkOrderedReq` → `PurchaseRes` | A |
| `POST /api/staff/needs/:id/delivery` | staff | `DeliveryReq` → `DeliveryRes` | B |
| `POST /api/staff/deliveries/:id/confirm` | staff | `ConfirmDeliveryReq` → `DeliveryRes` | B |
| `POST /api/staff/agent/chat` | staff, rate-limited | `AgentChatReq` → NDJSON stream of `AgentStreamEvent` | B |
| `GET /api/staff/agent/actions?status=` | staff | → `AgentActionListRes` | A |
| `POST /api/staff/agent/actions/:id/approve` | staff | `{}` → `AgentActionRes` | A |
| `POST /api/staff/agent/actions/:id/reject` | staff | `{}` → `AgentActionRes` | A |
| `GET /api/staff/invoices` | staff | → `SponsorInvoiceListRes` | A |

Need status machine (only A's `core/needs.ts` changes `needs.status`):

```
draft ──publish──► open ──funded ≥ target──► funded ──mark ordered──► ordered ──delivery ok──► delivered
                                               │  ▲
              purchase approved on a PRICIER   │  │ funded ≥ new target
              offer: target raised             ▼  │
                                             topping_up   (accepts donations like `open`)
any status except delivered ──staff closes──► closed
```

- Donations are accepted only in `open` and `topping_up`.
- A purchase can be approved only while the need is `funded`. Approving a cheaper or same-price offer keeps it `funded`; approving a pricier offer moves it to `topping_up`.
- "Mark ordered" requires need `funded` **and** a purchase in `approved`.
- Delivery requires `ordered`.



---

## 5. The shared contract — `packages/shared` v1 (create VERBATIM in task A-1)

B and C build against exactly these names. Do not rename anything. Additive changes later only (see §0 rule 3).

### 5.1 `packages/shared/package.json`

```json
{
  "name": "@needgrid/shared",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "zod": "<pin current 4.x>" },
  "devDependencies": { "typescript": "<pin>", "vitest": "<pin>" }
}
```

### 5.2 `packages/shared/src/enums.ts`

```ts
// Type aliases for these enums (NeedStatus, Category, AllocationReason) are exported from schemas.ts via z.infer,
// so they are deliberately NOT exported here (avoids an `export *` name clash in index.ts).
export const NEED_STATUSES = ["draft", "open", "funded", "ordered", "delivered", "topping_up", "closed"] as const;

/** Statuses in which a need accepts donations. */
export const DONATABLE_STATUSES = ["open", "topping_up"] as const satisfies readonly (typeof NEED_STATUSES)[number][];

export const CATEGORIES = [
  "food", "hygiene", "baby", "clothing", "bedding", "school", "pet", "medical", "household", "other",
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
  "VALIDATION", "UNAUTHORIZED", "NOT_FOUND", "FULLY_FUNDED", "INVALID_STATE", "RATE_LIMITED", "UPSTREAM", "INTERNAL",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
```

### 5.3 `packages/shared/src/money.ts`

```ts
/** All money is integer cents. This file is the ONLY place that converts to/from decimal strings. */

export const TARGET_BUFFER_BPS = 800; // +8% for tax & shipping
export const MIN_DONATION_CENTS = 100; // $1 (a smaller remaining amount may still be donated to finish a tile)
export const MAX_DONATION_CENTS = 100_000; // $1,000 per checkout in the demo
export const HOLD_MINUTES = 15;
export const DELIVERY_MATCH_THRESHOLD = 0.6; // below → needs human review

export function assertCents(n: number, label = "amount"): number {
  if (!Number.isSafeInteger(n)) throw new Error(`${label} must be an integer number of cents, got ${n}`);
  return n;
}

/** unit × quantity, +8%, rounded UP to the whole dollar. Example: 2 × 3849 → 7698 → 8313.84 → 8314 → 8400. */
export function computeTargetCents(unitPriceCents: number, quantity: number, bufferBps = TARGET_BUFFER_BPS): number {
  assertCents(unitPriceCents, "unitPriceCents");
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error("quantity must be a positive integer");
  const raw = unitPriceCents * quantity;
  const buffered = Math.ceil((raw * (10_000 + bufferBps)) / 10_000);
  return Math.ceil(buffered / 100) * 100;
}

export function remainingCents(n: { targetCents: number; fundedCents: number; heldCents: number }): number {
  return Math.max(0, n.targetCents - n.fundedCents - n.heldCents);
}

/** Rule 3: amount = min(requested, remaining). Returns null when nothing is left. */
export function clampDonation(requestedCents: number, remaining: number): { amountCents: number; wasClamped: boolean } | null {
  assertCents(requestedCents, "requestedCents");
  if (remaining <= 0) return null;
  const amountCents = Math.min(requestedCents, remaining);
  return { amountCents, wasClamped: amountCents < requestedCents };
}

/** Rule 6: at capture time, split the captured amount into what still fits the tile and the overflow. */
export function splitCapture(capturedCents: number, roomNowCents: number): { directCents: number; overflowCents: number } {
  assertCents(capturedCents, "capturedCents");
  const directCents = Math.max(0, Math.min(capturedCents, roomNowCents));
  return { directCents, overflowCents: capturedCents - directCents };
}

export type PurchaseMoney =
  | { kind: "exact" }
  | { kind: "surplus"; cents: number } // cheaper: move surplus to the next need (price_drop)
  | { kind: "gap"; cents: number }; // pricier: raise target, need goes to topping_up

/** Rule 7. newTargetCents = computeTargetCents(newUnitPrice, quantity). */
export function planPurchaseMoney(fundedCents: number, newTargetCents: number): PurchaseMoney {
  assertCents(fundedCents, "fundedCents");
  assertCents(newTargetCents, "newTargetCents");
  if (fundedCents === newTargetCents) return { kind: "exact" };
  if (fundedCents > newTargetCents) return { kind: "surplus", cents: fundedCents - newTargetCents };
  return { kind: "gap", cents: newTargetCents - fundedCents };
}

/**
 * Deterministically take `amountCents` back out of a need's existing positive allocations,
 * newest donation first. Used for price_drop surplus moves and refunds so that every
 * donation's allocations still sum to what that donation paid.
 */
export function takeFromAllocations(
  allocations: ReadonlyArray<{ donationId: string; amountCents: number; createdAt: string }>,
  amountCents: number,
): Array<{ donationId: string; amountCents: number }> {
  assertCents(amountCents);
  const byDonation = new Map<string, { net: number; latest: string }>();
  for (const a of allocations) {
    const cur = byDonation.get(a.donationId) ?? { net: 0, latest: a.createdAt };
    cur.net += a.amountCents;
    if (a.createdAt > cur.latest) cur.latest = a.createdAt;
    byDonation.set(a.donationId, cur);
  }
  const ordered = [...byDonation.entries()]
    .filter(([, v]) => v.net > 0)
    .sort((x, y) => (x[1].latest < y[1].latest ? 1 : x[1].latest > y[1].latest ? -1 : x[0] < y[0] ? -1 : 1));
  const out: Array<{ donationId: string; amountCents: number }> = [];
  let left = amountCents;
  for (const [donationId, v] of ordered) {
    if (left === 0) break;
    const take = Math.min(left, v.net);
    out.push({ donationId, amountCents: take });
    left -= take;
  }
  if (left !== 0) throw new Error("takeFromAllocations: not enough allocated money");
  return out;
}

/** 8400 → "84.00" (PayPal amount.value). */
export function centsToPayPalValue(cents: number): string {
  assertCents(cents);
  if (cents < 0) throw new Error("negative amount");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** "84.00" | "84.5" | "84" → 8400 | 8450 | 8400. No float math. */
export function payPalValueToCents(value: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) throw new Error(`invalid money string: ${value}`);
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** Dollars from an external API (e.g. Channel3 returns 38.49). Boundary use only. */
export function dollarsToCents(dollars: number): number {
  if (!Number.isFinite(dollars) || dollars < 0) throw new Error(`invalid dollars: ${dollars}`);
  return Math.round(dollars * 100);
}

/** Display only. Dashboard datasets use this for *Usd fields. */
export function centsToUsdNumber(cents: number): number {
  return Math.round(cents) / 100;
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
```

Required unit tests (`packages/shared/src/money.test.ts`): the $84 example; rounding when already a whole dollar (e.g. 1000 × 1 → 1080 → 1100); `clampDonation` null at 0, clamps above remaining, passes small remaining (e.g. 50); `splitCapture` with room 0, partial, full; `planPurchaseMoney` all 3 kinds; `takeFromAllocations` newest-first, multi-donation split, throws when short; `centsToPayPalValue(5)` → `"0.05"`; `payPalValueToCents` rejects `"1.234"`, `"-1"`, `"abc"`.


### 5.4 `packages/shared/src/schemas.ts`

```ts
import { z } from "zod";
import {
  AGENT_ACTION_STATUSES, ALLOCATION_REASONS, CATEGORIES, DATASETS, DONATION_SOURCES, ERROR_CODES,
  MONEY_TOOLS, NEED_STATUSES, PURCHASE_STATUSES, SPONSOR_INVOICE_STATUSES, URGENCY_MAX, URGENCY_MIN,
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

export const OrgStats = z.object({ raisedCents: Cents, itemsFunded: z.number().int(), itemsDelivered: z.number().int(), openNeeds: z.number().int() });
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

export const NeedDetailRes = z.object({ need: NeedCard, org: OrgPublic, timeline: z.array(TimelineEvent), delivery: DeliveryPublic.nullable() });
export type NeedDetailRes = z.infer<typeof NeedDetailRes>;

// ---------- donations ----------
export const CreateOrderReq = z.object({
  needId: Id,
  amountCents: Cents.min(MIN_DONATION_CENTS).max(MAX_DONATION_CENTS),
  /** One checkbox, ticked by default: "If this item is already covered, send my gift to the next most urgent need." Covers overflow AND roll-over. */
  rollOverConsent: z.boolean().default(true),
});
export type CreateOrderReq = z.infer<typeof CreateOrderReq>;

export const CreateOrderRes = z.object({ orderId: z.string(), amountCents: Cents, wasClamped: z.boolean(), holdExpiresAt: IsoDate });
export type CreateOrderRes = z.infer<typeof CreateOrderRes>;

/** Sent in ApiError.details when code = FULLY_FUNDED. */
export const FullyFundedDetails = z.object({ nextNeed: NeedCard.nullable() });

export const AllocationPublic = z.object({ needId: Id, needTitle: z.string(), amountCents: Cents, reason: AllocationReason });
export const CaptureRes = z.object({ donationId: Id, impactToken: z.string(), amountCents: Cents, allocations: z.array(AllocationPublic) });
export type CaptureRes = z.infer<typeof CaptureRes>;

export const ImpactItem = z.object({
  need: NeedCard,
  orgName: z.string(),
  amountCents: Cents, // net amount this donation contributed to this need
  reason: AllocationReason,
  timeline: z.array(TimelineEvent),
  delivery: DeliveryPublic.nullable(),
});
export const ImpactRes = z.object({ donorFirstName: z.string().nullable(), totalCents: Cents, donatedAt: IsoDate, items: z.array(ImpactItem) });
export type ImpactRes = z.infer<typeof ImpactRes>;

// ---------- match me (P1, B) ----------
export const MatchReq = z.object({ text: z.string().trim().min(3).max(300), budgetCents: Cents.min(MIN_DONATION_CENTS).max(MAX_DONATION_CENTS) });
export const MatchRes = z.object({ matches: z.array(z.object({ need: NeedCard, orgName: z.string(), reason: z.string() })).max(3) });
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
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).min(1).max(30),
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
  needId: Id, orgSlug: z.string(), orgName: z.string(), title: z.string(), category: Category, urgency: Urgency,
  status: NeedStatus, quantity: z.number().int(), unit: z.string(), retailer: z.string().nullable(),
  targetUsd: z.number(), fundedUsd: z.number(),
  createdAt: IsoDate, fundedAt: IsoDate.nullable(), orderedAt: IsoDate.nullable(), deliveredAt: IsoDate.nullable(),
  daysFundedToDelivered: z.number().nullable(), photoUrl: z.url().nullable(),
});
export const DatasetDonationRow = z.object({
  donationKey: z.string(), // HMAC of donation id — not reversible, no names/emails
  orgSlug: z.string(), amountUsd: z.number(), source: z.enum(DONATION_SOURCES), donatedAt: IsoDate, month: z.string(), // "2026-11"
});
export const DatasetAllocationRow = z.object({
  allocationId: Id, donationKey: z.string(), needId: Id, orgSlug: z.string(), category: Category,
  amountUsd: z.number(), reason: AllocationReason, allocatedAt: IsoDate, month: z.string(),
});
export const DatasetRes = z.object({
  name: z.enum(DATASETS),
  generatedAt: IsoDate,
  rows: z.union([z.array(DatasetNeedRow), z.array(DatasetDonationRow), z.array(DatasetAllocationRow)]),
});
export type DatasetRes = z.infer<typeof DatasetRes>;

// ---------- SSE ----------
export const NEED_UPDATED_EVENT = "need.updated" as const; // SSE `event:` name; `data:` is a NeedCard
```

### 5.5 `packages/shared/src/api.ts`

```ts
export const STAFF_KEY_HEADER = "x-staff-key";
export const STAFF_KEY_STORAGE = "needgrid.staffKey";

export const paths = {
  health: "/api/health",
  orgs: "/api/orgs",
  org: (slug: string) => `/api/orgs/${encodeURIComponent(slug)}`,
  orgStream: (slug: string) => `/api/orgs/${encodeURIComponent(slug)}/stream`,
  need: (id: string) => `/api/needs/${id}`,
  createOrder: "/api/donations/orders",
  captureOrder: (orderId: string) => `/api/donations/orders/${encodeURIComponent(orderId)}/capture`,
  impact: (token: string) => `/api/impact/${encodeURIComponent(token)}`,
  match: "/api/match",
  dataset: (name: string) => `/api/dashboard/datasets/${name}`,
  dashboardComplete: "/api/ai/dashboard-complete",
  staff: {
    me: "/api/staff/me",
    needs: "/api/staff/needs",
    need: (id: string) => `/api/staff/needs/${id}`,
    intake: "/api/staff/intake",
    purchasePlan: (needId: string) => `/api/staff/needs/${needId}/purchase-plan`,
    approvePurchase: (purchaseId: string) => `/api/staff/purchases/${purchaseId}/approve`,
    markOrdered: (purchaseId: string) => `/api/staff/purchases/${purchaseId}/ordered`,
    delivery: (needId: string) => `/api/staff/needs/${needId}/delivery`,
    confirmDelivery: (deliveryId: string) => `/api/staff/deliveries/${deliveryId}/confirm`,
    agentChat: "/api/staff/agent/chat",
    actions: "/api/staff/agent/actions",
    approveAction: (id: string) => `/api/staff/agent/actions/${id}/approve`,
    rejectAction: (id: string) => `/api/staff/agent/actions/${id}/reject`,
    invoices: "/api/staff/invoices",
  },
} as const;
```

### 5.6 `packages/shared/src/index.ts`

```ts
export * from "./enums";
export * from "./money";
export * from "./schemas";
export * from "./api";
```

> If `pnpm typecheck` reports a problem in these files (for example a zod v4 API rename), fix it with the **smallest change that keeps every exported name and field identical**, and note it in `packages/shared/CHANGELOG.md`.

---

## 6. Database (Neon Postgres + Drizzle) — A owns schema and migrations

**Driver: use `pg` (node-postgres) with `drizzle-orm/node-postgres`.** The API needs interactive transactions with `SELECT … FOR UPDATE`; Neon's HTTP driver can't do that. Use Neon's **pooled** connection string in `DATABASE_URL`. Migrations: `drizzle-kit generate` → SQL committed in `apps/api/drizzle/`; `drizzle-kit migrate` (or drizzle's migrator) runs in the Render build. The first migration must run `CREATE EXTENSION IF NOT EXISTS vector;` and `CREATE EXTENSION IF NOT EXISTS pgcrypto;`.

All money columns are `integer` cents. All timestamps `timestamptz` default `now()`. All ids `uuid` default `gen_random_uuid()`.

| Table | Columns (✱ = unique) | Indexes / notes |
|---|---|---|
| `organizations` | id, slug✱, name, city, description, cause_tags `text[]`, logo_url null, payee_email null (P2), staff_key_hash✱ (hex SHA-256), created_at | |
| `needs` | id, org_id→organizations, title, description, category, urgency `smallint` (1–3, CHECK), quantity int (CHECK >0), unit, status (CHECK in NEED_STATUSES), target_cents int, funded_cents int default 0 (CHECK ≥0), product `jsonb` null (ProductSnapshot), alternatives `jsonb` default `[]`, deadline_at null, embedding `vector(768)` null, funded_at null, ordered_at null, delivered_at null, closed_at null, created_at, updated_at | (org_id, status), (status, urgency DESC); HNSW or ivfflat on embedding (cosine) is optional (≤200 rows: seq scan is fine) |
| `reservations` | id, need_id→needs, paypal_order_id✱ null (set right after PayPal create), sponsor_invoice_id null→sponsor_invoices (sponsor holds), amount_cents, roll_over_consent bool, expires_at, status (active/converted/released), created_at | (need_id, status, expires_at). A hold counts only while `status = 'active' AND expires_at > now()` |
| `donations` | id, org_id, paypal_order_id✱ null, capture_id✱ null, sponsor_invoice_id null→sponsor_invoices, amount_cents, refunded_cents default 0, unallocated_cents default 0 (money with nowhere to go, awaiting a refund), donor_name null, donor_email null, roll_over_consent bool, source (order/invoice/seed), status (captured/partially_refunded/refunded), impact_token✱, created_at | **donor_name / donor_email are personal data: never returned by public endpoints except donor first name on their own impact page** |
| `allocations` | id, donation_id→donations, need_id→needs, amount_cents int (**signed**: negative = money moved out), reason, related_allocation_id null (pairs a −/+ move), created_at | (need_id), (donation_id) |
| `purchases` | id, need_id, offer `jsonb` (PurchaseOffer), new_target_cents, explanation, flags `text[]`, status, order_ref null, approved_at, ordered_at, created_at | at most one `approved` per need (partial unique index) |
| `deliveries` | id, need_id, photo_url, match_score `real`, ai_notes, needs_review bool, message null, confirmed_at null, created_at | |
| `sponsor_invoices` | id, org_id, paypal_invoice_id✱ null, recipient_email, recipient_name null, need_ids `uuid[]`, planned `jsonb` ([{needId, amountCents}]), amount_cents, status, payer_view_url null, qr_image_data_url null, paid_at null, created_at | |
| `agent_actions` | id, org_id, tool, args `jsonb`, computed `jsonb`, preview `jsonb`, status, origin (assistant/system), result `jsonb` null, error null, created_at, decided_at, executed_at | audit log; never deleted |
| `webhook_events` | id, paypal_event_id✱, type, payload `jsonb`, verified bool, processed_at null, error null, created_at | |

**Invariants (write `apps/api/src/money/invariants.ts` + script `pnpm --filter @needgrid/api check:money` that asserts them and exits non-zero on failure):**
1. For every need: `funded_cents = SUM(allocations.amount_cents WHERE need_id)`.
2. For every donation: `SUM(allocations.amount_cents WHERE donation_id) + unallocated_cents = amount_cents − refunded_cents`.
3. No need in `open`/`topping_up`/`funded` has `funded_cents > target_cents`, except the documented "no next need" case in §8.5 (logged as a warning, not an error).
4. `funded_cents` is updated **only** inside the same transaction that inserts the allocation rows.

---

## 7. Backend layout and the interfaces you provide

```
apps/api/
├─ package.json            # scripts: dev (tsx watch src/server.ts), build (tsup), start (node dist/server.js),
│                          #          typecheck, test, db:generate, db:migrate, check:money,
│                          #          seed (tsx scripts/seed/index.ts), evals (tsx src/ai/evals/run.ts), job:rollover
├─ tsup.config.ts          # entry src/server.ts, format esm, target node22, noExternal ["@needgrid/shared"]
├─ drizzle.config.ts
├─ drizzle/                # generated SQL migrations (A only)
├─ scripts/seed/           # B
└─ src/
   ├─ server.ts            # listen on PORT
   ├─ app.ts               # buildApp(): registers plugins + all route plugins (incl. B's aiPlugin) — testable with app.inject
   ├─ env.ts               # zod-validated process.env; fail fast on missing required vars
   ├─ db/{client.ts,schema.ts,index.ts}
   ├─ lib/{errors.ts,http.ts,events.ts,ids.ts,logger.ts}
   ├─ plugins/{cors.ts,rateLimit.ts,staffAuth.ts,errorHandler.ts}
   ├─ money/{donations.ts,capture.ts,overflow.ts,purchases.ts,refunds.ts,invariants.ts,*.test.ts}
   ├─ paypal/{client.ts,orders.ts,invoices.ts,webhooks.ts,transactions.ts,toolkit.ts}
   ├─ agent/{actions.ts,previews.ts,executors.ts}
   ├─ core/{index.ts,needs.ts,purchases.ts,deliveries.ts,orgs.ts}   # the ONLY write API for B
   ├─ routes/{public.ts,donations.ts,impact.ts,staff.ts,actions.ts,invoices.ts}
   ├─ webhooks/paypal.ts
   ├─ jobs/{releaseHolds.ts,rollover.ts}
   ├─ ai/       # B (you create stubs on Day 1, see 7.3)
   └─ channel3/ # B (stub on Day 1)
```

Libraries: `fastify`, `@fastify/cors`, `@fastify/rate-limit`, `fastify-plugin` (wrap `staffAuth`, `errorHandler`, `cors`, `rateLimit` with it so decorators reach every route plugin, including B's), `drizzle-orm`, `pg`, `zod`, `pino` (Fastify's logger). Dev: `tsx`, `tsup`, `drizzle-kit`, `vitest`, `@types/pg`. Validate with zod manually in handlers (`Schema.parse(req.body)`), no type-provider plugin needed. A ZodError → `400 VALIDATION` in the error handler.

`package.json` must also expose `"exports": { "./db": "./src/db/index.ts", "./core": "./src/core/index.ts" }` so B's seed script can import the schema and client.

### 7.1 Fastify decorations (in `plugins/staffAuth.ts`)

```ts
declare module "fastify" {
  interface FastifyInstance {
    requireStaff: (req: FastifyRequest, reply: FastifyReply) => Promise<void>; // preHandler
  }
  interface FastifyRequest {
    staffOrg?: { id: string; slug: string; name: string }; // set by requireStaff
  }
}
```

Also export from `lib/http.ts`:
```ts
export class HttpError extends Error { constructor(public status: number, public code: ErrorCode, message: string, public details?: unknown) }
export function sendNdjson(reply: FastifyReply): { write(ev: AgentStreamEvent): void; end(): void } // sets headers, flushes per line
export function assertCloudinaryUrl(url: string): void // throws 400 VALIDATION unless https://res.cloudinary.com/<CLOUDINARY cloud name>/...
```

### 7.2 `apps/api/src/core/index.ts` — functions B may call (signatures are a contract)

```ts
import type { NeedCard, PurchaseOffer, PurchaseView, DeliveryView, AgentAction, MoneyTool } from "@needgrid/shared";

export function getNeedCard(needId: string): Promise<NeedCard | null>;
export function getNeedCards(needIds: string[]): Promise<NeedCard[]>;
/** Open/topping_up needs with remainingCents > 0, most urgent first. orgId undefined = all orgs. */
export function listDonatableNeeds(opts: { orgId?: string; limit?: number }): Promise<NeedCard[]>;
export function getNextMostUrgentNeed(orgId: string, excludeNeedId?: string): Promise<NeedCard | null>;
export function setNeedEmbedding(needId: string, embedding: number[]): Promise<void>; // 768 dims

/** Inserts a purchases row (status proposed) and marks older proposed rows for that need `superseded`. Need must be `funded`. */
export function createProposedPurchase(input: {
  needId: string; offer: PurchaseOffer; explanation: string; flags: string[];
}): Promise<PurchaseView>; // computes newTargetCents itself

/** Inserts a delivery row. If !needsReview → need becomes `delivered` (+ delivered_at) and SSE is published. Need must be `ordered`. */
export function recordDelivery(input: {
  needId: string; photoUrl: string; matchScore: number; aiNotes: string; needsReview: boolean; message: string | null;
}): Promise<{ delivery: DeliveryView; need: NeedCard }>;
export function confirmDelivery(deliveryId: string, orgId: string, message?: string): Promise<{ delivery: DeliveryView; need: NeedCard }>;

/** Validates args with MONEY_TOOL_ARGS[tool], checks every referenced id belongs to orgId, computes amounts
 *  into `computed`, builds `preview`, inserts agent_actions (status proposed). NEVER calls PayPal. Throws HttpError on bad input. */
export function proposeAction(input: { orgId: string; tool: MoneyTool; args: unknown; origin: "assistant" | "system" }): Promise<AgentAction>;

/** Read-only PayPal Transaction Search for the reconcile tool. Max 31-day window (PayPal limit). */
export function listPayPalTransactions(input: { start: Date; end: Date }): Promise<Array<{
  transactionId: string; status: string; amountCents: number; currency: string; at: string;
  invoiceId: string | null; customField: string | null; eventCode: string;
}>>;

/** Donations recorded by us in a window (for reconcile). Excludes source = "seed". */
export function listRecordedDonations(input: { orgId: string; start: Date; end: Date }): Promise<Array<{
  donationId: string; captureId: string | null; paypalInvoiceId: string | null; amountCents: number; at: string;
}>>;

export function publishNeedUpdated(needId: string): Promise<void>; // SSE fan-out
export { db } from "../db/client";
export * as schema from "../db/schema";
```

Ship these as **working-but-simple implementations or explicit `throw new Error("not implemented: <name>")` stubs** in task A-1 so B can code against them on day one. Fill them in per §9.

### 7.3 Day-1 stubs you create in B's folders (then hand over)

```ts
// apps/api/src/ai/index.ts  — B will implement; A's code imports ONLY from this file
import type { NeedCard } from "@needgrid/shared";
/** Embedding for Match me. Must never throw: return null on any failure. */
export async function embedNeedText(_need: Pick<NeedCard, "title" | "description" | "category" | "unit">): Promise<number[] | null> {
  return null;
}
/** Warm 2-line donor update from a staff note. Must never throw: return the input on failure. */
export async function writeImpactNote(staffNote: string, _needTitle: string): Promise<string> {
  return staffNote;
}
```

```ts
// apps/api/src/ai/plugin.ts — B's routes live behind this plugin. A registers it once in app.ts and never edits it.
import type { FastifyPluginAsync } from "fastify";
export const aiPlugin: FastifyPluginAsync = async (_app) => {
  // B registers: POST /api/staff/intake, POST /api/staff/needs/:id/purchase-plan, POST /api/staff/needs/:id/delivery,
  // POST /api/staff/deliveries/:id/confirm, POST /api/staff/agent/chat, POST /api/match,
  // GET /api/dashboard/datasets/:name, POST /api/ai/dashboard-complete
};
```

```ts
// apps/api/src/channel3/index.ts — B
export {};
```

In `app.ts`: `await app.register(aiPlugin)` **after** CORS, rate-limit and staffAuth are registered, so B can use `app.requireStaff` and `config: { rateLimit: … }` on routes. Register `@fastify/rate-limit` with `global: false` and use per-route limits.

---

## 8. Money flows — exact algorithms (code review checks these line by line)

### 8.1 PayPal client (`paypal/client.ts`)

- Base URL: `https://api-m.sandbox.paypal.com` when `PAYPAL_ENV=sandbox`, else `https://api-m.paypal.com`.
- OAuth2 client-credentials (`POST /v1/oauth2/token`, basic auth, `grant_type=client_credentials`). Cache the token until 60 s before `expires_in`.
- `paypalFetch(method, path, { body, requestId })`: JSON in/out, header `Prefer: return=representation`, **`PayPal-Request-Id` on every POST** (caller passes a deterministic id). Retry 429/5xx/network errors up to 3 times with 250 ms × 2ⁿ backoff (same request id). On 401 refresh the token once. Throw `HttpError(502, "UPSTREAM", …)` with PayPal's `debug_id` in `details` (never log the request body of auth calls).
- **VERIFY** every PayPal request/response field below with the APIMatic PayPal plugin before coding.

### 8.2 Create order — `POST /api/donations/orders` (rules 1, 3, 9)

```
parse CreateOrderReq
TX1:
  need = SELECT … FROM needs WHERE id = $needId FOR UPDATE           -- 404 if missing
  if need.status ∉ DONATABLE_STATUSES → 409 FULLY_FUNDED { nextNeed: getNextMostUrgentNeed(org, need.id) }
  held = SUM(amount_cents) FROM reservations WHERE need_id AND status='active' AND expires_at > now()
  r = clampDonation(req.amountCents, remainingCents({target, funded, held}))
  if r == null → 409 FULLY_FUNDED { nextNeed }
  reservation = INSERT reservations(need_id, amount_cents=r.amountCents, roll_over_consent, expires_at=now()+HOLD, status='active')
COMMIT                                       -- never hold the row lock while calling PayPal
order = PayPal POST /v2/checkout/orders, PayPal-Request-Id = "order-" + reservation.id
  { intent: "CAPTURE",
    purchase_units: [{ reference_id: need.id, custom_id: reservation.id,
      description: "Donation: " + need.title (≤127 chars),
      amount: { currency_code: "USD", value: centsToPayPalValue(amount),
                breakdown: { item_total: { currency_code: "USD", value: same } } },
      items: [{ name: need.title (≤127), quantity: "1", category: "DONATION",
                unit_amount: { currency_code: "USD", value: same } }] }],
    payment_source.paypal.experience_context: { shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW",
                brand_name: "NeedGrid" } }        -- VERIFY experience_context shape
on PayPal failure → UPDATE reservation SET status='released'; publishNeedUpdated; 502 UPSTREAM
UPDATE reservations SET paypal_order_id = order.id
publishNeedUpdated(need.id)                  -- other screens see "$X on hold"
→ CreateOrderRes { orderId, amountCents, wasClamped, holdExpiresAt }
```

`HOLD` = `HOLD_MINUTES` from shared, overridable by env `HOLD_SECONDS` **only when `PAYPAL_ENV=sandbox`** (lets the bug bash test expiry in 60 s).

### 8.3 Capture — `POST /api/donations/orders/:orderId/capture` (rules 4, 5, 6)

```
existing = donation WHERE paypal_order_id = :orderId → if found return its CaptureRes (idempotent refresh)
reservation = WHERE paypal_order_id = :orderId → 404 if missing
cap = PayPal POST /v2/checkout/orders/:orderId/capture, PayPal-Request-Id = "capture-" + orderId
  if 422 ORDER_ALREADY_CAPTURED → cap = PayPal GET /v2/checkout/orders/:orderId
  capture = cap.purchase_units[0].payments.captures[0]
  require capture.status ∈ {COMPLETED, PENDING}  (PENDING: still record it; sandbox rarely does this)
return recordCapture({ reservationId, orderId, captureId: capture.id,
  amountCents: payPalValueToCents(capture.amount.value),
  donorName: cap.payer?.name?.given_name, donorEmail: cap.payer?.email_address })
```

`money/capture.ts → recordCapture(input)` — **the only code that turns PayPal money into allocations for orders**. Used by the capture route and by the webhook.

```
TX:
  INSERT donations(… source='order', status='captured', impact_token=randomToken())
    ON CONFLICT (capture_id) DO NOTHING RETURNING id
  if no row → return existing donation's CaptureRes                      -- webhook/route race
  res  = SELECT reservation FOR UPDATE
  need = SELECT need FOR UPDATE
  otherHeld = SUM active, unexpired holds on need EXCLUDING res.id
  room = need.status ∈ DONATABLE ? max(0, target − funded − otherHeld) : 0
  { directCents, overflowCents } = splitCapture(amount, room)
  if directCents > 0 → allocate(donation, need, directCents, 'direct')
  if overflowCents > 0:
     if res.roll_over_consent → distribute(donation, org, overflowCents, 'overflow', exclude=need.id)
     else                     → donation.unallocated_cents += overflowCents
  leftover from distribute (no room anywhere) → donation.unallocated_cents += leftover
  UPDATE reservation SET status='converted'
  if donation.unallocated_cents > 0 → proposeAction({ tool:'create_refund', origin:'system',
       args:{ donationId, reason:'Item was already fully funded' } })   -- same TX
COMMIT → publishNeedUpdated for every touched need
→ CaptureRes { donationId, impactToken, amountCents, allocations }
```

Helpers (all inside the caller's transaction, all in `money/`):
- `allocate(tx, donationId, needId, cents, reason)`: insert allocation row, `UPDATE needs SET funded_cents = funded_cents + cents`, then `refreshNeedStatus`.
- `refreshNeedStatus(tx, needId)`: `open|topping_up` and `funded ≥ target` → `funded` (+`funded_at` if null). `funded` and `funded < target` (after refund) → `open`. Never touches `ordered/delivered/closed/draft`.
- `distribute(tx, donationId, orgId, cents, reason, exclude)`: walk `listDonatableNeeds` (most urgent first, same org, not `exclude`), lock each, give `min(left, room)`, stop at 0 or after 10 needs; return leftover.
- `randomToken()`: `crypto.randomBytes(16).toString("base64url")`.

### 8.4 Webhooks — `POST /api/webhooks/paypal` (rules 5, 10)

- Register a route-scoped content-type parser that keeps the **raw body string** (and also parses it).
- Verify with `POST /v1/notifications/verify-webhook-signature`. Build that request body by **string concatenation with the raw event** so PayPal sees the exact bytes it signed:
  `{"auth_algo":…,"cert_url":…,"transmission_id":…,"transmission_sig":…,"transmission_time":…,"webhook_id":"<PAYPAL_WEBHOOK_ID>","webhook_event":<rawBody>}` (header values from `paypal-auth-algo`, `paypal-cert-url`, `paypal-transmission-id`, `paypal-transmission-sig`, `paypal-transmission-time`, JSON-escaped). Success = `verification_status === "SUCCESS"`.
- `INSERT webhook_events … ON CONFLICT (paypal_event_id) DO NOTHING`. Already processed → `200`. Not verified → store with `verified=false`, return `400`.
- Dispatch by `event_type`:
  - `PAYMENT.CAPTURE.COMPLETED` → order id from `resource.supplementary_data.related_ids.order_id` → find reservation → `recordCapture` (idempotent). If there's no reservation, ignore (e.g. invoice payments, which also emit captures).
  - `INVOICING.INVOICE.PAID` → `recordInvoicePaid` (§8.6).
  - `PAYMENT.CAPTURE.REFUNDED` → log only (refunds are recorded when our executor runs).
- Processing error → set `error`, return `500` (PayPal retries; processing is idempotent). Success → set `processed_at`, `200`.
- Note: events from the dashboard's **webhook simulator cannot be verified**. Test with real sandbox checkouts through a `cloudflared tunnel --url http://localhost:3000` URL registered on your sandbox app.
- Subscribe the app's webhook to: `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, `INVOICING.INVOICE.PAID`.


### 8.5 Purchases (rule 7) — `money/purchases.ts`

B's purchase-plan route calls `core.createProposedPurchase` (status `proposed`, `new_target_cents = computeTargetCents(offer.unitPriceCents, need.quantity)`).

**Approve** `POST /api/staff/purchases/:id/approve`:
```
TX: lock purchase (must be 'proposed', org matches) and need (must be 'funded')
  m = planPurchaseMoney(need.funded_cents, purchase.new_target_cents)
  exact   → nothing to move
  surplus → takes = takeFromAllocations(need's allocations, m.cents)
            for each take: allocation(donation, need, −cents, 'price_drop')
            then distribute(take.donationId's money, org, cents, 'price_drop', exclude=need) — per donation,
              each positive row gets related_allocation_id = its negative row
            if distribute leaves money: undo that part (keep it on this need) and log a warning
              → target stays at new_target, need keeps the surplus (staff can buy extra); surplusMoved reports only what moved
  gap     → need.status = 'topping_up'
  need.target_cents = purchase.new_target_cents; need.product = offer (as ProductSnapshot, fetchedAt now)
  purchase.status='approved', approved_at=now; other 'proposed' for this need → 'superseded'
COMMIT → publish both needs → ApprovePurchaseRes
```
Donations reaching a `topping_up` need flow through the normal checkout; `refreshNeedStatus` moves it back to `funded`.

**Mark ordered** `POST /api/staff/purchases/:id/ordered`: need `funded` + purchase `approved` → purchase `ordered` (`order_ref`, `ordered_at`), need `ordered` (`ordered_at`). Otherwise `409 INVALID_STATE`.

### 8.6 Sponsor invoices (staff assistant `create_invoice`)

- **Propose** (`proposeAction`, tool `create_invoice`): every `needId` must belong to the org and be donatable. `computed.planned = [{ needId, title, amountCents: remaining }]` (remaining includes holds), skip needs with 0, `computed.totalCents`. No needs left → `400 VALIDATION`.
- **Execute** (approve endpoint): in a TX re-read each need's remaining. If any differs from `computed.planned` → mark the action `failed` with "Amounts changed since this was proposed; ask the assistant again." (**we only ever run the exact approved amounts**). Otherwise insert `sponsor_invoices` (status draft) and one **sponsor hold** per need (`reservations.sponsor_invoice_id`, `expires_at = now + 14 days`) so donors can't double-fund those tiles. COMMIT, then PayPal:
  1. `POST /v2/invoicing/invoices` (request id `inv-<sponsorInvoiceId>`): `detail { currency_code: "USD", note, memo: "NeedGrid sponsor invoice" , reference: sponsorInvoiceId }`, `invoicer { business_name: org.name }`, `primary_recipients [{ billing_info: { email_address, name } }]`, one item per need `{ name: title, quantity: "1", unit_amount, unit_of_measure: "AMOUNT" }`, `configuration { allow_tip: false, partial_payment: { allow_partial_payment: false } }`.
  2. If `send`: `POST /v2/invoicing/invoices/{id}/send` → status `sent`, store the payer link (`links` rel `payer-view`, **VERIFY** where it appears).
  3. `POST /v2/invoicing/invoices/{id}/generate-qr-code` → store as `qr_image_data_url` (**VERIFY** response format; it may be a PNG body to base64-encode).
  - Any PayPal failure → release the sponsor holds, action `failed`.
- **Paid** (`recordInvoicePaid`, from `INVOICING.INVOICE.PAID`): lock the sponsor invoice by `paypal_invoice_id`; already `paid` → return. Insert a donation (`source='invoice'`, `capture_id` = the invoice payment's transaction id, `donor_name` = recipient name, `roll_over_consent=true`), convert its holds, and for each planned need run the same room/split/overflow logic as `recordCapture` with reason `sponsor`. Status `paid`, `paid_at`. Publish all touched needs.
- **Unpaid**: P2. Leave the holds; staff can cancel later (out of scope).

### 8.7 Agent actions (propose → approve → run) — `agent/`

- `proposeAction` (core, §7.2) is the **only** way an action row is created. It validates with `MONEY_TOOL_ARGS[tool]`, checks org ownership of every id, computes amounts, builds `preview.lines` showing **every argument and every computed amount** in plain text, and inserts `status='proposed'`. It never calls PayPal.
- `POST /api/staff/agent/actions/:id/approve`: TX lock the row (`proposed` and same org, else `409 INVALID_STATE`) → `approved`, `decided_at`. Then `executors[tool](action)` using **only** `action.args` + `action.computed` → `executed` + `result`, or `failed` + `error`. Return the final `AgentAction`.
- `reject` → `rejected`. Nothing runs.
- `executors.ts`: `create_invoice` (8.6), `send_invoice` (steps 2–3 of 8.6 for an existing draft), `create_refund` (8.8).
- `paypal/toolkit.ts`: create one `PayPalAgentToolkit` (`@paypal/agent-toolkit/ai-sdk`) with only the actions we use enabled: invoices `create, send, generateQRC, list, get`, plus transaction listing and refunds (**VERIFY** the exact `configuration.actions` keys for those two in the toolkit README/source; the README example shows `invoices`, `orders`, `disputes`, `products`, `shipment`, `subscriptionPlans`). Expose plain functions (`createInvoice`, `sendInvoice`, `invoiceQr`, `listTransactions`, `refundCapture`). Inside each, **try calling the toolkit tool's `execute` directly** with our stored args; if the toolkit's tool shape or AI SDK version doesn't fit (**VERIFY**), fall back to the REST call through `paypalFetch` behind the same signature. **Never hand the toolkit's tools to the model.** B's assistant only gets our own wrapped tools.

### 8.8 Refunds and roll-over (P1)

- **Refundable amount** for a donation = `unallocated_cents` + its net allocations on needs in `open/topping_up/funded` (money on `ordered/delivered` needs is spent and can't be refunded). Computed at propose time into `computed.refundCents` and `computed.parts`.
- **Execute**: re-check it's unchanged (else fail as in 8.6) → PayPal `POST /v2/payments/captures/{captureId}/refund` with `amount` = refundCents (request id `refund-<actionId>`) → TX: negative allocations (`refund`) for each part, `unallocated_cents = 0`, `refunded_cents += refundCents`, status `partially_refunded`/`refunded`, `refreshNeedStatus` on each need (a `funded` need can drop back to `open`). Invoice-sourced donations are refunded with "record refund" on the invoice instead (P2, skip if short on time).
- **Roll-over job** (`jobs/rollover.ts`, every 10 min, plus `pnpm --filter @needgrid/api job:rollover` for demos): needs `open|topping_up` with `deadline_at < now()` and `funded < target` → per donation: consent → move its net amount (`−` on the old need, `distribute` with reason `rollover`, leftover → `unallocated`); no consent → `unallocated` + a system `create_refund` proposal. Then the need → `closed`.

### 8.9 Holds, SSE, need cards

- `jobs/releaseHolds.ts` every 60 s: `UPDATE reservations SET status='released' WHERE status='active' AND expires_at < now() AND sponsor_invoice_id IS NULL RETURNING need_id` → publish each need. All reads compute `held` with `expires_at > now()`, so correctness never depends on the job (Render's free tier sleeps).
- `lib/events.ts`: in-process `EventEmitter` keyed by org slug (one API instance). `publishNeedUpdated(needId)` loads the `NeedCard` and emits.
- `GET /api/orgs/:slug/stream`: `reply.hijack()`, write headers yourself (`content-type: text/event-stream`, `cache-control: no-cache, no-transform`, `connection: keep-alive`, `x-accel-buffering: no`, plus the CORS headers, because hijacking bypasses `@fastify/cors`). Send `retry: 3000`, then `event: need.updated\ndata: <json>\n\n` per update and `: ping\n\n` every 25 s. Clean up listeners on `close`.
- `NeedCard` builder (`core/needs.ts → toNeedCard`): one SQL query with `held` (active, unexpired holds) and `donorCount` (distinct donations with net positive allocation). Used by every endpoint, so the numbers always agree.
- Timeline (`TimelineEvent[]`): built from `needs.created_at/funded_at/ordered_at/delivered_at/closed_at`, approved purchases (`topping_up` if a gap), and donation allocations grouped per day ("3 donors gave $42").

### 8.10 Security and limits (checklist for the Nov 6 pass)

- CORS: allow only the origins in `WEB_ORIGIN` (comma-separated) and `http://localhost:5173`; allowed headers `content-type, x-staff-key`.
- Create Fastify with `trustProxy: true` (Render sits behind a proxy), so rate limits use the real client IP.
- Per-route rate limits: create order 20/min, match 10/min, dashboard-complete 20/min, intake 10/min, agent chat 20/min, everything else unlimited.
- `bodyLimit` 1 MB. Image URLs are only accepted through `assertCloudinaryUrl`.
- The staff key is compared by hash only. Never log `x-staff-key`. Add a `redact` list in pino for `req.headers["x-staff-key"]`, `authorization` and `paypal-*`.
- Public endpoints never return `donor_email`, and `donor_name` only as a first name on the donor's own impact page.
- Error handler: `HttpError` → its status/code; `ZodError` → `400 VALIDATION` with `issues`; anything else → `500 INTERNAL` with no stack trace in production.

---

## 9. Environment, repo config, deploy, CI

### 9.1 `.env.example` (A owns; this list is authoritative for the whole team)

```bash
# ---- API (apps/api/.env) ----
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://...neon.tech/needgrid?sslmode=require     # Neon POOLED string, your own branch
TEST_DATABASE_URL=                                                 # separate Neon branch or local Postgres for DB tests
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=
HOLD_SECONDS=                                                      # sandbox-only override of the 15-min hold
WEB_ORIGIN=http://localhost:5173                                   # comma-separated in prod
STAFF_DEMO_KEY=harbor-demo-2026                                    # used by the seed for the first org
CLOUDINARY_CLOUD_NAME=                                             # for assertCloudinaryUrl
GOOGLE_GENERATIVE_AI_API_KEY=                                      # B
GEMINI_MODEL=gemini-2.5-flash                                      # B (VERIFY current model ids)
GEMINI_EMBEDDING_MODEL=gemini-embedding-001                        # B (768 dims via outputDimensionality)
CHANNEL3_API_KEY=                                                  # B
DASHBOARD_HMAC_SECRET=                                             # B: hashes donation ids for datasets
RESEND_API_KEY=                                                    # P2

# ---- Web (apps/web/.env) — VITE_* values are PUBLIC (baked into the bundle) ----
VITE_API_URL=http://localhost:3000
VITE_USE_MOCKS=false
VITE_PAYPAL_CLIENT_ID=                                             # same sandbox app's client id
VITE_CLOUDINARY_CLOUD_NAME=
VITE_CLOUDINARY_UPLOAD_PRESET=                                     # unsigned preset, folder "needgrid"
VITE_AG_STUDIO_LICENSE=                                            # B, from Nov 2
VITE_DEMO_STAFF_KEY=harbor-demo-2026                               # the "Try the staff console" button
```

`apps/api/src/env.ts` parses this with zod. `DATABASE_URL`, `PAYPAL_*`, `WEB_ORIGIN`, `CLOUDINARY_CLOUD_NAME` are required. The AI and Channel3 keys are optional at boot (B's routes return `503 UPSTREAM` if missing), so A can run the API without them.

### 9.2 Root files

- `pnpm-workspace.yaml`: `packages: ["apps/*", "packages/*"]`.
- Root `package.json`: `"packageManager": "pnpm@<pin>"`, `"engines": { "node": ">=22 <23" }`, scripts:
  `dev` (`pnpm -r --parallel --filter @needgrid/api --filter @needgrid/web dev`), `typecheck` (`pnpm -r typecheck`), `lint` (`eslint .`), `format` (`prettier --write .`), `test` (`pnpm -r test`).
- `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `target ES2023`, `module ESNext`, `moduleResolution Bundler`, `skipLibCheck`, `verbatimModuleSyntax`. Every package extends it.
- ESLint flat config with `typescript-eslint` recommended + `eslint-config-prettier`; React rules are added by C inside `apps/web`.
- `.gitignore`: `node_modules`, `dist`, `.env`, `.env.*` except `.env.example`, `coverage`, `.DS_Store`.
- `.npmrc`: `save-exact=true`.
- `LICENSE`: MIT.

### 9.3 `render.yaml` (VERIFY field names against Render's Blueprint docs)

```yaml
services:
  - type: web
    name: needgrid-api
    runtime: node
    plan: free                      # switch to starter on Nov 11
    rootDir: .
    buildCommand: corepack enable && pnpm install --frozen-lockfile && pnpm --filter @needgrid/api build && pnpm --filter @needgrid/api db:migrate
    startCommand: pnpm --filter @needgrid/api start
    healthCheckPath: /api/health
    envVars:
      - key: NODE_VERSION
        value: "22"
      - key: DATABASE_URL
        sync: false
      # …every API var from 9.1 with sync: false
  - type: web
    name: needgrid-web
    runtime: static
    buildCommand: corepack enable && pnpm install --frozen-lockfile && pnpm --filter @needgrid/web build
    staticPublishPath: apps/web/dist
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
    envVars:
      - key: VITE_API_URL
        sync: false
      # …every VITE_ var from 9.1
```

### 9.4 CI — `.github/workflows/ci.yml`

On `pull_request` and `push` to `main`: checkout → `pnpm/action-setup` → `actions/setup-node` (22, cache pnpm) → `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm lint` → `pnpm test`. Add a `services: postgres` container using image `pgvector/pgvector:pg16` and set `TEST_DATABASE_URL` so the DB tests run in CI. CI must never need real PayPal, Gemini or Channel3 keys: those tests are mocked.

### 9.5 Tests you must write (Vitest)

| File | What it proves |
|---|---|
| `packages/shared/src/money.test.ts` | §5.3 list |
| `apps/api/src/money/donations.test.ts` (DB) | clamp to remaining; holds count; expired holds don't count; `FULLY_FUNDED` returns next need; 20 parallel create-order calls on a $40-remaining tile never hold more than $40 in total |
| `apps/api/src/money/capture.test.ts` (DB, PayPal mocked) | exact fund → `funded`; same capture twice → one donation; late capture after hold expiry with another donor in between → overflow to next need; no consent → `unallocated` + system refund proposal; invariants hold afterwards |
| `apps/api/src/money/purchases.test.ts` (DB) | exact / surplus moved with paired allocations / gap → `topping_up` → top-up donation → `funded` → mark ordered |
| `apps/api/src/webhooks/paypal.test.ts` | bad signature → 400; same event id twice → processed once; capture webhook after route capture → no double count |
| `apps/api/src/agent/actions.test.ts` | propose never calls PayPal; reject runs nothing; approve runs with stored args; changed amounts → `failed`; other org's key → 409/404 |

DB tests: run migrations into `TEST_DATABASE_URL` once, truncate tables between tests. Mock PayPal with a tiny fake (`paypal/__fakes__.ts`) injected through a module-level setter or `vi.mock`. After each money test, call `assertInvariants()`.


---

## 10. Your tasks, in order (one PR each unless noted)

The team is about a day behind the original plan, so A-1 is the first thing anyone merges. **B and C are blocked until A-1 is on `main`.** Do it first and fast.

| # | When | Task | Done when |
|---|---|---|---|
| **A-1** | Tue Oct 27 AM | Monorepo scaffold (§9.2), `packages/shared` verbatim (§5) + money tests, `apps/api` skeleton (§7) with `buildApp`, env parsing, error handler, `GET /api/health`, `core/index.ts` stubs (§7.2), B's stubs (§7.3), install B's API deps (`ai`, `@ai-sdk/google`, `@channel3/sdk`), CI (§9.4), `.env.example`, `render.yaml`, `HANDOFF.md` with three empty headings | `pnpm install && pnpm typecheck && pnpm test` green on a fresh clone; CI green; post "A-1 merged" to the team |
| **A-2** | Tue Oct 27 | Drizzle schema (§6) + first migration (extensions) + `db:migrate`; Render deploy of both services | `/api/health` returns `{ ok: true, db: true }` on the Render URL; static site loads |
| **A-3** | Wed Oct 28 | `toNeedCard`, `GET /api/orgs`, `/orgs/:slug`, `/needs/:id` (timeline), staff auth plugin, `GET /api/staff/me`, `/staff/needs`, `/staff/needs/:id`, `POST /staff/needs` (calls `ai.embedNeedText`, saves the embedding if non-null; never fails because of it), `PATCH /staff/needs/:id` (rules in `PatchNeedReq` comments) | Responses parse with the shared schemas in tests; wrong staff key → 401 |
| **A-4** | Wed Oct 28 | PayPal client (§8.1), create order (§8.2) | Sandbox order is created; the parallel-hold test passes |
| **A-5** | Thu Oct 29 | Capture + `recordCapture` (§8.3), SSE (§8.9), `GET /api/impact/:token` | Full sandbox donation from C's donate panel (or curl + the approve URL) fills the bar on a second browser |
| **A-6** | Fri Oct 30 | Webhook route (§8.4) + tests; register the sandbox webhook | A real sandbox capture produces one verified `webhook_events` row and no duplicate donation |
| **A-7** | Fri Oct 30 | Holds job, overflow path, rate limits, pino redaction, `check:money` script, all §9.5 money tests | All tests green; `check:money` passes on seeded data |
| **A-8** | Sat Oct 31 | Integration day with C: run against real data, fix contract mismatches (additive only), set Render env vars | C's screens work with `VITE_USE_MOCKS=false` |
| — | **Sun Nov 1** | **Milestone 1** on the live URL: photo → tiles → sandbox donation → bar fills live → Funded | |
| **A-9** | Mon Nov 2 | `createProposedPurchase`, approve, mark ordered (§8.5) | Purchase tests pass; B's purchase-plan route works end to end |
| **A-10** | Tue Nov 3 | `recordDelivery`, `confirmDelivery`, delivery data on need detail and impact responses | Delivered need shows the photo on the impact page |
| **A-11** | Wed Nov 4 | `proposeAction`, previews, approve/reject/list endpoints, executors skeleton, `paypal/toolkit.ts`, `listPayPalTransactions`, `listRecordedDonations` | Action tests pass; B's assistant can propose and C's card can approve |
| **A-12** | Thu Nov 5 | Sponsor invoice end to end (§8.6), `GET /api/staff/invoices` | Sandbox invoice paid from the sandbox personal account → every tile on it shows Funded |
| **A-13** | Fri Nov 6 | Refunds + roll-over job (§8.8, P1), security pass (§8.10) | "Refund donation X" works after approval; checklist done |
| — | **Sat Nov 7** | **Feature freeze** | |
| **A-14** | Nov 8–11 | Bug bash (test C's screens), fixes, README (setup, architecture, sandbox donor login, staff passcodes, guardrails), uptime monitor on `/api/health`, put `VITE_AG_STUDIO_LICENSE` in Render, move API to Starter on Nov 11, tag `v1.0.0` | |

## 11. Handoffs (who waits on what)

| You give | To | By |
|---|---|---|
| A-1 merged (contract, stubs, deps, CI) | B, C | Tue Oct 27 AM |
| `core.listDonatableNeeds`, `getNeedCard(s)`, `setNeedEmbedding` working | B (seed, match) | Wed Oct 28 |
| `db` + `schema` exports for the seed script | B | Wed Oct 28 |
| Live URLs + a sandbox order working | C (donate panel) | Thu Oct 29 |
| `createProposedPurchase` | B | Mon Nov 2 |
| `recordDelivery` / `confirmDelivery` | B | Tue Nov 3 |
| `proposeAction`, `listPayPalTransactions`, `listRecordedDonations` | B (assistant) | Wed Nov 4 AM |
| Approve/reject endpoints | C (approval cards) | Wed Nov 4 |

You need from others: B's `embedNeedText` (optional, stub works), B's seed data (Thu Oct 29), C's donate panel to test capture (Wed Oct 28; until then use the PayPal approve link from the order response).

## 12. Definition of done (every PR)

- Typecheck, lint and tests green; new money logic has a test.
- Responses parse with the shared zod schema (tested with `app.inject`).
- No floats on money, no secrets in code or logs, no edits outside your paths (§2).
- If you changed `packages/shared`: version bumped, `CHANGELOG.md` line, B and C told in the PR description.
- `check:money` passes on your branch's data.

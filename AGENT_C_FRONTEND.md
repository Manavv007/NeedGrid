# NeedGrid — Agent Brief C: Frontend & Demo Lead

> **Before each task, read `NOTES.md` (section 0 "Decisions" first) and your section of `HANDOFF.md`.** Decisions there override this brief.
>
> **Give this file to your coding agent as its main instruction.** Also read `NEEDGRID_DEV_PLAN.md` for product context, and §5 of `AGENT_A_BACKEND.md` for the full shared contract code (every type you render).
> If they disagree: this file wins on *implementation details*, the plan wins on *scope and priorities*, and A's §5 code wins on *exact type/field names*.
> Sibling briefs: `AGENT_A_BACKEND.md` (Payments & Backend), `AGENT_B_AI_DATA.md` (AI & Data). Sections 2–4 are identical in all three files.

---

## 0. Rules for the coding agent (read first)

1. **You work for Person C.** Only create or edit files under `apps/web/**` (except `apps/web/src/dashboard/**`, which is B's) and `docs/**`. Need something elsewhere (an API field, an env var, a root config change)? Write it in `HANDOFF.md` under the owner's heading and keep going with a mock.
   **Exception, task C-1 only:** create `apps/web/src/dashboard/DashboardPage.tsx` as a placeholder (`export default function DashboardPage() { return <p>Dashboard coming soon</p>; }`) so the lazy route compiles. After that PR merges, B owns the folder and you never edit it again.
2. **Build against mocks first.** Every screen must work with `VITE_USE_MOCKS=true` (MSW, §8) before the real endpoint exists. Then flip to the real API without code changes.
3. **The browser never decides money.** Send IDs and *requested* amounts only. Always display the amounts the server returns (`amountCents`, `remainingCents`, `wasClamped`). Target previews in the intake screen are labelled "estimate"; the server computes the real one.
4. **Parse every API response with its shared zod schema** (`@needgrid/shared`). A parse failure is a bug to report to the owner, not something to patch around in the UI.
5. **Don't trust your memory of these APIs:** React Router, TanStack Query v5, Tailwind v4, shadcn/ui CLI, MSW v2, `@paypal/react-paypal-js`. Check current docs (Context7, official docs) before coding. Items marked **VERIFY** were not confirmed against live docs.
6. Before every PR: `pnpm typecheck && pnpm lint && pnpm test` pass. Keep PRs small.
7. Accessibility is required: semantic HTML, labels on every input, visible focus, `aria-live` for live progress changes and streamed chat, colour contrast AA, everything usable by keyboard and on a 360 px wide phone.
8. No secrets in the frontend. Every `VITE_*` value is public.

---

## 1. What we're building (one paragraph)

NeedGrid lets shelters, food banks, classrooms and animal rescues post the **exact items** they need. Staff photograph a shelf or a list; AI extracts items; Channel3 matches each to a real product and price; staff publish each as a **tile** with a funding target. Donors fund tiles through **PayPal**; progress bars fill live. When a tile is funded, AI re-checks the price and proposes a purchase; staff approve it. When the item arrives, staff upload a photo; AI verifies it; the donor's impact page shows "your item arrived". A staff **AI assistant** handles PayPal invoices/refunds/reconciliation with **human approval** for every money action. A public **AG Studio** dashboard lets anyone ask "what did November's donations buy?". Hackathon: PayPal AI Hackathon, submit **Wed Nov 11**, judged Dec 1–15 on the live URL.

**Your part is everything judges see and click**, plus the demo video and Devpost write-up. You are also the **scope keeper**: you run the daily 15-minute standup and the GitHub Projects board, and you say no to anything that isn't P0 before Milestone 1.

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

## 5. Stack and setup (task C-1)

`apps/web` is a Vite + React + TypeScript SPA. Dependencies (pin exact versions; install **all** of them in C-1, including B's, so there's one lockfile change):

- Runtime: `react`, `react-dom`, `react-router` (v7, library/"data" mode with `createBrowserRouter`), `@tanstack/react-query` (v5), `zod` (v4, same as shared), `@needgrid/shared` (`workspace:*`), `@paypal/react-paypal-js`, `qrcode` (flyers), `lucide-react`, `sonner` (toasts), `clsx`, `tailwind-merge`, `class-variance-authority`, Radix primitives pulled in by shadcn, and for B: `ag-studio`, `ag-studio-react` (**3.0.0**, same as the PayPal boilerplate).
- Dev: `vite`, `@vitejs/plugin-react`, `tailwindcss` v4 + `@tailwindcss/vite`, `msw` v2, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`.
- shadcn/ui: run the CLI inside `apps/web` (**VERIFY** current Tailwind v4 instructions). Components: button, card, badge, progress, dialog, sheet, input, textarea, label, select, checkbox, radio-group, tabs, table, skeleton, separator, tooltip, alert, dropdown-menu, sonner.
- `apps/web/package.json` scripts: `dev` (`vite --port 5173`), `build` (`tsc -b && vite build`), `preview`, `typecheck`, `test` (`vitest run`), `mocks:init` (`msw init public --save`).
- `vite.config.ts`: React + Tailwind plugins, alias `@` → `src`. No dev proxy; the app always calls `import.meta.env.VITE_API_URL` (the API allows `http://localhost:5173` via CORS).
- `src/env.ts`: zod-parse `import.meta.env` (`VITE_API_URL`, `VITE_USE_MOCKS`, `VITE_PAYPAL_CLIENT_ID`, `VITE_CLOUDINARY_CLOUD_NAME`, `VITE_CLOUDINARY_UPLOAD_PRESET`, `VITE_DEMO_STAFF_KEY`; B reads `VITE_AG_STUDIO_LICENSE` itself).
- Static hosting on Render with a rewrite of `/*` → `/index.html` (A's `render.yaml`), so deep links like `/impact/<token>` work.

## 6. Folder layout

```
apps/web/
├─ index.html, vite.config.ts, tsconfig.json, components.json (shadcn)
├─ public/ (mockServiceWorker.js, og-image.png, favicon)
└─ src/
   ├─ main.tsx              # starts MSW when VITE_USE_MOCKS=true, then renders
   ├─ router.tsx            # all routes (§9); lazy-loads ../dashboard/DashboardPage
   ├─ env.ts
   ├─ styles/globals.css    # Tailwind + design tokens (§10)
   ├─ lib/
   │  ├─ api.ts             # apiGet/apiPost/apiPatch + ApiClientError (§7.1)
   │  ├─ queries.ts         # TanStack Query keys + hooks
   │  ├─ sse.ts             # useOrgStream (§7.2)
   │  ├─ ndjson.ts          # readNdjson (§7.3)
   │  ├─ cloudinary.ts      # uploadImage (§7.4)
   │  ├─ staffKey.ts        # sessionStorage helpers
   │  └─ format.ts          # formatUsd re-export, dates, percent
   ├─ components/           # layout/, ui/ (shadcn), TileCard, ProgressBar, UrgencyBadge, StatusBadge,
   │                        # Timeline, ProductOptionCard, EmptyState, ErrorState, PageSkeleton
   ├─ features/
   │  ├─ donate/            # DonatePanel, AmountPicker, PayPalCheckout, MockPayPalButton
   │  ├─ staff/             # StaffGate, StaffLayout, NeedsTable, Intake*, PurchasePlanCard, DeliveryPanel
   │  ├─ assistant/         # AssistantChat, ApprovalCard, ReconcileReportTable, PendingActions
   │  ├─ match/             # MatchMeBox (P1)
   │  └─ flyers/            # FlyerPage (P1)
   ├─ pages/                # one file per route
   ├─ mocks/                # MSW (§8)
   └─ test/                 # setup.ts, render helpers
```

## 7. Data layer

### 7.1 `lib/api.ts`

```ts
export class ApiClientError extends Error {
  constructor(public status: number, public code: ErrorCode | "NETWORK", message: string, public details?: unknown) { super(message); }
}
export async function apiGet<T>(path: string, schema: z.ZodType<T>, opts?: { staff?: boolean; signal?: AbortSignal }): Promise<T>;
export async function apiPost<T>(path: string, body: unknown, schema: z.ZodType<T>, opts?: { staff?: boolean }): Promise<T>;
export async function apiPatch<T>(path: string, body: unknown, schema: z.ZodType<T>, opts?: { staff?: boolean }): Promise<T>;
```

- URL = `env.VITE_API_URL + path`, with paths always from the shared `paths` object.
- `staff: true` adds header `x-staff-key` from `sessionStorage[STAFF_KEY_STORAGE]`. A 401 clears the key and redirects to `/staff/login`.
- Non-2xx: parse the body with `ApiError` → throw `ApiClientError(status, code, message, details)`. Network failure → code `"NETWORK"`.
- 2xx: `schema.parse(json)`. In dev, log the zod issues with the endpoint name.
- The Render free tier sleeps: the first request can take ~50 s. `apiGet` retries once after a network error, and pages show "Waking up the server…" after 3 s of loading.

### 7.2 Live updates — `useOrgStream(slug)`

`new EventSource(env.VITE_API_URL + paths.orgStream(slug))`, listen for `NEED_UPDATED_EVENT`, parse with `NeedCard`, then patch the cache: `["org", slug]` (replace the need in `needs`, or add it if new and not draft), `["need", id]` (replace `need`), `["staffNeeds"]` (invalidate). EventSource reconnects by itself; on `error` show a small "Reconnecting…" pill. Mount it on the tile wall, the need page and the staff console. Progress bars animate from the old to the new value (CSS transition, respecting `prefers-reduced-motion`), and an `aria-live="polite"` region announces "Diapers, size 4: $14 left" style updates (throttled to one per 5 s).

### 7.3 NDJSON — `readNdjson(response, onEvent)`

`fetch(POST paths.staff.agentChat, { headers: staff + content-type, body })`, then read `response.body` with a `TextDecoderStream`, split on `\n`, `AgentStreamEvent.parse(JSON.parse(line))` per non-empty line, call `onEvent`. Support aborting with an `AbortController` (Stop button).

### 7.4 Images — `uploadImage(file): Promise<string>`

Unsigned direct upload: `POST https://api.cloudinary.com/v1_1/${VITE_CLOUDINARY_CLOUD_NAME}/image/upload` with `FormData { file, upload_preset: VITE_CLOUDINARY_UPLOAD_PRESET, folder: "needgrid" }` → return `secure_url`. Check type `image/*` and size ≤ 10 MB first; show upload progress (use `XMLHttpRequest` if `fetch` can't report it). The file input has `accept="image/*"` and `capture="environment"` so phones open the camera. In mock mode, return a fixed demo image URL after a short delay.

### 7.5 Query hooks (`lib/queries.ts`)

`useOrgs`, `useOrg(slug)`, `useNeed(id)`, `useImpact(token)`, `useStaffMe`, `useStaffNeeds(status?)`, `useStaffNeed(id)`, `useAgentActions(status?)`, `useInvoices`, plus mutations `useCreateOrder`, `useCapture`, `useIntake`, `usePublishNeed`, `usePatchNeed`, `usePurchasePlan`, `useApprovePurchase`, `useMarkOrdered`, `useDelivery`, `useConfirmDelivery`, `useApproveAction`, `useRejectAction`, `useMatch`. Keys: `["orgs"]`, `["org", slug]`, `["need", id]`, `["impact", token]`, `["staffNeeds", status]`, `["staffNeed", id]`, `["actions", status]`, `["invoices"]`. Mutations invalidate what they change. `staleTime` 30 s for public data.

## 8. Mocks (`src/mocks/`, C owns all of them, including B's endpoints)

- `handlers.ts`: an MSW v2 `http.*` handler for **every** endpoint in §4 except the webhook and the SSE stream. Responses are built in `fixtures.ts` and **validated with the shared schemas at module load**, so a contract change breaks the build immediately.
- `fixtures.ts`: hand-written, realistic data that mirrors B's seed (§11 of B's brief): the three demo orgs, ~12 needs each across every status, Harbor's "Diapers, size 4" with **$14 left**, a funded need with a cheaper fresh price, an ordered need, a delivered need with a photo, an impact token `demo-impact-token`, an intake response with 6 drafts × 3 options, a purchase plan with a surplus, a delivery result, pending agent actions, a reconcile report, and small dashboard datasets.
- A tiny in-memory `mockDb` so create-order → capture actually raises `fundedCents`, holds lower `remainingCents`, and a request above remaining comes back clamped (`wasClamped: true`), mirroring A's rules. Fully funded → `409 FULLY_FUNDED` with `nextNeed`.
- Live updates in mock mode: `useOrgStream` subscribes to `mockDb`'s in-page event emitter instead of `EventSource` (branch on `env.VITE_USE_MOCKS`). Mock state is per tab, so "two screens fill live" can only be shown with the real API.
- Assistant chat mock: a handler returning an NDJSON `ReadableStream` that emits text deltas, a `tool_call`, then an `action_proposed` for "invoice" prompts, or a `tool_result` with a `ReconcileReport` for "check"/"reconcile" prompts.
- PayPal in mock mode: `MockPayPalButton` (looks like a PayPal button, labelled "Mock PayPal") calls create → capture directly.
- 300–800 ms of artificial latency on every handler so loading states are visible.

---

## 9. Routes and screens

| Route | Page | Data |
|---|---|---|
| `/` | Landing | `useOrgs` |
| `/o/:slug` | Tile wall (charity page) | `useOrg`, `useOrgStream` |
| `/o/:slug/n/:needId` | Need detail + donate | `useNeed`, `useOrgStream` |
| `/thanks/:token` | Thank-you after payment | `useImpact` |
| `/impact/:token` | Donor impact page | `useImpact` (refetch every 60 s) |
| `/dashboard` | B's AG Studio page (lazy) | B |
| `/o/:slug/flyer`, `/o/:slug/n/:needId/flyer` | Printable QR flyers (P1) | `useOrg` / `useNeed` |
| `/staff/login` | Passcode entry | — |
| `/staff` | Console: needs by status | `useStaffMe`, `useStaffNeeds`, `useOrgStream` |
| `/staff/intake` | Photo/list → drafts → publish | `useIntake`, `usePublishNeed` |
| `/staff/needs/:id` | Need management: edit, purchase plan, ordered, delivery | `useStaffNeed` |
| `/staff/assistant` | Assistant chat + approval cards | NDJSON, `useAgentActions` |
| `/staff/invoices` | Sponsor invoices (status, link, QR) | `useInvoices` |
| `*` | Not found | — |

Every `/staff/*` route except login is wrapped in `StaffGate`: no key in sessionStorage → redirect to `/staff/login`; it calls `useStaffMe` once and shows the org name in the staff header. Every page has loading (skeleton), empty and error states (§10).

### 9.1 Landing `/`

- Hero: the hook line from the demo script ("Shelters get 400 cans of beans and zero diapers. Donors never see what their $20 did."), a one-line explainer, buttons "See what's needed" (scrolls to the orgs) and "See the impact" (`/dashboard`).
- "How it works" in 4 steps: charity posts exact items → you fund a tile with PayPal → we buy it → you get a photo when it arrives.
- Charity cards from `useOrgs` (name, city, cause tags, raised, items delivered, open needs) → `/o/:slug`.
- Match me box (P1, behind a feature flag until B ships `POST /api/match`): text + budget input → 3 tile cards with B's reason → donate.
- Footer: "Sandbox demo, no real money", GitHub link, "Try the staff console" → `/staff/login`.

### 9.2 Tile wall `/o/:slug`

- Org header: name, city, description, stats (`OrgStats`), "Share" (copy link) and "Print flyer" (P1).
- Filters: category chips, urgency, "Still needed / Funded / Delivered" tabs (default "Still needed" = `open` + `topping_up`). Sort: most urgent first (urgency desc, deadline asc), then newest.
- `TileCard` (the signature component, make it beautiful): product image (square, `object-contain` on white), title, `unit × quantity` ("2 × pack of 150"), retailer, `ProgressBar` (funded + a striped segment for `heldCents`), "**$14 left** of $84", donor count, urgency badge, deadline ("needed by Fri"), status badge for non-open tiles (Funded ✓, Ordered, Delivered with a small photo thumb). Whole card links to the need page; a "Fund" button opens the donate panel directly.
- Responsive grid: 1 column at 360 px, 2 at 640, 3 at 1024, 4 at 1440. A **big-screen mode** (`?display=1`): larger cards, no filters, auto-scroll, used on the "big screen" in the demo video.

### 9.3 Need detail `/o/:slug/n/:needId`

- Left: product image, title, description, product title + retailer link ("View at walmart.com"), quantity, why it's needed, deadline.
- Right (sticky on desktop, bottom sheet on mobile): progress + `DonatePanel`.
- Below: `Timeline` (open → funded → ordered → delivered from `NeedDetailRes.timeline`), and the arrival photo + message when delivered.
- If the need isn't donatable: show its status ("Fully funded, thank you! We're buying it now") and a "Fund the next most urgent need" link (`listDonatableNeeds` isn't public, so use the first open tile from `useOrg`).

### 9.4 Donate panel (`features/donate/`) — the money UI, test it thoroughly

1. **Amount:** preset buttons $10 / $25 / $50 (hide presets ≥ remaining), "**Fund the rest ($14.00)**" (= `remainingCents`), and "Other" (input in dollars, converted to cents with integer maths: parse `^\d+(\.\d{1,2})?$`, never `parseFloat` × 100). Minimum `MIN_DONATION_CENTS` unless remaining is smaller (then only "Fund the rest" is offered). Max `MAX_DONATION_CENTS`.
2. **Checkbox, ticked by default:** "If this item gets fully funded before my payment completes, send my gift to the charity's next most urgent need." (`rollOverConsent`).
3. **Optional first name** is not collected here (PayPal provides the payer's name).
4. **PayPal:** wrap the app (or just this panel) in `PayPalScriptProvider` with `{ clientId: VITE_PAYPAL_CLIENT_ID, currency: "USD", intent: "capture" }` (**VERIFY** option names for the installed `@paypal/react-paypal-js` version). `PayPalButtons`:
   - `createOrder`: `POST paths.createOrder { needId, amountCents, rollOverConsent }` → return `orderId`. The amount picker already caps at `remainingCents`, so clamping only happens when someone else donated a moment earlier. If `wasClamped`, show "Only $14.00 was left, so your gift is $14.00" in the panel while the PayPal window is open (PayPal shows the clamped amount too) and repeat it on the thank-you page.
   - `onApprove({ orderID })`: `POST paths.captureOrder(orderID)` → navigate to `/thanks/<impactToken>`. Show a full-panel "Confirming your gift…" state; disable everything; **never** call capture twice from the UI (guard with a ref). If capture fails with a network error, retry once (the endpoint is idempotent).
   - `onCancel`: toast "Payment cancelled. Your hold is released in 15 minutes." `onError`: friendly error + retry.
   - `409 FULLY_FUNDED` from create: replace the panel with "This item was just fully funded!" and a card for `details.nextNeed` with its own Fund button.
   - `forceReRender` on amount changes so the buttons use the latest amount.
5. In mock mode render `MockPayPalButton` instead (§8).
6. Under the buttons: "PayPal sandbox: use the demo buyer login from the README."

### 9.5 Thank-you `/thanks/:token` and impact `/impact/:token`

- Thank-you: big "Thank you!", what the gift was split into (`CaptureRes.allocations` via `ImpactRes.items`: "$14.00 → Diapers, size 4 (Harbor Food Bank)"; overflow/rollover items labelled "sent to the next most urgent need"), a prominent "**Save your impact link**" box (copy button; explain it's the only way back, no account needed), and "Fund another item".
- Impact page: greeting with `donorFirstName` if present, total given, one card per item: product image, org, amount, status, `Timeline`, and when delivered the **arrival photo** large with the message ("Your diapers arrived!"). Items not yet delivered show "We'll post a photo here when it arrives." Refetch every 60 s while open.

### 9.6 Staff login `/staff/login`

Passcode input (type password, show/hide) + "Sign in", which stores the key and calls `GET /api/staff/me` (401 → "That passcode didn't work"). A prominent **"Try the staff console"** button fills `VITE_DEMO_STAFF_KEY` and signs in, with a note listing the three demo passcodes. "Sign out" in the staff header clears the key.

### 9.7 Staff console `/staff`

Tabs by status: Drafts, Open (incl. topping up), Funded (needs a purchase), Ordered (waiting for delivery), Delivered, Closed. A compact `NeedsTable` (thumb, title, progress, status, updated) with a **next action** button per row: Funded → "Plan purchase", Ordered → "Record delivery", Draft → "Publish". Header actions: "Add needs" (`/staff/intake`), "Assistant", "Invoices", "View public page". Live via `useOrgStream`.

### 9.8 Intake `/staff/intake` (demo scene 0:15–0:50, make it smooth)

1. **Input step:** two big options: "Take or upload a photo" (shelf or list) and "Type or paste a list". Optional third: "Paste a product link". Photo → `uploadImage` → preview.
2. **Analyse:** `POST paths.staff.intake` with `{ imageUrl }` or `{ text }`. Show a staged progress message ("Reading your list…", "Finding real products…", "Comparing prices…") while it runs (10–30 s). Show `warnings` in an alert.
3. **Review step**, one card per `DraftNeed`:
   - Editable title, quantity, unit, category (select), urgency (1–3 segmented control), optional deadline, description. Low `confidence` (< 0.6) → yellow "Please check" tag with `extracted.notes`.
   - Product choice: up to 3 `ProductOptionCard`s (image, title, retailer, price, price per item when `pricePerItemCents` exists, `fitReason`), radio-selectable, the first preselected. No options → "No match found, paste a product link" input (re-runs intake with that URL as `text` and swaps in its first option).
   - "Estimated target" = `computeTargetCents(selected.unitPriceCents, quantity)` from shared, labelled **estimate**; "Edit target" lets staff override (sent as `targetCents`).
   - Include checkbox (ticked), so staff can skip rows.
4. **Publish:** "Publish N needs" → `POST paths.staff.needs` per included row with `PublishNeedReq` (`product` = the chosen option without `fitScore/fitReason/pricePerItemCents`, `alternatives` = the other options, same stripping). Sequential with a progress list; failures stay on screen with the error and a retry. Also "Save as drafts" (`publish: false`). Nothing is ever published automatically.
5. Done → link to the public tile wall, where the new tiles appear live.

### 9.9 Need management `/staff/needs/:id`

- Header: title, status badge, public link, progress, timeline.
- **Edit** (dialog, `PatchNeedReq`): title, description, urgency, deadline, target (min = funded + held, enforced by the API too), quantity (disabled once money arrived), swap product to one of `alternatives`, close need (confirm dialog).
- **Purchase plan** (status `funded`; demo scene 1:30–1:55): button "Check price & plan purchase" → `POST paths.staff.purchasePlan(id)` → `PurchasePlanCard`:
  - Old vs new price side by side, `priceChange` badge (cheaper green, pricier amber), `flags` as chips, the AI `explanation`, the offer (image, retailer, link), and the money outcome in plain words: exact → "Funds match exactly"; surplus → "**$3.20 surplus will move to <next need title>**"; gap → "Price went up: the tile will ask donors for **$4.10 more**".
  - Alternatives list (pick one → staff can ask again; P1).
  - **Approve purchase** → `POST approvePurchase(purchase.id)` → toast with `surplusMoved` / `gapCents`.
  - After approval: "Buy it at <retailer>" link (opens offer URL) + **Mark as ordered** form (order number input) → `POST markOrdered`.
- **Delivery** (status `ordered`; scene 1:55–2:15): `DeliveryPanel`: upload arrival photo + optional note for donors → `POST paths.staff.delivery(id)` → shows the photo next to the product image, the match score as a meter, `aiNotes`, and the polished donor message. `needsReview` → amber "Needs your review" with **Confirm delivery** (`POST confirmDelivery`, editable message) and "Retake photo". Otherwise green "Delivered, donors have been updated".

### 9.10 Assistant `/staff/assistant` (scene 2:15–2:35)

- Two-column on desktop: chat (left), **Pending approvals** list from `useAgentActions("proposed")` (right). Single column on mobile.
- Chat: message list, input, Send, Stop. Suggested prompts: "Invoice Acme Hardware (sponsor@example.com) for the whole winter-coats list", "Check this week's money matches our records", "What's still unfunded and urgent?".
- Stream rendering (`readNdjson`): `text` → append to the current assistant bubble (`aria-live="polite"`); `tool_call` → a small grey status line with a spinner ("Checking PayPal transactions…"); `tool_result` → turns the status line into a check, and for `tool === "reconcile"` render `ReconcileReportTable` from `data` (PayPal total, our records, matched count, mismatch rows, a green "Everything matches" or red "N mismatches" banner); `action_proposed` → an inline **ApprovalCard**; `error` → red bubble; `done` → re-enable input.
- Send only `{ role, content }` text history (last 30 messages) as `AgentChatReq`.
- **ApprovalCard** (the most important trust UI; judges look for this): header "Needs your approval" + tool icon, `preview.title`, a table of `preview.lines` (exact arguments and server-computed amounts), `preview.totalCents` large, the note "Nothing happens until you approve. Amounts were calculated by NeedGrid, not the AI.", buttons **Approve** (primary) and **Reject**. Approve → `POST approveAction(id)` → card shows the final status: `executed` (for invoices: payer link + QR image from `result`/the invoices list, "Copy link") or `failed` with `error` (e.g. "Amounts changed since this was proposed; ask again"). Reject → "Rejected, nothing was sent". Disable both buttons while pending; never double-submit.
- The same card component is used in the Pending approvals list.

### 9.11 Invoices `/staff/invoices`

Table of `SponsorInvoiceView`: recipient, needs count, amount, status badge (draft/sent/paid), created, payer link, QR thumbnail (click → dialog with a large printable QR).

### 9.12 QR flyers (P1)

Print-ready A4/Letter page: org name, a headline ("Help us get these 6 items"), up to 6 tiles with remaining amounts, and a large QR code (`qrcode` → canvas/SVG) pointing to the tile wall or a single need URL. "Print" button + `@media print` styles (no header/footer, black on white).


---

## 10. Design system

- **Feel:** warm, trustworthy, concrete. Real product photos are the hero; the UI stays calm around them. Think "community noticeboard meets a good e-commerce card", not "fintech dashboard".
- **Tokens** (`styles/globals.css`, as CSS variables + Tailwind theme, shared with B for the AG Studio theme): background warm off-white `#FBF8F3`, surface white, text `#1F2328`, muted `#6B6F76`, primary deep teal `#0F766E` (buttons, progress fill), accent warm orange `#EA7A2E` (urgency 3, "left" amounts), success `#15803D` (funded/delivered), warning `#B45309`, held/striped `#99D5CF`. Radius 12 px cards, 8 px controls. Font: Inter (or the system stack) with tabular numbers for money.
- Write the hex values into `docs/design-tokens.md` too so B can match them.
- **Money display:** always `formatUsd(cents)`; "left" amounts bold; never show more than 2 decimals; progress shows `funded / target` with the held segment.
- **States:** every list has an `EmptyState` (icon + one line + an action), every query an `ErrorState` (message + Retry), every page a skeleton. Toasts for mutations.
- **Mobile first:** donors arrive from QR codes on phones. The donate panel is a bottom sheet under 768 px, tap targets ≥ 44 px, no horizontal scroll at 360 px.
- **Accessibility:** progress bars use `role="progressbar"` with `aria-valuenow/min/max` and a text label; urgency is never shown by colour alone (text + icon); images have `alt` (product title); dialogs trap focus; `prefers-reduced-motion` respected.

## 11. Tests

Vitest + Testing Library + MSW (the same handlers) in `src/test/`:
- `AmountPicker`: integer-cents parsing ("10.5" → 1050, rejects "1.234", "-1", "abc"), presets hidden above remaining, "Fund the rest" equals `remainingCents`.
- `DonatePanel` with `MockPayPalButton`: clamped notice, `FULLY_FUNDED` shows the next need, capture called exactly once even on double click.
- `useOrgStream` cache patching updates a tile's progress.
- `readNdjson`: split lines, partial chunks, invalid line → error event.
- `ApprovalCard`: renders every preview line; Approve/Reject call the right endpoint once; failed status shows the error.
- Intake review: editing quantity updates the estimate; unticked rows aren't published; failed publish keeps the row.
- An a11y smoke test per page with `jest-axe` (optional if time allows).

## 12. Demo video and write-up (you lead both)

- **Video (< 3 min, script in the plan §12):** record on the live URL with seeded data. Prepare: two browsers side by side (phone-sized donor window + big-screen `?display=1` wall), the PayPal sandbox buyer logged in, B's demo photos (handwritten list + empty shelf + arrival photo), the Room 12 winter-coats needs for the invoice scene, a funded Harbor need with a cheaper fresh price for the purchase scene. Rehearse Mon Nov 9, record Tue Nov 10. Captions on. Show the approval card clearly (the guardrail story) and end on the live URL.
- **Devpost write-up** (`docs/devpost.md` draft): problem, what it does, how we built it (stack diagram), **PayPal** section (A writes), **AI + AG Studio** section with the guardrail list (B writes), challenges, what's next (verified nonprofit accounts, per-charity payees, real emails), "impact receipts are not tax receipts", sandbox-only note, links (live URL, repo, video), test logins.
- Screenshots: tile wall (desktop + phone), donate, impact with photo, intake review, purchase plan, approval card, dashboard.

## 13. Your tasks, in order (one PR each unless noted)

The team is about a day behind. A-1 (Tue Oct 27 AM) creates the monorepo. Before it merges, do C-0 outside the repo.

| # | When | Task | Done when |
|---|---|---|---|
| **C-0** | Mon Oct 26 – Tue Oct 27 AM | Wireframes for tile wall, donate, impact, intake, need management, assistant; pick the tokens (§10); set up the GitHub Projects board with P0/P1/P2 labels and the issues from all three briefs; book the daily standup | Board live, wireframes shared |
| **C-1** | Tue Oct 27 | `apps/web` scaffold (§5–6), all dependencies incl. B's, Tailwind + shadcn, router with every route as a placeholder, `/dashboard` lazy route to B's file (create the placeholder from §0 rule 1 and tell B), `lib/api.ts`, `env.ts`, MSW setup + fixtures validated by schemas, layout + landing | `VITE_USE_MOCKS=true pnpm dev` shows the landing page with mock orgs; CI green |
| **C-2** | Wed Oct 28 | Tile wall + `TileCard` + `ProgressBar` + org header + filters; `docs/design-tokens.md` | Tile wall looks finished on phone and desktop with mocks |
| **C-3** | Wed Oct 28 – Thu Oct 29 | Need detail + `DonatePanel` + PayPal buttons + mock button + thank-you page | Mock donation flow end to end; with A's API, a real sandbox payment |
| **C-4** | Thu Oct 29 | Staff login + gate + console + intake screen (§9.8) | Mock intake → review → publish works; with B's route, a real photo works |
| **C-5** | Fri Oct 30 | Live updates (`useOrgStream`), held segment, aria-live, big-screen mode, mobile polish | Two real browsers: one pays, the other's bar moves |
| **C-6** | Sat Oct 31 | Integration with A (real API, contract fixes reported via `HANDOFF.md`), timeline component, need page shell for staff | Every P0 screen works with `VITE_USE_MOCKS=false` |
| — | **Sun Nov 1** | **Milestone 1** review (you run it with the checklist) | |
| **C-7** | Mon Nov 2 | Purchase plan card + approve + mark ordered (§9.9) | Works against B's + A's routes |
| **C-8** | Tue Nov 3 | Delivery panel + donor impact page with photos (§9.5, §9.9) | Delivered photo appears on the impact page |
| **C-9** | Wed Nov 4 | Assistant chat + ApprovalCard + pending list + reconcile table (§9.10) | Invoice prompt → card → approve → invoice link + QR |
| **C-10** | Thu Nov 5 | Invoices page; dashboard route/layout polish with B; Match me box (P1) | |
| **C-11** | Fri Nov 6 | QR flyers (P1); empty/error/loading states everywhere; a11y pass | Lighthouse a11y ≥ 90 on the main pages |
| — | **Sat Nov 7** | **Feature freeze** (you enforce it) | |
| **C-12** | Nov 8–11 | Bug bash (test B's AI with the plan's checklist §11), sort the bug list, visual polish, video script + rehearsal (Mon), record + edit (Tue), screenshots, Devpost, **submit Wed Nov 11**; everyone checks every link in a private window | Submitted |

## 14. Handoffs (who waits on what)

| You need | From | By | Until then |
|---|---|---|---|
| Monorepo + shared contract | A (A-1) | Tue Oct 27 AM | C-0 work |
| Real public read endpoints + staff auth | A | Wed Oct 28 | Mocks |
| Create order + capture + SSE | A | Thu Oct 29 | Mock button + mock emitter |
| Intake route | B | Wed Oct 28 | Mock |
| Seed data | B | Thu Oct 29 | Mock fixtures |
| Purchase plan / approve / ordered | B / A | Mon Nov 2 | Mocks |
| Delivery / impact data | B / A | Tue Nov 3 | Mocks |
| Assistant stream / approve-reject | B / A | Wed Nov 4 | Mock NDJSON |
| `DashboardPage.tsx` | B | Sat Oct 31 | Placeholder |
| Demo photos | B | Fri Nov 6 | — |

| You give | To | By |
|---|---|---|
| Router entry for `/dashboard` + layout height + tokens | B | Wed Oct 28 |
| Donate panel calling real create/capture | A (to test capture) | Thu Oct 29 |
| Approval cards working | A, B | Wed Nov 4 |

**Scope keeper duties:** daily 15-min standup (yesterday / today / blockers); keep the board current; anything not P0 waits until Milestone 1 passes; P2 only after Nov 7; on Nov 7 cut whatever isn't done.

## 15. Definition of done (every PR)

- Typecheck, lint and tests green; works in mock mode **and** against the real API (once it exists).
- Every response parsed with its shared schema; no money maths beyond display and the labelled estimate.
- Loading, empty and error states present; works at 360 px; keyboard and screen-reader basics checked.
- No edits outside your paths (§2); contract problems reported in `HANDOFF.md`, not patched in the UI.
- Screenshots (phone + desktop) in the PR description for any visible change.

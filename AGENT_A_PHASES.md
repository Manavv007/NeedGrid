# NeedGrid — Agent A Phase Plan (Payments & Backend)

> Use with `AGENT_A_BACKEND.md` (the "what/how"). This file is the "when": work phases, each followed by a **SYNC** phase that gets the work onto `main` and tells B and C exactly what to pull and do.
> Task ids (A-1 … A-14) and section numbers (§) refer to `AGENT_A_BACKEND.md`.
> Today is **Tue Oct 27**. Phase 1 is late by half a day, so do it first: B and C are blocked until SYNC 1.

---

## How every SYNC phase works

Pick one fixed **sync slot** each day (for example 21:00 IST, right after the standup) so B and C know when to expect pulls.

### A's checklist (run in order)

1. Bring your branch up to date without rewriting history:
   ```bash
   git fetch origin
   git merge origin/main          # resolve conflicts, never force-push
   pnpm install
   ```
2. Verify locally:
   ```bash
   pnpm typecheck && pnpm lint && pnpm test
   pnpm --filter @needgrid/api check:money   # from Phase 4 on
   ```
3. Push and open the PR:
   ```bash
   git push -u origin feat/<area>-<thing>
   gh pr create --title "<short title>" --body "<summary / tested / blocked>"
   ```
4. Get **B's** approving review (B reviews A) and a green CI. Squash-merge.
5. If the phase added a migration: run `db:migrate` against the **main** Neon branch (the Render build also runs it).
6. Wait for Render to deploy `main`. Check `GET <API_URL>/api/health` → `{ ok: true, db: true }`, and smoke-test the endpoints this phase added.
7. If `packages/shared` changed: version bumped and one line in `packages/shared/CHANGELOG.md`.
8. Post the announcement (template below) in the team chat **and** as a comment on the merged PR.

### Announcement template

```text
SYNC <n> merged to main (<PR link>) — please pull.

What's new:
- <endpoint / function / file> …

Shared contract: <unchanged | v1.x.y: what changed>
Migration: <none | yes: run `pnpm --filter @needgrid/api db:migrate` on your Neon branch>
New env vars: <none | NAME (where to get it)>
Unblocked:
- B: <what B can now do>
- C: <what C can now do>
Known gaps: <stubs still throwing, limits>
```

### What B and C run after each announcement

```bash
git checkout main && git pull
pnpm install
pnpm --filter @needgrid/api db:migrate     # only if "Migration: yes"
# then update your own feature branch (no rebase, no force-push):
git checkout feat/<your-branch> && git merge main
```

Then add any new env vars to their local `.env` files, run their own tests, and reply "pulled ✓" (or a problem) in the thread.

### Rules that keep syncs painless

- One phase = one or a few **small** PRs; merge them before the sync slot, not all at once at midnight.
- Never merge to `main` in the hour before Milestone 1 (Sun Nov 1) or freeze (Sat Nov 7) unless it fixes a blocker.
- Contract changes are additive only (§0 rule 3) and always announced.
- If a sync slips, post the new time immediately so nobody waits blind.

---

## Phase 1 — Foundation (Tue Oct 27, now) · task A-1

**Goal:** a repo everyone can clone, install and build on.

- Root monorepo config (§9.2), `.env.example` (§9.1), `render.yaml` (§9.3), CI (§9.4), MIT `LICENSE`, `HANDOFF.md` with headings A / B / C.
- `packages/shared` **verbatim** from §5, plus `money.test.ts`.
- `apps/api` skeleton (§7): `buildApp`, `env.ts`, error handler, `HttpError`, staff-auth plugin, CORS, rate-limit, `GET /api/health` (db: false is fine for now), `core/index.ts` stubs (§7.2), B's stubs (§7.3), `aiPlugin` registered.
- Install all API dependencies including B's (`ai`, `@ai-sdk/google`, `@channel3/sdk`).

**Done when:** a fresh clone runs `pnpm install && pnpm typecheck && pnpm test` green, and CI is green.

### SYNC 1 — Tue Oct 27 evening (highest priority of the whole project)

- Ask B for a fast review (this PR is large; the contract is copied verbatim from the brief, so review the config and skeleton).
- Announce: shared contract v1.0.0; `.env.example` exists (everyone copies it to `apps/api/.env` / `apps/web/.env`); no migration yet.
- **Unblocked:** B starts `channel3/` and intake inside `apps/api/src/ai`; C runs task C-1 (creates `apps/web`, installs web deps incl. AG Studio).

---

## Phase 2 — Database, deploy and read endpoints (Wed Oct 28) · A-2, A-3

- Drizzle schema (§6), first migration (extensions `vector`, `pgcrypto`), `db:generate` / `db:migrate` scripts, `db` + `schema` exports (`./db`, `./core`).
- Render: create both services from `render.yaml`, set env vars, first deploy. `/api/health` reports `db: true`.
- `toNeedCard` + `core.getNeedCard(s)`, `listDonatableNeeds`, `getNextMostUrgentNeed`, `setNeedEmbedding` (real implementations).
- `GET /api/orgs`, `/orgs/:slug`, `/needs/:id` (with timeline), staff endpoints `me`, `needs` list/detail, `POST /staff/needs` (calls `ai.embedNeedText`), `PATCH /staff/needs/:id`.
- Tests with `app.inject` that parse responses with shared schemas; a 401 test.

**Split into two PRs:** (a) schema + migration + deploy (merge early in the day), (b) endpoints.

### SYNC 2 — Wed Oct 28 evening

- Migration: **yes** (everyone runs `db:migrate` on their own Neon branch).
- Announce the live API and web URLs.
- **Unblocked:** B writes the seed script against the real schema and can call the `core` read functions; C switches tile wall / need page / staff list to the real API (`VITE_USE_MOCKS=false`) once B's seed lands.
- Ask C to have the donate panel ready to call create-order/capture by tomorrow evening.

---

## Phase 3 — Donations core (Thu Oct 29) · A-4, A-5

- PayPal client (§8.1): OAuth caching, retries, `PayPal-Request-Id`.
- `POST /api/donations/orders` (§8.2) with the locked transaction and holds.
- `POST /api/donations/orders/:orderId/capture` + `recordCapture` (§8.3), `allocate`, `refreshNeedStatus`, `distribute`.
- SSE stream + `publishNeedUpdated` (§8.9), `GET /api/impact/:token`.
- DB tests: clamp, holds, parallel create-order, exact fund → `funded`, capture twice → one donation.

### SYNC 3 — Thu Oct 29 evening

- Migration: none expected (say "yes" if the schema changed).
- New env vars: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV=sandbox` (each person's own sandbox app), `VITE_PAYPAL_CLIENT_ID`; optional `HOLD_SECONDS=60` for testing.
- Share the sandbox **buyer** login for testing.
- **Unblocked:** C connects the real PayPal buttons and the SSE live bars; B's seed can now be checked with real `NeedCard`s.

---

## Phase 4 — Webhooks and money safety (Fri Oct 30) · A-6, A-7

- `POST /api/webhooks/paypal` (§8.4): raw body, signature verification, `webhook_events` dedupe, capture fallback. Register the webhook on the sandbox app via a `cloudflared` tunnel locally and on the Render URL for production.
- Holds release job, overflow / no-consent paths (`unallocated_cents` + system refund proposal stub), rate limits, pino redaction, `check:money` script + `assertInvariants()`.
- All §9.5 money tests that don't depend on purchases/agent actions.

### SYNC 4 — Fri Oct 30 evening

- New env var: `PAYPAL_WEBHOOK_ID` (each sandbox app has its own).
- Tell B: run `check:money` after every seed run; seed must pass it.
- **Unblocked:** C can test "close the PayPal popup → hold released" and the clamped/fully-funded states for real.

---

## Phase 5 — Integration and Milestone 1 prep (Sat Oct 31) · A-8

- Pair with C on the real API: fix contract mismatches (additive changes only, each one announced).
- Set every env var on Render (both services), reseed the main Neon branch with B's seed, confirm CORS for the Render web origin.
- Run the Milestone 1 flow yourself on the live URL: photo → tiles → sandbox donation → bar fills on a second browser → Funded.
- Merge small fixes during the day as they're ready (each with a short "pulled?" message).

### SYNC 5 — Sat Oct 31 night: **pre-milestone freeze of `main`**

- Last merge before Milestone 1. Post the final live URLs, the demo passcodes and the sandbox buyer login.
- From this point until the review ends, only blocker fixes go to `main`.

## Milestone 1 review — Sun Nov 1 (all, 1 h)

Run the flow on the live URL with B and C. Log every issue as a GitHub issue with an owner. Fix blockers the same day (each fix is its own small PR + short announcement).


---

## Phase 6 — Purchases (Mon Nov 2) · A-9

- `core.createProposedPurchase`, `POST /staff/purchases/:id/approve` (exact / surplus with paired `price_drop` allocations / gap → `topping_up`), `POST /staff/purchases/:id/ordered` (§8.5).
- `purchases.test.ts`; invariants hold after every case.

### SYNC 6 — Mon Nov 2 evening

- Migration: only if the purchases table changed.
- **Unblocked:** B's purchase-plan route works end to end (no more mock of `createProposedPurchase`); C wires the Approve and Mark-ordered buttons.

---

## Phase 7 — Deliveries + assistant read/propose functions (Tue Nov 3) · A-10, first half of A-11

- `core.recordDelivery`, `core.confirmDelivery`; delivery data in need detail, staff need detail and impact responses.
- `core.proposeAction` (validate with `MONEY_TOOL_ARGS`, org checks, computed amounts, `preview.lines`, never calls PayPal) + `GET /api/staff/agent/actions`.
- `core.listPayPalTransactions` (Transaction Search, ≤ 31 days) and `core.listRecordedDonations`.
- Enable **Transaction Search** on the sandbox app (needed for reconcile).

> This phase pulls `proposeAction` forward by half a day because B needs it on **Wed Nov 4 morning** to build the assistant.

### SYNC 7 — Tue Nov 3 evening

- **Unblocked:** B builds delivery check and the staff assistant against real `core` functions; C builds the delivery panel and shows pending approval cards from `GET /api/staff/agent/actions`.
- Known gap to announce: approve/reject arrive tomorrow (cards can render but not act yet).

---

## Phase 8 — Approve → execute (Wed Nov 4) · second half of A-11

- `POST /api/staff/agent/actions/:id/approve` and `/reject`: locked status change, executor runs with **stored** args + computed only.
- `agent/executors.ts` skeleton, `paypal/toolkit.ts` wrapper (toolkit tools called directly, REST fallback, never given to the model).
- `actions.test.ts`: propose never calls PayPal, reject runs nothing, approve uses stored args, changed amounts → `failed`, wrong org → rejected.

### SYNC 8 — Wed Nov 4 evening

- **Unblocked:** C's ApprovalCard Approve/Reject buttons work for real; B can run full assistant conversations.

---

## Phase 9 — Sponsor invoices end to end (Thu Nov 5) · A-12

- Propose → execute (§8.6): sponsor holds, PayPal create → send → QR, failure releases holds.
- `INVOICING.INVOICE.PAID` webhook → `recordInvoicePaid` → allocations with reason `sponsor` across every need on the invoice.
- `GET /api/staff/invoices`. Subscribe the sandbox webhook to `INVOICING.INVOICE.PAID`.
- Test: pay the invoice from the sandbox personal account → every tile on it shows Funded.

### SYNC 9 — Thu Nov 5 evening

- **Unblocked:** C's invoices page and the invoice result on the ApprovalCard (payer link + QR); the demo's "invoice Acme Hardware" scene works end to end.

---

## Phase 10 — Refunds, roll-over, security (Fri Nov 6) · A-13

- `create_refund` executor + refundable-amount rules, roll-over job + `job:rollover` script (§8.8, P1: drop it if the day runs short).
- Security pass (§8.10): CORS origins, `trustProxy`, per-route rate limits, body limit, Cloudinary URL check, log redaction, no personal data in public responses.

### SYNC 10 — Fri Nov 6 evening: **last feature merge**

- Everything you want in the judged version must be on `main` by now.

---

## Phase 11 — Feature freeze (Sat Nov 7)

- Morning: merge only what was already in review. Evening: freeze. Anything unfinished is cut or moved to P2 (C, as scope keeper, makes the call).
- Tag `v0.9.0-freeze` on `main` and announce it: "No features from now on. Bug fixes only, one small PR each."

---

## Phase 12 — Bug bash to submission (Sun Nov 8 – Wed Nov 11) · A-14

| Day | Your work | Sync |
|---|---|---|
| Sun Nov 8 | Bug bash (3 h): test C's screens with the plan's §11 checklist. Put `VITE_AG_STUDIO_LICENSE` into Render. | Each fix: small PR, merge, one-line note in the bug thread. One batch announcement in the evening |
| Mon Nov 9 | Fixes; README (setup, architecture, sandbox buyer login, staff passcodes, guardrails); uptime monitor on `/api/health` | Evening announcement: "README merged, reseed done?" (B reseeds production) |
| Tue Nov 10 | Run the screens while C records; write the PayPal section of the write-up | **No merges during recording** unless C asks |
| Wed Nov 11 | Move the API to Render **Starter**; final deploy; tag **`v1.0.0`**; everyone checks every link in a private window; C submits | Final announcement: "v1.0.0 is the judged version. Do not push to `main` until judging ends (Dec 15)." |

---

## Summary

| Phase | Date | Main output | Sync | Unblocks |
|---|---|---|---|---|
| 1 Foundation | Tue Oct 27 | Monorepo, shared contract, API skeleton, CI | **SYNC 1** Tue night | B and C start |
| 2 DB + reads | Wed Oct 28 | Schema, deploy, read + publish endpoints | SYNC 2 (migration) | B seed, C real reads |
| 3 Donations | Thu Oct 29 | Create order, capture, SSE, impact | SYNC 3 (PayPal env) | C real checkout |
| 4 Webhooks + safety | Fri Oct 30 | Webhooks, holds job, money tests | SYNC 4 (webhook id) | Edge-case testing |
| 5 Integration | Sat Oct 31 | Live flow works | SYNC 5 (pre-milestone freeze) | Milestone 1 |
| 6 Purchases | Mon Nov 2 | Approve / ordered | SYNC 6 | B purchase plan, C cards |
| 7 Deliveries + propose | Tue Nov 3 | Deliveries, `proposeAction`, PayPal reads | SYNC 7 | B assistant, C delivery |
| 8 Approve/execute | Wed Nov 4 | Approve / reject, executors | SYNC 8 | C approval cards |
| 9 Invoices | Thu Nov 5 | Sponsor invoice loop | SYNC 9 | Invoice demo scene |
| 10 Refunds + security | Fri Nov 6 | Refunds, roll-over, hardening | SYNC 10 (last feature) | — |
| 11 Freeze | Sat Nov 7 | `v0.9.0-freeze` | Freeze announcement | Bug bash |
| 12 Ship | Nov 8–11 | Fixes, README, `v1.0.0` | Daily batches, final | Submission |

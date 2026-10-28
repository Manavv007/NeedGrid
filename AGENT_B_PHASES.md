# NeedGrid — Agent B Phase Plan (AI & Data)

> Use with `AGENT_B_AI_DATA.md` (the "what/how"). This file is the "when": work phases, each followed by a **SYNC** phase
> that gets the work onto `main` and tells A and C what to pull and do. Task ids (B-0 … B-11) and § numbers refer to
> `AGENT_B_AI_DATA.md`. Read `NOTES.md` first (environment, SDK and money gotchas).
>
> **Status on Wed Oct 28:** A is at Phase 4 (foundation, schema, read endpoints and donations are merged; webhooks in review).
> B has not started: B-0 and B-1 were due Oct 26–27. `apps/web` does not exist yet (C-1 not merged).
> The plan below compresses B-0…B-3 into Wed–Thu so C has a real intake route and seed data before Milestone 1.

---

## How every SYNC phase works

Use the same daily sync slot as A (after the standup) so A and C know when to pull.

### B's checklist (in order)

1. Branch from fresh `main`, one short-lived branch per PR (`feat/ai-<thing>`, `feat/dashboard-<thing>`):
   ```powershell
   git fetch origin; git switch main; git merge --ff-only origin/main; pnpm install
   git switch -c feat/ai-<thing>
   ```
   Before the PR, catch up again with `git merge origin/main` (never rebase or force-push).
2. Verify locally (check `$LASTEXITCODE`, not red stderr):
   ```powershell
   pnpm format:check; pnpm typecheck; pnpm lint; pnpm test   # CI runs all four; format:check first (fix: pnpm format)
   pnpm --filter @needgrid/api evals <feature>       # only if a prompt changed: paste before/after numbers in the PR
   pnpm --filter @needgrid/api check:money           # after any seed run
   ```
3. Commit only B paths (`git add apps/api/src/ai apps/api/src/channel3 apps/api/scripts/seed apps/web/src/dashboard`).
   Push, `gh pr create` (summary / tested / blocked).
4. Reviewer: **A** for anything under `apps/api`, **C** for `apps/web/src/dashboard`. CI green, merge.
5. After Render deploys `main`: call the new route on the live URL (`/api/health` first; free plan may take ~50 s to wake).
6. If a response shape you return changed: add a line under **C** in `HANDOFF.md` so C updates the MSW mocks.
7. Post the announcement (template below) in the team chat and on the merged PR.

### Announcement template

```text
SYNC B<n> merged to main (<PR link>) — please pull.

What's new:
- <endpoint / function / script> …

Shared contract: unchanged | PR to packages/shared (A reviewing): <what>
Response shapes changed (C: update MSW mocks): none | <endpoint>
New env vars: none | NAME (where to get it; also add on Render by hand)
Seed: none | reseeded <Neon branch>; run `pnpm --filter @needgrid/api seed --reset --offline` on your branch
Unblocked:
- A: <…>
- C: <…>
Known gaps / eval numbers: <…>
```

### What A and C run after a B announcement

```powershell
git switch main; git pull; pnpm install
pnpm --filter @needgrid/api seed --reset --offline   # only if "Seed: reseeded"
pnpm --filter @needgrid/api check:money
```

---

## Phase 0 — Accounts and fixtures (Wed Oct 28, first hour) · B-0

Needs the human, not the agent. Everything after this can be coded against mocks, but real runs need keys.

- `apps/api/.env`: `GOOGLE_GENERATIVE_AI_API_KEY` (AI Studio), `CHANNEL3_API_KEY` (+ redeem `PAYPAL-HACKATHON-2026`),
  `DASHBOARD_HMAC_SECRET` (any 32+ random chars locally). All three are empty today.
- Cloudinary: unsigned upload preset (folder `needgrid`), needed to upload eval and demo photos.
- Start collecting the 20 intake inputs + `expected.json` (can finish by Fri; evals don't block B-1).
- Ask A (HANDOFF) to confirm the three keys exist on Render (`sync: false` vars left empty at Blueprint creation are not created; NOTES §9).

## Phase 1 — Channel3 + AI foundation + intake (Wed Oct 28) · B-1

- `channel3/`: `client.ts` (SDK client + 24 h / 1 h in-memory cache), `normalize.ts` (offer pick, pack-size parser with 20+ titles), `index.ts` (`searchProducts`, `lookupByUrl`, `refreshProduct`).
- `ai/models.ts` (Gemini handles, `withRetry`, 25 s timeout, LRU cache, 503 when unconfigured), `ai/untrusted.ts`.
- `ai/prompts/intake.ts`, `ai/intake.ts` (extraction + deterministic pack math), `ai/rank.ts` (LLM rank + price fallback).
- `ai/routes/intake.ts` registered in `aiPlugin` (staff, 10/min). Image path: `assertCloudinaryUrl` + resized delivery URL.
- Unit tests: normaliser, pack parser, pack math, rank fallback ordering, `wrapUntrusted`, route with mocked model + fake Channel3.
- One real Channel3 call and one real Gemini call from a throwaway script to confirm SDK shapes (then delete it).

### SYNC B1 — Wed Oct 28 evening

- **Unblocked:** C builds the intake screen against the real `POST /api/staff/intake` (or MSW with the same shape).
- Contract: unchanged. Env: the three B keys.

## Phase 2 — Intake hardening + embeddings (Thu Oct 29 morning) · B-2

- URL fallback (`text` matching `^https?://` → `lookupByUrl` → one draft).
- `embedNeedText` (768 dims, never throws) so A's publish stores embeddings; `writeImpactNote` stays the stub until B-7.
- Prompt hardening + `fixtures/injection/`; eval runner `ai/evals/run.ts` with intake scoring and first numbers committed.
- Small PR, merged before noon so it doesn't collide with the seed PR.

## Phase 3 — Seed data (Thu Oct 29) · B-3 · highest-priority B deliverable before Milestone 1

- `scripts/seed/` (`--reset`, `--offline`, `--seed 2026`): 3 orgs, 40–60 needs each with real Channel3 products
  (`products.cache.json` committed), 8 weeks of history (600–900 donations, allocations summing exactly, consistent timestamps),
  demo hero needs, embedding backfill.
- Money rules: insert donation + allocations together; `funded_cents` = sum of allocations; ordered/delivered rows get
  purchases/deliveries rows; ends by running `check:money` and failing on errors.
- Run against own Neon branch, then (with A) against `production`.

### SYNC B2/B3 — Thu Oct 29 evening

- Seed: **reseeded `production`**; everyone runs `seed --reset --offline` on their own branch.
- **Unblocked:** C switches tile wall / need page / staff list to the real API; A checks donations on real seeded `NeedCard`s.

## Phase 4 — Purchase plan + dashboard datasets (Fri Oct 30) · B-4 (+ datasets from B-5)

- `ai/purchasePlan.ts` + route: refresh, best offer, deterministic money via `planPurchaseMoney`, flags, LLM explanation
  (facts only), refresh-failure flag. `core.createProposedPurchase` is a stub until Mon Nov 2: mock it in tests.
- Pulled forward from B-5: `ai/datasets.ts` + `GET /api/dashboard/datasets/:name` (60 s cache, HMAC donation keys,
  no-personal-data test). Backend-only, so Saturday is free for AG Studio.

### SYNC B4 — Fri Oct 30 evening

- **Unblocked:** C builds the purchase card against the route's shape (MSW until A's `createProposedPurchase` lands).
- Datasets are live for the dashboard spike.

## Phase 5 — AG Studio spike (Sat Oct 31) · B-5

- Read AG Studio docs + PayPal boilerplate (`app/dashboard/studio`, `app/api/ai/responses/route.ts`); choose relay option A or B (§10.3) and write the choice in NOTES.
- `apps/web/src/dashboard/`: `data.ts` (3 sources + relationships), `reportState.ts` v1, `geminiAdapter.ts`, `DashboardPage.tsx` (default export).
  If C-1 hasn't created `apps/web` yet, build it standalone and ask C (HANDOFF) for the route + deps.
- `ai/dashboardRelay.ts` + `POST /api/ai/dashboard-complete` (public, 20/min, 200 KB cap, forced model, 503 without key).

### SYNC B5 — Sat Oct 31 night = A's **pre-milestone freeze**

- Merge before A's freeze slot or hold until after the review. Only blocker fixes after this.

## Milestone 1 review — Sun Nov 1

B's part of the flow: photo → drafts → publish → tiles. Run intake on the live URL with the demo photos; log issues with owners.

---

## Phase 6 — Dashboard v2 (Mon Nov 2) · B-6

- **Request the AG Studio trial licence today** (45 days). Give the key to A for Render (`VITE_AG_STUDIO_LICENSE`).
- Both pages ("Impact", "Charities"), theme from C's tokens, view/edit toggle, `localStorage` edits + Reset.
- After A's SYNC 6: drop the `createProposedPurchase` mock and test the purchase plan end to end.

### SYNC B6 — Mon Nov 2 evening: dashboard live on the deployed URL (C reviews).

## Phase 7 — Proof of delivery (Tue Nov 3) · B-7

- `ai/delivery.ts` (`checkDeliveryPhoto`, real `writeImpactNote`), routes `delivery` + `confirm`; failure → `needsReview`, never auto-approve.
- `core.recordDelivery` / `confirmDelivery` land today (A Phase 7): mock until SYNC 7, then test for real.
- Start `assistant/tools.ts` against mocked `proposeAction` (A delivers it tonight).

### SYNC B7 — Tue Nov 3 evening · **Unblocked:** C's delivery screen.

## Phase 8 — Staff assistant + dashboard AI (Wed Nov 4) · B-8

- `assistant/{tools,systemPrompt,chat}.ts` + route (staff, 20/min): 6-step loop → NDJSON `AgentStreamEvent`s via `sendNdjson`.
- Dashboard agent read-only (Studio tools only), prompt starters, chat hidden on relay 503 (fallback §10.4).
- `fixtures/assistant/` evals: "refund everyone", "send $500 to me", "show donor emails" → no proposal.

### SYNC B8 — Wed Nov 4 evening · **Unblocked:** C's chat panel + approval cards with real proposals.

## Phase 9 — Reconcile + Match me (Thu Nov 5) · B-9

- `assistant/reconcile.ts` (deterministic, 3 h pending window, every mismatch kind tested) + `reconcile` tool.
- P1 Match me: pgvector query, re-rank, partial-gift fill, one LLM call for reasons. Drop if the day runs short.

### SYNC B9 — Thu Nov 5 evening · demo scene "check this week's money" works.

## Phase 10 — Polish + evals (Fri Nov 6) · B-10

- Dashboard KPIs (median days funded→delivered), delivered photos grid; rerun every eval, tune prompts to targets.

### SYNC B10 — Fri Nov 6 evening: **last feature merge** (same as A's SYNC 10).

## Phase 11 — Feature freeze (Sat Nov 7)

Merge only what's already in review. Unfinished P1 (Match me, refund tool) is cut (C decides).

## Phase 12 — Bug bash to submission (Nov 8–11) · B-11

| Day | Work |
|---|---|
| Sun Nov 8 | Bug bash: test A's flows (plan §11 checklist), esp. "refund everyone" and "show donor emails" |
| Mon Nov 9 | Fixes; reseed production (`seed --reset --offline`, then embeddings); "How we use AI" + AG Studio write-up with guardrail list |
| Tue Nov 10 | Run AI screens while C records; no merges during recording |
| Wed Nov 11 | Final demo-data check, save the default dashboard, check every link in a private window |

---

## Summary

| Phase | Date | Main output | Sync | Unblocks |
|---|---|---|---|---|
| 0 Accounts | Wed Oct 28 AM | Keys, preset, fixtures started | — | Real runs |
| 1 Intake | Wed Oct 28 | Channel3, models, intake route | **B1** | C intake screen |
| 2 Hardening | Thu Oct 29 AM | URL fallback, embeddings, evals | (with B3) | A publish embeddings |
| 3 Seed | Thu Oct 29 | Seed + products cache | **B2/B3** (reseed) | C real data, Milestone 1 |
| 4 Purchase plan | Fri Oct 30 | Purchase plan, datasets | **B4** | C purchase card |
| 5 AG Studio spike | Sat Oct 31 | Dashboard v1, relay | **B5** (pre-milestone) | Dashboard demo |
| 6 Dashboard v2 | Mon Nov 2 | Licence, 2 pages, edits | **B6** | Live dashboard |
| 7 Delivery | Tue Nov 3 | Photo check, impact note | **B7** | C delivery screen |
| 8 Assistant | Wed Nov 4 | Tools, NDJSON chat, read-only dashboard AI | **B8** | C chat + approvals |
| 9 Reconcile + Match | Thu Nov 5 | Reconcile, Match me (P1) | **B9** | Demo money scene |
| 10 Polish | Fri Nov 6 | KPIs, evals at target | **B10** (last feature) | — |
| 11 Freeze | Sat Nov 7 | — | — | Bug bash |
| 12 Ship | Nov 8–11 | Reseed, write-up | Daily | Submission |

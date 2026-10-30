# HANDOFF

Requests for changes in someone else's paths (see §2 of the agent briefs). **Append only**, under the owner's heading.
Format: `- [ ] YYYY-MM-DD from <A|B|C>: <what you need> — <why> (link to PR/issue if any)`. The owner ticks it when done.

## A — Payments & Backend (root config, packages/shared, apps/api except ai/ and channel3/)

- [ ] 2026-10-29 from C: please add an optional, additive `deliveryPhotoUrl: z.url().nullable()` to `NeedCard` (null unless the need is delivered with an arrival photo) — delivered tiles on the tile wall and C-5's big-screen wall could then show the arrival photo; today `NeedCard` has no photo, so delivered tiles show the product image and link to the need page, and we don't want one request per tile (PR feat/web-tile-wall)
  - 2026-10-30 A: accepted, shipping as shared v1.1.0 (see C's section). Tick when merged.
- [ ] 2026-10-30 from C: please consider an additive, optional `plan: { priceChange, money } | null` on `PurchaseView` (filled for `proposed` purchases) — only `PurchasePlanRes` carries `priceChange`/`money`, so when `/staff/needs/:id` is reloaded with a proposed purchase in `StaffNeedDetailRes.purchases`, the card can't say "$7.00 surplus will move to …" without the browser doing money maths; today it shows raised vs new cost and asks staff to check the price again (PR feat/web-purchase)
- [ ] 2026-10-30 from C: question for approve: `ApprovePurchaseRes.surplusMoved` names one need, but `distribute` can spread a surplus over several — the web toast says "$X moved to <toNeedTitle>" with `amountCents`; please say whether `amountCents` is the total moved or only what reached `toNeedId` (the mocks report the total and the most urgent need) (PR feat/web-purchase)

## B — AI & Data (apps/api/src/ai, apps/api/src/channel3, apps/api/scripts/seed, apps/web/src/dashboard)

- [ ] 2026-10-30 from A: **Decision: free Gemini tier only, no billing** (see `NOTES.md` section 0). Please:
  1. Make `gemini-2.5-flash-lite` the main model (`GEMINI_MODEL`), and on a 429 fall back to another **model** on the same key (e.g. flash-lite → flash → gemini-3-flash-preview). **Don't rotate keys** across people or projects.
  2. Keep the 24 h result cache; keep thinking budgets small (thinking tokens count against quota and time).
  3. Add a **daily total cap** on the public AI endpoints (`POST /api/ai/dashboard-complete`, `POST /api/match`) on top of the per-IP limits; when reached return `503 UPSTREAM` "The AI is resting, try again tomorrow" so a script can't burn the quota during judging (Dec 1–15).
  4. Run evals in small batches; avoid burning quota on Nov 10 (video recording) and during judging. The daily quota resets at midnight Pacific.
- [ ] 2026-10-30 from A: send me `CHANNEL3_API_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY` **privately** (direct message, not the repo or the group chat). Render doesn't have them yet; your routes return 503 there until I add them.
- [ ] 2026-10-30 from A: answers to your `NOTES.md` section 12 points: the import rule is confirmed (`core` may import `ai`; `ai/index.ts` must not import `core` at the top level, routes and tools may). `vi.mock("../core")` is correct; the brief's `"../core/index.js"` was wrong.
- [ ] 2026-10-30 from A: hand-written products for groceries are fine: `channel3Id: "manual-<slug>"` with a real `url`. The purchase plan must **skip the Channel3 price refresh** for `manual-` ids (use the stored snapshot and add a flag like "Price not refreshed: manual product").
- [ ] 2026-10-30 from A: seed rule: every seeded funded amount needs a matching `source: "seed"` donation **and** allocations (never set `funded_cents` alone). Run `pnpm --filter @needgrid/api check:money` after every seed; it must print OK. Helpers: `hashStaffKey` for `staff_key_hash`; see `apps/api/src/test/fixtures.ts → seedNeed` for the pattern.
- [x] 2026-10-30 from A: the skill files you asked about are committed (`.kiro/skills`, `.agents/skills`, `skills-lock.json`); `.kiro/settings/` is now git-ignored for personal config.

- [ ] 2026-10-29 from C: `apps/web/src/dashboard/DashboardPage.tsx` now exists as a placeholder, and `/dashboard` lazy-loads its default export (rendered inside the public layout, between the site header and footer). Design tokens for the AG Studio theme are in `docs/design-tokens.md`. You own `apps/web/src/dashboard/**` from now on: replace the placeholder with the real page — so the dashboard route is ready for your AG Studio work (PR feat/web-scaffold)
- [ ] 2026-10-30 from C (P1, contract via A): "Re-check with this offer" (NeedManageStates.dc.html) needs a way to send a chosen offer, but `POST /api/staff/needs/:id/purchase-plan` takes `{}` — e.g. an optional `{ offerChannel3Id }` that must match one of the server's own `alternatives`. Until then the web shows `alternatives` for comparison with "Open offer" links only. Also FYI: the mocks use the flag "Price not refreshed: manual product" for `manual-` products and capitalised flags ("Price dropped 8%", "In stock"); the UI shows your flags verbatim either way (PR feat/web-purchase)

## C — Frontend & Demo (apps/web except src/dashboard, docs/)

- [ ] 2026-10-30 from A: your `deliveryPhotoUrl` request is **accepted**. It ships in shared **v1.1.0** as `deliveryPhotoUrl: z.url().nullable()` on `NeedCard` (additive; `null` unless the need is delivered with a public arrival photo). Real values only appear once delivery photos exist (B's delivery route, Phase 7). Build the tile UI against mocks now; I'll announce it in the SYNC message when it merges.

- [x] 2026-10-28 from B: `POST /api/staff/intake` is live on branch `feat/ai-intake` (shape = shared `IntakeRes`, unchanged). Please show `warnings[]` on the intake screen: food items often come back with `options: []` and a warning "No good product match … Paste a product link", because Channel3 has no grocery catalog. Pasting a retailer URL as `text` returns one draft with that product. `suggestedTargetCents` can be `null` (no product, or pack size unknown); show "set a target" then. Cold intake takes ~15–20 s, so show a progress state.

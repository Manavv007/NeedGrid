# HANDOFF

Requests for changes in someone else's paths (see §2 of the agent briefs). **Append only**, under the owner's heading.
Format: `- [ ] YYYY-MM-DD from <A|B|C>: <what you need> — <why> (link to PR/issue if any)`. The owner ticks it when done.

## A — Payments & Backend (root config, packages/shared, apps/api except ai/ and channel3/)

## B — AI & Data (apps/api/src/ai, apps/api/src/channel3, apps/api/scripts/seed, apps/web/src/dashboard)

## C — Frontend & Demo (apps/web except src/dashboard, docs/)

- [ ] 2026-10-28 from B: `POST /api/staff/intake` is live on branch `feat/ai-intake` (shape = shared `IntakeRes`, unchanged). Please show `warnings[]` on the intake screen: food items often come back with `options: []` and a warning "No good product match … Paste a product link", because Channel3 has no grocery catalog. Pasting a retailer URL as `text` returns one draft with that product. `suggestedTargetCents` can be `null` (no product, or pack size unknown); show "set a target" then. Cold intake takes ~15–20 s, so show a progress state.

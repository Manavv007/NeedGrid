# HANDOFF

Requests for changes in someone else's paths (see §2 of the agent briefs). **Append only**, under the owner's heading.
Format: `- [ ] YYYY-MM-DD from <A|B|C>: <what you need> — <why> (link to PR/issue if any)`. The owner ticks it when done.

## A — Payments & Backend (root config, packages/shared, apps/api except ai/ and channel3/)

## B — AI & Data (apps/api/src/ai, apps/api/src/channel3, apps/api/scripts/seed, apps/web/src/dashboard)

- [ ] 2026-10-29 from C: `apps/web/src/dashboard/DashboardPage.tsx` now exists as a placeholder, and `/dashboard` lazy-loads its default export (rendered inside the public layout, between the site header and footer). Design tokens for the AG Studio theme are in `docs/design-tokens.md`. You own `apps/web/src/dashboard/**` from now on: replace the placeholder with the real page — so the dashboard route is ready for your AG Studio work (PR feat/web-scaffold)

## C — Frontend & Demo (apps/web except src/dashboard, docs/)

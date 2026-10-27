# NeedGrid

Shelters, food banks, classrooms and rescues post the exact items they need. Each item is matched to a real product at a real price. Donors fund item "tiles" through PayPal, and get a photo when their item arrives.

Built for the PayPal AI Hackathon (sandbox only: no real money moves). The plan and the per-person agent briefs are in the repo root:
`NEEDGRID_DEV_PLAN.md`, `AGENT_A_BACKEND.md`, `AGENT_B_AI_DATA.md`, `AGENT_C_FRONTEND.md`, `AGENT_A_PHASES.md`.

## Repo layout

```
apps/api         Fastify API (A; B owns src/ai, src/channel3, scripts/seed)
apps/web         React + Vite web app (C; B owns src/dashboard)   ← created in task C-1
packages/shared  zod schemas = the API contract, money helpers (A)
```

## Run locally

Requires **Node 22.18+** (or 24) and **pnpm 11** (`corepack enable` picks the pinned version).

```bash
pnpm install
cp .env.example apps/api/.env    # fill in the API block; on Windows: copy .env.example apps\api\.env
pnpm --filter @needgrid/api dev  # http://localhost:3000/api/health
```

Common scripts (from the repo root):

| Command | What it does |
|---|---|
| `pnpm typecheck` | TypeScript in every package |
| `pnpm lint` / `pnpm format` | ESLint / Prettier |
| `pnpm test` | Vitest in every package (no real API keys needed) |
| `pnpm --filter @needgrid/api build` | Production build of the API (`apps/api/dist`) |
| `pnpm --filter @needgrid/api db:generate` / `db:migrate` | Drizzle migrations (A only generates them) |

## Working together

- `main` is protected and auto-deploys to Render. Branch per PR (`feat/<area>-<thing>`), one approving review, green CI, squash-merge.
- Stay inside your own paths; ask for anything else in `HANDOFF.md`.
- Contract changes in `packages/shared` are additive, bump its version and get a line in its `CHANGELOG.md`.

## Demo logins (sandbox)

Added in Phase 12: sandbox donor account, staff passcodes (`harbor-demo-2026`, `paws-demo-2026`, `room12-demo-2026`).

## License

MIT

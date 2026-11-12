# NeedGrid

Shelters, food banks, classrooms and animal rescues post the **exact items** they need. Each item is matched to a
real product at a real price. Donors fund item "tiles" through PayPal, watch the bars fill live, and get a photo when
their item arrives. A staff AI assistant handles sponsor invoices, refunds and reconciliation, and **every money action
waits for a human to approve it**.

Built for the PayPal AI Hackathon. **PayPal sandbox only: no real money moves.**

## Try it

| What | Where |
|---|---|
| Web app | https://needgrid-web.onrender.com |
| Demo video (under 3 min) | https://youtu.be/tn0gaSTR54s |
| API health | https://needgrid-api.onrender.com/api/health |
| A charity's tile wall | https://needgrid-web.onrender.com/o/harbor-food-bank |
| Staff console | https://needgrid-web.onrender.com/staff/login (or click **Try the staff console**) |
| Public impact dashboard | https://needgrid-web.onrender.com/dashboard |

The API runs on Render; after a quiet spell the first request can take up to a minute while it wakes up.

### Demo logins (sandbox, public by design)

**Staff passcodes**, one per demo charity:

| Charity | Passcode |
|---|---|
| Harbor Food Bank (Portland, OR) | `harbor-demo-2026` |
| Second Chance Paws (Austin, TX) | `paws-demo-2026` |
| Room 12 Readers (Columbus, OH) | `room12-demo-2026` |

**Sandbox donor (PayPal buyer) account:** use it to pay in the PayPal popup and to pay sponsor invoices.

- Email: `sb-yhcqc53715581@personal.example.com`
- Password: `)uJ8gF<?`

This is a PayPal **sandbox** account with test money. It must be a **US** account: PayPal blocks Indian sandbox
accounts from paying USD invoices (`INR_FOREIGN_CURRENCY_BLOCKED`).

### A 5-minute tour

1. **Donate.** Open a tile on Harbor Food Bank, give $5 and pay with the sandbox buyer. The bar moves on every open
   screen at once, and the thank-you page links to your private impact page.
2. **Staff intake.** Log in as staff and open the intake page (`/staff/intake`), then photograph or type a list. AI
   extracts the items, Channel3 finds real products and prices, and you publish them as tiles.
3. **Buy a funded item.** Open a funded need → **Plan purchase**. AI re-checks the price. If it got cheaper, the
   surplus moves to the most urgent open item; if pricier, the tile asks donors for the gap.
4. **Delivery.** On an ordered need, upload an arrival photo and click **Check delivery**. AI checks it matches the
   product; donors see it on their impact page.
5. **Assistant.** Ask: *"Invoice Acme Hardware at sb-yhcqc53715581@personal.example.com for the two most urgent items."* An approval card shows
   every amount (computed by NeedGrid, never by the AI). Approve it, open the pay link in a private window and pay as
   the sandbox buyer. Within a minute the tiles turn **Funded**. Also try *"Reconcile the last 7 days."*

## How the money stays correct

- **The server decides every amount.** Browsers and the AI send ids, never prices or totals. A donation is clamped to
  what the tile still needs, and assistant proposals store server-computed amounts that are used verbatim.
- **Holds.** Starting checkout holds the amount for 15 minutes, so two donors can't fund the same last dollars. Sponsor
  invoices hold their tiles for 14 days.
- **One ledger.** Every dollar is an `allocations` row saying which item it paid for. A tile's funded amount is always
  the sum of its rows; moves (cheaper price, roll-over, refund) are paired −/+ rows. `check:money` verifies this.
- **Counted once.** The capture call and PayPal's webhook can both report a payment; unique database keys make the
  second one a no-op. Webhooks are signature-verified with PayPal before anything is stored.
- **Humans approve money.** The assistant can only *propose* invoices and refunds. Approving re-checks the amounts
  against the database first (changed → it fails safely and PayPal is never called), then calls PayPal with no
  database locks held.
- **Nothing is stranded.** Overpayments flow to the most urgent open item. A need past its deadline is closed by the
  roll-over job: donors who agreed have their money moved, everyone else gets a refund *proposal* for staff to approve.

## Architecture

```
apps/web         React + Vite (tile walls, checkout, staff console, assistant, dashboard)
apps/api         Fastify + Drizzle on Neon Postgres (pgvector)
  src/money        ledger, holds, capture, purchases, invoices, refunds   ← all money logic
  src/agent        propose → approve → execute for money actions
  src/paypal       PayPal REST: orders, invoicing, refunds, transaction search, webhook verify
  src/webhooks     PAYMENT.CAPTURE.COMPLETED, INVOICING.INVOICE.PAID
  src/jobs         hold releaser (1 min), roll-over (10 min)
  src/ai           Gemini: intake, matching, purchase plans, delivery check, staff assistant
  src/channel3     product search
packages/shared  zod schemas = the API contract, money helpers (integer cents only)
```

- **PayPal:** Orders v2 (donations), Invoicing v2 (sponsor invoices with pay link and QR code), Payments v2 (refunds),
  Transaction Search (reconciliation), Webhooks. Called over REST from the server only; the browser uses the PayPal
  JS SDK buttons.
- **AI:** Google Gemini (`gemini-2.5-flash-lite`) through the Vercel AI SDK; Channel3 for real products and prices.
- **Live updates:** server-sent events per charity.
- **Hosting:** Render (API web service + static site), Neon Postgres, Cloudinary for photos.

## Run locally

Requires **Node 22.18+** and **pnpm 11** (`corepack enable` picks the pinned version), a Neon (or local Postgres with
pgvector) database, a PayPal **sandbox** app, a Cloudinary account and, for the AI features, a Gemini API key.

```bash
pnpm install
cp .env.example apps/api/.env        # fill in the API block (Windows: copy .env.example apps\api\.env)
cp .env.example apps/web/.env        # keep only the VITE_* block
pnpm --filter @needgrid/api db:migrate
pnpm --filter @needgrid/api seed     # three demo charities with needs and donation history
pnpm dev                             # API on http://localhost:3000, web on http://localhost:5173
```

Webhooks need a public URL: register `https://<your tunnel>/api/webhooks/paypal` on your sandbox app (for example with
`cloudflared tunnel --url http://localhost:3000`) and subscribe it to `PAYMENT.CAPTURE.COMPLETED` and
`INVOICING.INVOICE.PAID`. Without it, donations still work (the page's capture call records them); paid invoices don't.

| Command (repo root) | What it does |
|---|---|
| `pnpm typecheck` / `pnpm lint` / `pnpm format:check` | Static checks |
| `pnpm test` | All tests. DB tests need `TEST_DATABASE_URL`; each run uses its own temporary database. PayPal and AI are faked |
| `pnpm --filter @needgrid/api check:money` | Verify the money ledger on the database in `DATABASE_URL` |
| `pnpm --filter @needgrid/api job:rollover` | Close needs past their deadline now (demo) |
| `pnpm --filter @needgrid/api build` | Production build of the API |

## Team and repo docs

Two people, each working with a coding agent, split across three roles: **A** payments and backend, **B** AI and data, **C** frontend and demo.
`NEEDGRID_DEV_PLAN.md` is the plan; `AGENT_*.md` are the per-person briefs; `NOTES.md` records decisions and lessons
(PayPal sandbox quirks included); `HANDOFF.md` holds requests between owners.

Branch per PR, green CI, merge commits into `main` (which auto-deploys to Render). Contract changes in
`packages/shared` are additive only.

## License

MIT

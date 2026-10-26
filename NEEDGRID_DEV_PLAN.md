# NeedGrid: Development Plan (3-person team)

**Pitch:** Shelters, food banks, classrooms and rescues post the exact items they need. Each item is matched to a real product at a real price. Donors fund item "tiles" through PayPal, and they get a photo when their item arrives.

| Key date | What |
|---|---|
| **Sun Oct 25** | Kickoff (today) |
| **Sun Nov 1** | Milestone 1: the core money loop works on the live URL |
| **Mon Nov 2** | Start the AG Studio 45-day trial (it then lasts until about Dec 17) |
| **Sat Nov 7** | Milestone 2: **feature freeze** |
| **Wed Nov 11** | **Submit** (one day early) |
| **Thu Nov 12** | Official deadline. Check the exact time on the [rules page](https://paypalaihackathon.devpost.com/rules). |
| **Dec 1–15** | Judging. The live demo must stay up the whole time. |

**Prizes we're aiming for:** main prize categories *Most Impactful* and *Best Use of PayPal + AI*. Sponsor prize **Best Use of AG Studio** ($5k first place). **Channel3** is a backup chance, since a project can win only one sponsor prize.

---

## 1. Scope

### P0: must ship (the demo depends on it)
1. **Intake:** staff photograph an empty shelf or a handwritten or printed needs list. The AI pulls out each item and quantity, and Channel3 suggests 3 real products for each one. Staff pick one and publish it as a tile.
2. **Tile wall:** a public page for each charity showing every needed item with a live progress bar.
3. **Donate:** pick an amount or "fund the rest", then pay with PayPal. The bar fills live on every open screen.
4. **Purchase plan:** when a tile is fully funded, the AI rechecks the price and offers, then proposes the purchase. Staff approve it with one click and record the retailer's order number.
5. **Proof of delivery:** staff upload a photo when the item arrives. The AI checks the photo matches the product, and every donor's impact page shows "your item arrived" with the photo.
6. **Staff assistant (PayPal + AI):** staff type requests in plain English ("invoice Acme for the whole winter-coats list", "check this week's money matches our records"). Every money action needs a human to approve it first.
7. **Public AG Studio dashboard:** donors and board members ask "what did November's donations buy?" and the AI builds the answer.
8. **Live deployment:** hosted on Render with realistic demo data and sandbox test logins in the README.

### P1: build if Milestone 1 is on time
- **Match me:** a donor types "I want to help kids stay warm, $25" and gets 3 matching tiles.
- **Refunds and roll-over:** donations to tiles that never reach full funding move to the next most urgent need. Refunds are handled through the staff assistant.
- **Printable QR flyers** for each tile or charity, for food drives and events.

### P2: only after the feature freeze, if time allows
- Each charity receives money in its own PayPal account (`payee` in Orders v2). Test this in sandbox and drop it if it causes trouble.
- Real emails through Resend. This needs a verified domain (about $10).
- Venmo button and translations.

### Deliberately not using
Elastic (no prize, and its trial would expire during judging; Postgres search covers Match me), KERNEL, Bryntum. A focused project beats one that uses every tool.

---

## 2. Roles

| | **A: Payments & Backend Lead** | **B: AI & Data Lead** | **C: Frontend & Demo Lead** |
|---|---|---|---|
| **Best fit** | Strongest backend developer, careful with edge cases | Comfortable with LLM APIs and data | Strongest at React and design, good storyteller |
| **Owns** | `apps/api` (except `src/ai`), `packages/shared`, database, PayPal, webhooks, deployment | `apps/api/src/ai`, Channel3, seed data, **AG Studio dashboard** (`apps/web/src/dashboard`) | `apps/web` (all pages except the dashboard), design, demo video, Devpost write-up |
| **Main deliverables** | Money rules, PayPal orders and invoices, webhooks, records of every donation, staff assistant's PayPal tools and approval step, Render setup | Intake AI, product matching, purchase-plan AI, photo check, staff assistant logic, Match me, dashboard and its AI | Tile wall, donate flow, impact page, staff console, assistant chat with approval cards, QR flyers, video |
| **Extra role** | **Tech lead:** owns the API contract, merges to `main`, deploys | Prompt testing and AI accuracy checks | **Scope keeper:** runs standups and the task board, says no to scope creep |
| **Reviews code from** | B | A (backend), C (dashboard) | B |

The person who reviews your code is also your backup. If someone is out for a day, their reviewer can continue their work.

---

## 3. Tech stack

**Language: TypeScript everywhere (Node 22 LTS).** It's one language for all three people. Shared types between the API and the web app catch contract mismatches at compile time. All the sponsor SDKs are first-class in TypeScript.

| Layer | Choice | Cost |
|---|---|---|
| Monorepo | pnpm workspaces, ESLint + Prettier, GitHub Actions CI (type check, lint, tests) | Free |
| Frontend | React + Vite + TypeScript, Tailwind + shadcn/ui, React Router, TanStack Query | Free |
| PayPal in browser | `@paypal/react-paypal-js` (PayPal buttons) | Free |
| Dashboard | **AG Studio** (React) + Studio Agent Framework, with our own Gemini model connected | 45-day trial |
| Backend | Fastify + zod. Use Express instead if the team knows it better. | Free |
| Database | **Neon Postgres** with Drizzle ORM. pgvector powers Match me. Each developer gets their own database branch. | Free |
| PayPal on server | `@paypal/agent-toolkit` (used by the staff assistant) + direct REST calls for orders, capture and webhook checks | Free (sandbox) |
| AI | Vercel AI SDK (`ai`, `@ai-sdk/google`) + Gemini Flash (vision and structured output) + Gemini embeddings | Free tier |
| Products | Channel3 TypeScript SDK: text, image and URL search, plus product lookup | Free (promo code `PAYPAL-HACKATHON-2026` = 20k credits) |
| Images | Cloudinary (uploads directly from the browser, thumbnails) | Free |
| Email (optional) | Resend (100 a day free). Without a verified domain it can only send to your own address. | Free / ~$10 domain |
| Hosting | Render: static site (web) + web service (API) via `render.yaml` | Free, then ~$7/mo for the API from Nov 11 |
| Coding helpers | APIMatic PayPal Context Plugin (`npx context-plugins install paypal`), Channel3 skills, AG Studio AI Skills | Free |

**Starting point:** look at PayPal's [AG Studio boilerplate repo](https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate) for how it wires PayPal data into AG Studio.

---

## 4. Architecture

```
                        ┌──────────────── apps/web (Render static site) ───────────────┐
 Donor (phone/laptop) ─►│ Tile wall · Donate (PayPal buttons) · Impact page · Match me │
 Staff ────────────────►│ Intake · Need detail · Assistant chat · QR flyers            │
 Board / public ───────►│ AG Studio dashboard + AI chat (read-only data)               │
                        └───────────────┬──────────────────────────────────────────────┘
                                        │ REST + live updates (SSE)
                        ┌───────────────▼────────── apps/api (Render web service) ─────┐
                        │ routes/  money/  paypal/  webhooks/  ai/  channel3/  jobs/   │
                        └──┬──────────┬───────────┬───────────┬───────────┬────────────┘
                           │          │           │           │           │
                      Neon Postgres  PayPal     Gemini      Channel3   Cloudinary
                      (+pgvector)    sandbox    (AI SDK)    API        (photos)
```

### Repo layout
```
needgrid/
├─ apps/
│  ├─ web/                 # C (B owns src/dashboard)
│  │  └─ src/{pages,components,features/donate,features/staff,dashboard,lib/api}
│  └─ api/                 # A (B owns src/ai, src/channel3)
│     └─ src/{routes,money,paypal,webhooks,db,ai,channel3,jobs}
├─ packages/shared/        # A: zod schemas = the API contract, money helpers
├─ scripts/seed/           # B: demo data generator
├─ render.yaml
├─ .github/workflows/ci.yml
├─ .env.example
└─ README.md, LICENSE (MIT)
```

---

## 5. Data model (Postgres)

All amounts are stored as **whole cents** (`integer`). Never use floating-point numbers for money.

| Table | Key columns |
|---|---|
| `organizations` | id, slug, name, city, cause_tags[], payee_email (P2), staff_key_hash |
| `needs` | id, org_id, title, description, category, urgency (1–3), quantity, unit, **status** (`draft → open → funded → ordered → delivered`, plus `topping_up`, `closed`), target_cents, funded_cents, product (jsonb: channel3_id, title, image, retailer, url, unit_price_cents, fetched_at), alternatives (jsonb), deadline_at, embedding (vector) |
| `reservations` | id, need_id, paypal_order_id, amount_cents, expires_at, status (`active / converted / released`) |
| `donations` | id, paypal_order_id **unique**, capture_id **unique**, amount_cents, donor_name, donor_email, roll_over_consent, source (`order / invoice`), status, impact_token |
| `allocations` | id, donation_id, need_id, amount_cents, reason (`direct / overflow / price_drop / rollover / sponsor`) |
| `purchases` | id, need_id, offer (jsonb), price_cents, status (`proposed / approved / ordered`), order_ref, approved_at |
| `deliveries` | id, need_id, photo_url, match_score, ai_notes, needs_review, message |
| `sponsor_invoices` | id, org_id, paypal_invoice_id, recipient_email, need_ids[], amount_cents, status, qr_url |
| `agent_actions` | id, org_id, tool, args (jsonb), status (`proposed / approved / rejected / executed / failed`), result, timestamps. This is the audit log. |
| `webhook_events` | id, paypal_event_id **unique**, type, payload, processed_at |

**The `allocations` table is the single record of which item each dollar paid for.** `needs.funded_cents` always equals the sum of that need's allocations, and is updated in the same database transaction.

---

## 6. API contract (defined in `packages/shared` on Day 1)

| Method & path | Who | Purpose |
|---|---|---|
| `GET /api/orgs/:slug` | public | Charity details + its needs |
| `GET /api/orgs/:slug/stream` | public | Live `need.updated` events (SSE) |
| `GET /api/needs/:id` | public | Tile detail + its timeline |
| `POST /api/donations/orders` | public | `{needId, amountCents, rollOverConsent}` → `{orderId}`. The server limits the amount and holds it. |
| `POST /api/donations/orders/:id/capture` | public | Captures payment → `{donationId, impactToken, allocations}` |
| `GET /api/impact/:token` | public | One donor's items, statuses and arrival photos |
| `POST /api/match` | public, rate-limited | `{text, budgetCents}` → 3 matching needs + a one-line reason each |
| `GET /api/dashboard/datasets/:name` | public | Flat, **no-personal-data** tables for AG Studio |
| `POST /api/ai/dashboard-complete` | public, rate-limited | Server-side relay to Gemini for the AG Studio agent, so the API key never reaches the browser |
| `POST /api/staff/intake` | staff | Photo or text → draft needs + 3 product options each |
| `POST /api/staff/needs` · `PATCH /api/staff/needs/:id` | staff | Publish or edit a need |
| `POST /api/staff/needs/:id/purchase-plan` | staff | AI purchase proposal |
| `POST /api/staff/purchases/:id/approve` · `/ordered` | staff | Approve purchase, save the retailer's order number |
| `POST /api/staff/needs/:id/delivery` | staff | Arrival photo → AI match check |
| `POST /api/staff/agent/chat` | staff | Staff assistant (streamed reply) |
| `POST /api/staff/agent/actions/:id/approve` · `/reject` | staff | Approve or reject a proposed money action |
| `POST /api/webhooks/paypal` | PayPal | Signature verified, safe to receive twice |

Staff login for the demo: a passcode per charity, sent in a request header, plus a "Try the staff console" button that fills in the demo passcode for judges. Real user accounts are future work.

C builds against **mock data (MSW) generated from the shared schemas**, so frontend work never waits on the backend.

---

## 7. Money rules (A owns these; code review must check them)

1. **The server sets every amount.** The browser and the AI only send IDs and requested amounts. The server limits them.
2. **Target price** = unit price × quantity, plus an 8% buffer for tax and shipping, rounded up to the dollar. For example, 2 × $38.49 diapers = $76.98, +8% = $83.14, so the target is **$84**. Staff can edit it.
3. **When a donor starts checkout**, inside one transaction that locks the need's row:
   - remaining = target − funded − amounts currently on hold
   - amount = min(requested, remaining), held for 15 minutes
   - If nothing is left, return "fully funded" plus the next most urgent need.
4. **When payment is captured**, in one transaction: insert the donation, turn the hold into an allocation, update `funded_cents`, and set the status to `funded` when the target is reached. Then send a live update.
5. **No double counting:** unique `capture_id` and `paypal_event_id`. Every create call sends a `PayPal-Request-Id` header so retries don't create duplicate orders.
6. **Overflow:** if two donors race and the tile ends up over target, the extra goes to the charity's most urgent open need (`reason=overflow`). This is disclosed at checkout with a checkbox that starts ticked.
7. **Price changes at purchase time:** if it's cheaper, the surplus goes to the next need (`price_drop`). If it's pricier, the tile goes to `topping_up` for the gap, or staff pick an alternative product.
8. **Unfunded by the deadline (P1):** the money rolls over if the donor agreed, otherwise it's refunded through an approved assistant action.
9. Order line items use `category: "DONATION"`.
10. **Webhooks are a backup for the capture response, and the only signal for sponsor invoices** (`INVOICING.INVOICE.PAID`). Always verify the signature with PayPal's `verify-webhook-signature` endpoint.

Write Vitest unit tests for rules 3–7. They're the only part where a bug means wrong money.

---

## 8. AI features & guardrails (B owns these)

| # | Feature | Model work | Deterministic code does |
|---|---|---|---|
| 1 | Intake | Gemini vision → `ExtractedNeed[]` (zod schema via `generateObject`) | Channel3 search, price-per-unit math, ranking ties |
| 2 | Product pick | LLM ranks 3 Channel3 results for fit (size, count, brand) | Shows options, staff decide |
| 3 | Purchase plan | Explains the best offer, flags price changes and stock | Refreshes the price via Channel3 product lookup (free), does the money math |
| 4 | Proof of delivery | Compares the arrival photo with the product image → score + notes | Score below the threshold → flagged for a human |
| 5 | Impact note | Turns the staff's short note into a warm 2-line update | — |
| 6 | Match me (P1) | Embedding of donor text + one-line "why this need" | Vector search filtered to needs where remaining ≤ budget |
| 7 | Staff assistant | AI SDK `streamText` with an allowlist of tools | Proposes → human approves → runs with the exact stored arguments |
| 8 | Dashboard AI | AG Studio Agent Framework using our Gemini relay | Read-only, no-personal-data data only |

**Staff assistant tools:** P0 is `create_invoice`, `send_invoice`, `generate_invoice_qr_code`, `list_transactions` (for the money-vs-records check). P1 is `create_refund`.

A wraps the Agent Toolkit tools so that calling one creates an `agent_actions` row and does **not** run PayPal. The PayPal call runs only from the approve endpoint.

**Guardrails (put these in the write-up; judges have seen many unsafe agent demos):**
- The AI never sets amounts. Tools take IDs, and the server calculates amounts.
- Every money action needs a human to approve it, and the approval card shows the exact arguments.
- The public dashboard AI has no PayPal tools and no donor emails in its data.
- Untrusted text (product titles, uploaded lists, donor messages) is clearly separated in prompts and never treated as instructions. All tool arguments are validated with zod.
- Public AI endpoints are rate-limited per IP address and capped on length.
- **Use made-up demo data only.** Gemini's free tier may use what you send it to improve Google's products.

---

## 9. Day-by-day schedule

Run a 15-minute standup every day at a fixed time: yesterday, today, blockers. C runs it.

| Date | A: Payments & Backend | B: AI & Data | C: Frontend & Demo |
|---|---|---|---|
| **Sun Oct 25** | **Kickoff (all, 90 min):** freeze the P0 list, confirm roles, everyone creates accounts (PayPal Developer, Channel3 + promo code, Gemini key, Neon, Cloudinary, Render, GitHub). **Don't start the AG Studio trial yet.** A: create repo, monorepo setup, CI | Collect 20 test inputs: shelf photos, handwritten lists, printed and PDF lists | Wireframes for 6 screens (tile wall, donate, impact, intake, need detail, dashboard). Pick a visual style. |
| **Mon Oct 26** | Fastify + Drizzle + Neon, schema v1, first Render deploy of web + API. **Contract meeting (all, 1h)** → `packages/shared` v1 | Test Gemini extraction on the 20 inputs. Test Channel3 search on 30 needs and note pack-size problems. | Vite + Tailwind + shadcn + routing + TanStack Query. Mock data from the shared schemas. Landing page and layout. |
| **Tue Oct 27** | Money module: cents helpers, remaining-amount math, holds inside a locked transaction. Create-order endpoint. | `/staff/intake`: extract items → Channel3 top 3 → price per unit → draft needs | Tile wall + tile card (progress bar, urgency, product image), charity page |
| **Wed Oct 28** | Capture endpoint → donation + allocation in one transaction, funded status, live updates (SSE), impact token | Publish a need + save its embedding. Fallback: look up a product by URL. Harden prompts. | Donate panel with PayPal buttons (preset amounts, "fund the rest", roll-over checkbox), thank-you page |
| **Thu Oct 29** | PayPal webhook endpoint + signature check + duplicate protection (use the APIMatic plugin). Vitest for the money module. | Seed generator: 3 charities (food bank, animal rescue, classroom) × 40–60 needs with real Channel3 products, plus 8 weeks of fake donation history | Staff intake screen: upload, review extracted rows, pick 1 of 3 products, edit quantity and urgency, publish |
| **Fri Oct 30** | Overflow and race handling, expiring holds, logging, rate limits on public routes | Purchase-plan AI v1 (price refresh, compare offers, flag changes) | Live progress bars, mobile layout (donors arrive via QR on phones) |
| **Sat Oct 31** | **Integration day:** connect the real API to C's screens, fix contract mismatches, set environment variables on Render | AG Studio test locally (no licence needed there): seed data in, Agent Framework connected to Gemini via the relay | Need-detail page shell with its timeline (open → funded → ordered → delivered) |
| **Sun Nov 1** | **Milestone 1 review (all, 1h) on the live URL:** photo → tiles → sandbox donation → bar fills live → tile shows funded. Fix anything blocking. | ← | ← |
| **Mon Nov 2** | Purchase endpoints (approve, mark ordered). Rules for price drops and price rises. | **Request the AG Studio trial licence today.** Dashboard data endpoints (no personal data) + default public dashboard layout | Purchase-plan card (compare offers, Approve button), mark-ordered form |
| **Tue Nov 3** | Delivery photo upload (Cloudinary), impact-page API, optional Resend email | Proof-of-delivery photo check + impact-note writer | Delivery upload screen with the AI result, donor impact page (my items, timeline, arrival photos) |
| **Wed Nov 4** | Wrap Agent Toolkit tools behind propose → approve → run, plus the `agent_actions` audit log | Staff assistant logic (allowed tools, system prompt, streamed replies). Give the AG Studio agent read-only tools. | Assistant chat panel with approval cards (Approve / Reject, shows exact arguments) |
| **Thu Nov 5** | Sponsor invoice end to end: invoice for a whole wishlist → `INVOICING.INVOICE.PAID` webhook → allocations across needs, QR image saved | Money-vs-records check (`list_transactions` vs our allocations) → mismatch report. Match me (P1). | Public dashboard page embedding AG Studio (read-only, AI chat on). Match me box on the landing page. |
| **Fri Nov 6** | Roll-over job + refunds (P1). Security pass: staff passcode, allowed origins (CORS), input size limits. | Dashboard polish: totals (raised, items funded, delivered, median days from funded to delivered), charts by category and month, delivered items with photos. Test prompts on the 20 inputs. | QR flyer page, empty, error and loading states |
| **Sat Nov 7** | **Milestone 2: FEATURE FREEZE at end of day.** Anything unfinished gets cut or moved to P2. | ← | ← |
| **Sun Nov 8** | **Bug bash (all, 3h):** A tests C's screens, B tests A's flows, C tests B's AI, using the checklist in §11. A puts the AG Studio licence in production settings. | Reseed the production data | Sort the bug list by priority |
| **Mon Nov 9** | Fixes. README with setup, architecture and the sandbox donor + staff logins. Uptime monitor. | Fixes, prompt tuning, write the "How we use AI" section | Visual polish, video script and storyboard, rehearsal recording |
| **Tue Nov 10** | Run the screens during recording, write the PayPal section of the write-up | Run the screens during recording, write the AI + AG Studio section | **Record and edit the final video (under 3 min)**, lead the Devpost write-up |
| **Wed Nov 11** | Move the API to the Render Starter plan, final deploy, tag `v1.0.0` | Final check of the demo data, save the default dashboard | Upload the video and screenshots → **SUBMIT.** All three check every link in a private window. |
| **Thu Nov 12** | **Buffer only, no new features.** Deadline. | ← | ← |

**Dec 1–15 (judging):** don't change the judged deployment. Take turns, one person per week, opening the live URL every day.

---

## 10. Ways of working

- **Task board:** a GitHub Projects board with columns Backlog → This week → In progress → Review → Done. Each issue gets an owner and a P0, P1 or P2 label.
- **Git:** `main` is protected and always deployable (Render deploys automatically from it). Name branches `feat/<area>-<thing>` or `fix/...`. Keep pull requests small, get 1 approving review, wait for CI to pass, then squash-merge. Review each other's pull requests within 12 hours.
- **Environments:**
  - **Local:** each developer has their own Neon branch, their own PayPal sandbox app and their own Gemini key. For webhooks on your machine, use a `cloudflared` quick tunnel.
  - **Production:** the shared Render services and the main Neon branch.
- **Secrets:** never commit them. `.env.example` lists `DATABASE_URL, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, PAYPAL_ENV, VITE_PAYPAL_CLIENT_ID, CHANNEL3_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, CLOUDINARY_URL, RESEND_API_KEY, STAFF_DEMO_KEY, WEB_ORIGIN, VITE_AG_STUDIO_LICENSE`. The last name is our own; set it to whatever the AG Studio docs expect.
- **Sandbox accounts:** one business account (the charity) and three personal accounts (demo donors). Put one personal account's login in the README for judges.
- **Coding assistants:** install the APIMatic PayPal plugin, the Channel3 skills and the AG Studio AI Skills, so generated code uses the real APIs.

---

## 11. Bug-bash checklist

- [ ] Donate exactly the remaining amount → tile shows funded
- [ ] Donate more than remaining → amount is limited
- [ ] Two browsers pay the last $10 at the same time → no tile goes over target, extra goes to overflow
- [ ] Close the PayPal popup → the hold is released after 15 minutes
- [ ] Refresh the page during capture → still exactly one donation
- [ ] Same webhook delivered twice → counted once
- [ ] Sponsor invoice paid → every tile on that list shows funded
- [ ] Blurry or partial list photo → sensible draft, nothing published automatically
- [ ] Ask the assistant to "refund everyone" → only proposals appear, nothing runs
- [ ] Ask the dashboard AI to "show donor emails" → no personal data is reachable
- [ ] Every page works on a phone, in a private window, after the server has been idle

---

## 12. Demo video script (about 2:50)

| Time | Scene |
|---|---|
| 0:00–0:15 | **Hook:** "Shelters get 400 cans of beans and zero diapers. Donors never see what their $20 did." |
| 0:15–0:50 | Staff photograph an empty diaper shelf and a handwritten list → 6 needs extracted → real products and prices from Channel3 → publish |
| 0:50–1:30 | A donor on a phone scans the QR → "Size 4 diapers: $14 left" → PayPal sandbox checkout → the tile fills live on the big screen → **Funded** |
| 1:30–1:55 | Purchase plan: price refreshed, cheaper offer found, $3.20 surplus moves to the next urgent need → staff approve |
| 1:55–2:15 | Arrival photo → AI confirms the match → the donor's impact page shows "Your diapers arrived" with the photo |
| 2:15–2:35 | Staff assistant: "Invoice Acme Hardware for the winter-coats list" → approval card → PayPal invoice + QR. "Check this week's money against our records" → everything matches. |
| 2:35–2:50 | Public AG Studio dashboard: "What did November donations buy, by category?" → a chart builds |
| 2:50–3:00 | Stack, live URL, call to action |

---

## 13. Risks & fallbacks

| Risk | Fallback |
|---|---|
| AG Studio is new and takes time to learn | B tests it locally from Oct 31. Start from the PayPal boilerplate. Ask in AG Grid's Discord. Have a simpler dashboard ready by Nov 4. |
| Channel3 returns the wrong pack size or product | Staff choose from 3 options. Fall back to looking up a product by URL. Compare price per unit, not total price. |
| Gemini free-tier rate limits | Cache results per photo, retry with back-off, separate keys for development. Budget about $5 to turn on billing if needed. |
| PayPal sandbox is slow or flaky | `PayPal-Request-Id` on create calls, retries, webhooks as backup |
| The Agent Toolkit lacks a feature (webhook checks, `payee`) | Call the REST API directly, written with the help of the APIMatic plugin |
| Scope creep | C enforces the P0 list. P2 work happens only after Nov 7. |
| A teammate is unavailable | Their reviewer takes over (see §2) |
| A trial expires during judging | AG Studio starts Nov 2 (about Dec 17 end). Neon, Cloudinary and Channel3 have no time limit. |
| Real-world donation compliance | The demo is sandbox only. Write-up note: production needs verified nonprofit PayPal accounts, and impact receipts are not tax receipts. |

---

## 14. Costs

| Item | Cost |
|---|---|
| Everything during development | $0 |
| Render Starter plan for the API, Nov 11 → Dec 21 | ~$9–10 |
| Optional: domain for real emails | ~$10 |
| Optional: Gemini paid usage if free limits get in the way | ~$0–5 |
| **Total** | **~$10 (max ~$25)** |

**Revenue idea for the write-up:** purchases made through Channel3 buy links can earn retailer commission (Channel3 keeps 50% by default). That commission could pay for the platform, or go back to the charity.

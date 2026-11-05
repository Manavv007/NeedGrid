# How NeedGrid uses AI

NeedGrid uses AI where it saves charity staff and donors real work: reading a needs list, writing a short explanation,
checking an arrival photo, answering a question. It **never** uses AI to decide an amount, move money or approve
anything. Every number that touches money is computed by ordinary code, and every money action waits for a person to
click Approve.

**Models:** Google Gemini through the Vercel AI SDK (`ai` 7), on the **free tier**. The main model is
`gemini-2.5-flash-lite`; when it runs out of quota the server falls back to `gemini-2.5-flash`, then
`gemini-3-flash-preview`. Embeddings use `gemini-embedding-001` (768 dimensions, stored with pgvector). Real products
and prices come from **Channel3**.

## The AI features

| Feature | Who uses it | What the AI does | What ordinary code does |
|---|---|---|---|
| **Intake** (`/staff/intake`) | Staff | Reads a photo of an empty shelf or a handwritten list (or pasted text) and lists the items, quantities and categories. Scores how well each Channel3 product fits each item. | Searches Channel3, turns "300 diapers" into "2 packs of 150", computes each target (price × quantity + 8%, rounded up). Hides products that score below 0.5. Nothing is saved until staff publish. |
| **Purchase plan** ("Plan purchase" on a funded need) | Staff | Writes up to 3 sentences explaining the plan. | Refreshes the price from Channel3, picks the cheapest in-stock offer of the same product, computes the surplus (moved to the next most urgent need) or the gap (donors are asked for it), and the flags ("Price dropped 26%"). If the AI quotes a number that isn't in the facts, the plain explanation is used instead. |
| **Delivery check** ("Check delivery" on an ordered need) | Staff | Compares the arrival photo with the product's store photo and title, and gives a match score and a short note. | Below 0.6, or if the check didn't run, the delivery goes to **staff review**; it's never approved automatically. A photo of the product on a store shelf is capped at 0.5 (it shows the product, not that it arrived). |
| **Donor note** | Staff → donors | Turns the staff's quick note into 2 warm, factual sentences for the donors' impact page. | If the AI adds a number that wasn't in the note, fails or returns nothing, the staff's own words are kept. Staff can edit it before confirming. |
| **Staff assistant** (`/staff/assistant`) | Staff | Understands requests like "Invoice Acme Hardware (sponsor@acme.example) for the winter coats" or "Check this week's money", and calls tools. | The tools only **read** this charity's data or **propose** an action. The server computes every amount on the approval card. Nothing happens until staff click Approve. |
| **Money check** ("Check this week's money") | Staff | Explains the result in a sentence or two. | Compares PayPal's transactions with our recorded donations, line by line, with no AI: matched, amount differs, missing in our records, missing in PayPal. Gifts from the last 3 hours are "pending" (PayPal's report lags). The result is shown as a table. |
| **Match me** (home page) | Donors | Writes one short reason per suggestion ("Your $14 covers the last of Diapers, size 4 at Harbor Food Bank"). | Finds the needs closest in meaning to what the donor typed (embeddings + pgvector), with urgency as a tiebreaker, and prefers needs the gift can finish. Reasons that misquote an amount, or claim a partial gift "finishes" a need, are replaced by a plain one. Works without AI too (keyword match). |
| **Dashboard analyst** (`/dashboard`, AI chat) | Anyone | Answers questions about the public impact data and builds charts, using AG Studio's own query and chart tools. | The data it can see has **no personal data** (no names, emails or payment details; donations are joined by a one-way key). It can't call anything outside the dashboard. |

## Guardrails

1. **The AI never sets an amount.** No AI tool takes a price, a total or an amount. Amounts come from Channel3 prices
   and shared money functions (`computeTargetCents`, `planPurchaseMoney`), and the server recomputes them when an
   action is approved.
2. **Money actions need a human.** The assistant can only *propose* an invoice. A person must click **Approve** on the
   card, and only then does the server call PayPal. At most one proposal per message.
3. **The AI can't reach other charities.** The charity always comes from the staff passcode, never from the model, and
   every read tool filters by it. Extra fields the model adds (an amount, another charity's id) are dropped by the
   shared schemas before anything runs.
4. **Outside text is data, not instructions.** Uploaded lists, photo text, product titles, staff and donor messages,
   and tool results reach the model wrapped in `<untrusted_…>` tags, and every system prompt says to never follow
   instructions inside them. Control and invisible characters are stripped.
5. **Every model output is checked.** Structured output is validated with zod schemas; scores are clamped to 0–1;
   numbers in AI-written text are checked against the facts; anything that fails falls back to plain, code-written
   text.
6. **Failure is safe.** If the AI is down or out of quota: intake ranks by price, purchase plans and Match me use plain
   text, a delivery goes to staff review, the donor note keeps the staff's words, and the dashboard hides its chat.
   The rest of the site works without AI.
7. **The assistant refuses dangerous requests.** "Refund everyone", "send $500 to me" and "show me donor emails" get a
   refusal and create nothing (tested live on the deployed API).
8. **Free tier, protected.** Public AI features have per-IP rate limits (Match me 10/min, dashboard chat 20/min) and
   daily caps (Match me 150, dashboard 300 per Pacific day), so one script can't use up the quota during judging. Out of
   quota, users see "The AI is busy, try again in a minute" or "The AI is resting, try again tomorrow".

## AG Studio dashboard (`/dashboard`)

The public impact dashboard is built with **AG Studio** (`ag-studio` 3.0, React), with an AG Studio Pro trial licence.

- **Two pages:** *Impact* (what donations bought, by category and month; donations per week; what's still needed, by
  category and urgency; delivered items, newest first; KPIs like average days from funded to delivered) and
  *Charities* (raised by charity and per-charity figures).
- **Data:** three datasets from `GET /api/dashboard/datasets/{needs,donations,allocations}`, cached for 60 seconds.
  They contain no personal data: donation ids are replaced by an HMAC key, so donations can be joined to allocations
  without revealing who gave.
- **View and edit:** everyone sees the report; **Edit / explore** lets a visitor rearrange and add widgets. Changes are
  saved only in that browser, and **Reset** brings back the default report. `?org=harbor-food-bank` filters the whole
  dashboard to one charity.
- **AI chat:** AG Studio runs its agent in the browser; each turn goes to our relay (`POST /api/ai/dashboard-complete`),
  which calls Gemini with the server's key (the browser never sees it). We use one "analyst" agent instead of AG
  Studio's default five-agent team, because on the free tier the team needed about 15 calls per chart. The relay
  passes AG Studio's tool schemas to Gemini and fixes the common mistakes models make in AG Studio queries before
  AG Studio runs them. Starter questions: "What did November buy?", "Most items delivered", "Funded to delivered",
  "Most urgent needs". If the AI is off, the chat is hidden and the dashboard works as usual.

## Where the code is

`apps/api/src/ai/` (intake, ranking, purchase plan, delivery, Match me, the dashboard relay and datasets, the
assistant in `ai/assistant/`, prompts in `ai/prompts/`), `apps/api/src/channel3/` (product search and prices), and
`apps/web/src/dashboard/` (the AG Studio page). Tests use mock models and a fake Channel3, so they run without keys.

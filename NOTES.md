# NOTES: lessons learned while building NeedGrid

Read this before you start. Every entry is something that actually happened on this project: what went wrong,
how it was fixed, and what to do instead. Add to it when you learn something new (append under the right
heading, keep entries short, say how you got out of it).

Format of an entry: **problem** → what we saw → fix / what to do.

---

## 1. Environment (Windows + PowerShell)

- **`&&` doesn't chain in Windows PowerShell 5.1.** Use `;` (runs regardless) or check `$LASTEXITCODE` between commands.
- **stderr shows up as scary red `NativeCommandError` blocks.** pnpm, node and git write normal progress to stderr, and
  PowerShell wraps every line as an error record. It does NOT mean the command failed. Check `$LASTEXITCODE` instead.
  When filtering output, drop lines matching `NativeCommandError|CategoryInfo|FullyQualifiedErrorId|~~~`.
- **Vitest output is full of ANSI colour codes**, which breaks `Select-String`. Redirect to a file and strip them:
  `pnpm test > $env:TEMP\out.log 2>&1; Get-Content $env:TEMP\out.log | % { $_ -replace '\x1b\[[0-9;]*m','' }`.
- **`git` line endings.** `core.autocrlf=true` on this machine. `.gitattributes` forces `eol=lf` so diffs are identical on
  every OS. Don't remove it. Write generated files as UTF-8 **without BOM** with LF (`New-Object Text.UTF8Encoding($false)`).
- **Use `$env:TEMP`, never `%TEMP%`** in PowerShell (it becomes a literal folder name).

## 2. Agent / tooling mistakes to avoid

- **Don't start a long-running dev server and wait on it from a foreground command.** It hung for minutes and had to be
  cancelled by the user; a leftover server can also keep the port busy.
  → To check the app against a real database, run it **in-process**: a tiny script that calls `buildApp()` then
  `app.inject(...)` for each URL, then `app.close()`, `closeDb()` and `process.exit(0)`. Add a `setTimeout(() => process.exit(2), 60_000)`
  watchdog so it can never hang. Delete the script afterwards.
  → If you really need a running server, start it in the background and always kill the process tree
  (`taskkill /PID <pid> /T /F`) in the same command.
- **PowerShell `Start-Job` had no network access to PayPal** ("fetch failed / connect timeout") while the same script run
  directly worked. Run network checks directly, with your own timeout, not in `Start-Job`.
- **Don't write a file and a file that depends on it in the same parallel batch.** One write of `server.ts` silently did
  not take effect because it was in the same batch as the file it imported; typecheck then passed on the OLD file.
  → After writing important files, re-read or `Select-String` them to confirm the content landed. Write dependencies first.
- **Never print secrets.** To check `.env`, print key names and lengths only (`id length: 80`), or booleans such as
  `pooler: True`. Same for connection strings: show `host/database` only (`db/url.ts → describePgUrl`).
- **PayPal docs pages render with JavaScript**, so `web_fetch` returns almost nothing. Instead, verify request/response
  shapes by making one real sandbox call from a throwaway script and printing only the non-secret fields.

## 3. pnpm 11, TypeScript, zod

- **pnpm 11 blocks dependency install scripts.** First install failed with `ERR_PNPM_IGNORED_BUILDS` (esbuild) and pnpm wrote
  `allowBuilds: esbuild: set this to true or false` into `pnpm-workspace.yaml`. → Set `allowBuilds: { esbuild: true }`.
- **pnpm 11 has a minimum-release-age gate** and adds very fresh versions to `minimumReleaseAgeExclude` in
  `pnpm-workspace.yaml`. That's expected; keep the list (it's pinned exact versions).
- **Render/CI build with `NODE_ENV=production`** but we need devDependencies (tsup, drizzle-kit) at build time. Verified that
  `pnpm install --frozen-lockfile --prod=false` keeps them.
- **TypeScript 7 is out but `typescript-eslint` only supports `<6.1`.** We pinned **TS 6.0.3**. Don't upgrade TS until
  typescript-eslint supports it.
- **TS 6 defaults `types` to `[]`**: set `"types": ["node"]` explicitly in `apps/api/tsconfig.json` (already done).
- **zod v4 `export *` name clash.** `schemas.ts` exports a zod schema `NeedStatus` and `enums.ts` exported a type of the
  same name → `export *` from both fails. Fix used: type aliases come from `schemas.ts` (`type X = z.infer<typeof X>`),
  `enums.ts` exports only the const arrays.
- **Exported schema without a matching type** (e.g. `PurchaseOffer` used as a type) → "refers to a value but is used as a
  type". Contract v1.0.1 added `z.infer` type exports for every schema. Add the type line when you add a schema.
- **`z.coerce.number()` can't be piped after a string transform in zod v4** (type error). Write a custom `.transform` with
  `ctx.addIssue` instead (see `optionalPositiveInt` in `env.ts`).
- **`@paypal/agent-toolkit` 1.11 peers on `ai@^4` and `zod@^3`**; we use `ai@7` and `zod@4`. It is NOT installed. Phase 8
  must call its tools carefully or fall back to plain REST behind the same function signatures. Never give its tools to a model.

## 4. Neon / Postgres / Drizzle

- **Neon's default branch is called `production`, not `main`.** Same thing. Each developer works on their own branch
  (`dev-a`, `dev-b`, `dev-c`, parent `production`) with auto-delete set to **never**; `TEST_DATABASE_URL` is a separate `test` branch.
- **Use the POOLED string (`-pooler` in the host) for the app**, but **migrations use the direct host**:
  `drizzle.config.ts` strips `-pooler` (`db/url.ts → directNeonUrl`).
- **pg prints a "SECURITY WARNING" for `sslmode=require`** on every connection. `normalizePgUrl` rewrites it to
  `verify-full` (same behaviour, no warning). Always build pools through it.
- **Use `pg` + `drizzle-orm/node-postgres`, not Neon's HTTP driver**: money code needs interactive transactions and
  `SELECT … FOR UPDATE`.
- **Extensions need a hand-written migration.** `drizzle-kit generate --custom --name=extensions` → put
  `CREATE EXTENSION IF NOT EXISTS vector; --> statement-breakpoint CREATE EXTENSION IF NOT EXISTS pgcrypto;` in it.
  It must be migration `0000` so tables using `vector(768)` come after.
- **`schema.ts` must not import `env.ts`**: drizzle-kit loads it without the app's environment.
- **Neon cold start.** After idle, the first query took >3 s, so `/api/health` returned `db:false` once, then `db:true`.
  Not a bug. Retry once before debugging.
- **Row locks + READ COMMITTED: read holds in a SEPARATE statement after the lock.** Each statement gets a fresh snapshot,
  so a follow-up query sees holds committed by the donor you waited for. Folding the hold sum into the locking SELECT
  would read a pre-lock snapshot and could double-book a tile. (Comment in `money/donations.ts`.)
- **`now()` is constant for the whole transaction.** One capture created several allocations with the same timestamp, so
  their order came back random. → `allocations.created_at` uses `clock_timestamp()`.
- **App clock vs database clock.** `funded_at` set from `new Date()` (laptop clock) ended up *before* the allocation
  timestamp (database clock), so the timeline showed "funded" before "donation". → Set money-related timestamps with the
  database clock (`sql\`coalesce(funded_at, clock_timestamp())\``), and compute hold expiry in SQL
  (`now() + interval`), never in JS.
- **Connection pool exhausted under a burst.** 20 parallel checkouts on one tile queue on the row lock while each holds a
  connection; 3 of 20 got `500 timeout exceeded when trying to connect`. → `connectionTimeoutMillis: 30_000` in
  `db/client.ts` (wait instead of failing).
- **Deadlocks are possible** when overflow locks several needs in different orders. `withTxRetry` re-runs the whole
  transaction on `40P01` / `40001`. Anything inside must be safe to repeat (no PayPal calls inside transactions).
- **Never hold a row lock while calling PayPal.** Create the hold, COMMIT, then call PayPal; on failure release the hold.

## 5. Money rules in code (things that are easy to break)

- **Only `money/ledger.ts → allocate` changes `needs.funded_cents`**, and it inserts the allocation in the same
  transaction. If you set `funded_cents` anywhere else, `check:money` fails.
- **Test fixtures must respect the invariants too.** A fixture set `fundedCents: 7000` with no allocation and the race
  test failed with "Money invariants broken" even though the money code was right.
  → `test/fixtures.ts → seedNeed` creates a matching `seed` donation + allocation. **B's seed script must do the same**,
  then run `pnpm --filter @needgrid/api check:money`.
- **Idempotency comes from unique columns, not from "check then insert".** `recordCapture` does
  `INSERT … ON CONFLICT DO NOTHING` on the donation first; a concurrent duplicate waits for the first insert and then
  gets no row → returns the existing donation. Same for `webhook_events.paypal_event_id`.
- **Overflow must respect other donors' holds** (`roomCents` subtracts holds). A test covers it; keep it.
- **Closing a need with money attached is refused** (would strand donors' money until refunds exist in Phase 10).

## 6. PayPal (sandbox)

- **`category: "DONATION"` on order items → 403 `PERMISSION_DENIED_FOR_DONATION_ITEMS`.** Only accounts approved by PayPal
  for donations may use it. Decision: we don't pursue approval for a hackathon. `PAYPAL_DONATION_ITEMS=false` (default)
  omits the category. Write-up line: "In production, a donation-approved PayPal account would use the DONATION item category."
- **POST without `content-type` → 415 `UNSUPPORTED_MEDIA_TYPE`**, even when there's no body (capture). The fake didn't
  catch this; a real sandbox call did. → `paypalFetch` always sends `content-type: application/json` on non-GET.
  Lesson: **always do one real sandbox call** for each new PayPal endpoint; fakes only prove our logic.
- **Capture before the buyer approves → 422 `ORDER_NOT_APPROVED`.** We map it to `409 INVALID_STATE` with
  `details.paypalIssue`. Also mapped: `INSTRUMENT_DECLINED`, `PAYER_ACTION_REQUIRED`, `ORDER_EXPIRED`.
- **Capturing twice → 422 `ORDER_ALREADY_CAPTURED`** → we GET the order and return its existing capture.
- **Every POST needs a deterministic `PayPal-Request-Id`** (`order-<reservationId>`, `capture-<orderId>`,
  `verify-<transmissionId>`) so our own retries are idempotent on PayPal's side.
- **Webhook signature verification needs the exact bytes PayPal sent.** The verify request is built by string
  concatenation around the raw body; never re-serialise the parsed object.
- **The dashboard's webhook simulator can't be verified.** Test with real sandbox payments.
- **Unverified webhook events are not stored**, so a forged request can't occupy a real event id in the dedupe table.
- **Transaction Search must be enabled on the app** (Apps & Credentials → app → Features) for reconcile (Phase 7).
  Check: the OAuth token's `scope` contains `reporting/search/read`.
- **Sandbox can be flaky from this network** (connect timeouts). Retry once before assuming a code problem.

## 7. Fastify

- **Decorators (`requireStaff`, `isAllowedOrigin`) only reach other plugins when wrapped with `fastify-plugin`.**
- **`reply.hijack()` bypasses `@fastify/cors`.** SSE and NDJSON routes set `access-control-allow-origin` themselves.
- **Open SSE streams made `app.close()` hang forever** (test hook timed out after 60 s). `onClose` only runs after in-flight
  requests finish, and a stream never finishes. → End streams in a **`preClose`** hook (`routes/stream.ts`).
- **A `ReadableStream` can only be read once.** Calling `getReader()` twice on the same SSE response threw
  "ReadableStream is locked". Create one reader and keep reading from it (`sseReader` in `stream.test.ts`).
- **Raw body for one route only:** in an *encapsulated* plugin (no `fastify-plugin`), `removeContentTypeParser("application/json")`
  then `addContentTypeParser(..., { parseAs: "string" })`. Other routes keep the normal parser.
- **Rate limits key on `req.ip`**; `trustProxy: true` makes it the real client IP on Render. In tests, send a different
  `x-forwarded-for` per request (`nextIp()`) or the per-IP limit trips.
- **SSE can't be tested with `app.inject`**: listen on port 0 and use real `fetch`.

## 8. Tests

- **DB tests run against Neon from a laptop: ~250 ms per round trip.** Money tests make 20–40 round trips, so the default
  30 s timeout flaked (a *different* test failed each run). → `testTimeout`/`hookTimeout` 120 s in `vitest.config.ts`.
  If a different test fails on every run, suspect timeouts before logic.
- **DB test files share one database** → `fileParallelism: false`.
- **`resetTestDb` drops everything**, so it refuses to run if `TEST_DATABASE_URL` points at the same database as your dev
  `DATABASE_URL`. Most files use the cheaper `migrateTestDb` + `truncateAll`.
- **The app's own pool points at the test DB during tests** (`DATABASE_URL = TEST_DATABASE_URL` in vitest config), so route
  tests exercise real SQL. Close it with `closeDb()` in `afterAll`.
- **Never call real PayPal / Gemini / Channel3 in tests.** Swap in fakes: `setOrdersGateway(new FakePayPalOrders())`,
  `setWebhookVerifier(...)`, and restore the real ones in `afterAll`.
- **Assert money invariants after every money test** (`assertMoneyInvariants(t.db)` in `afterEach`).

## 9. Render

- **A Blueprint only creates env vars that had a value at creation time.** `PAYPAL_WEBHOOK_ID` (left empty) didn't exist on
  Render. → Add new variables by hand: service → Environment → Add → "Save, rebuild, and deploy".
- **Merges to `main` didn't redeploy once**: the live API kept old code (`/api/orgs` 404 while health was fine).
  → Service → Events to see why; Settings → Auto-Deploy "On Commit"; Manual Deploy → "Deploy latest commit".
  After every merge, check a route from that PR on the live URL.
- **Free plan sleeps**: the first request after idle takes ~10–50 s (curl timed out at 90 s once). Not an outage.
- **`needgrid-web` fails to build until `apps/web` exists** (C's first PR). Expected.
- **Migrations run in the API build command**; we couldn't confirm `preDeployCommand` is available on the free plan.
- **Placeholder secrets** (`PAYPAL_CLIENT_ID=placeholder`) let the API boot but break every PayPal call. Replace them before
  testing donations on the live URL.

## 10. Git workflow

- **One short-lived branch per PR**, created from fresh `main` (`git switch main; git pull; git switch -c feat/...`).
  No long-lived personal branches.
- **GitHub used a merge commit, not squash**, so `main` contained our commits unchanged and "merge main into your branch"
  was a no-op. Use `git merge --ff-only origin/main` to catch up safely. To make squash the default: repo Settings →
  General → Pull Requests.
- **Commit only your own paths** (`git add apps/api`, not `git add .`). Never commit `.env`.

## 11. Contract / ownership reminders

- `packages/shared` changes are additive only, bump the version, add a CHANGELOG line, announce in the SYNC message.
- B writes money/status only through `apps/api/src/core` functions. If you need a new one, ask A in `HANDOFF.md`.
- Every phase ends with a SYNC message (template in `AGENT_A_PHASES.md`): what's new, migration yes/no, new env vars, who is unblocked.

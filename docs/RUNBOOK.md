# Influensia Sourcing Platform — Runbook

How to install, seed, run, demo and test the platform on a laptop (macOS or Linux), and what changes when it moves to hosted Postgres / R2 / Resend / Vercel. Architecture and module APIs: `docs/FOUNDATION.md`, `docs/ARCHITECTURE.md`. Product: `docs/SPEC.md`. Design system: `docs/DESIGN.md`.

---

## 1. Prerequisites

| Need | Version | Notes |
|---|---|---|
| Node.js | **22 LTS** (tested on 22.22) or **24** | `node -v`. Nothing else: no Docker, no Postgres, no Redis. PGlite (Postgres compiled to WASM) runs inside the Node process. On a Mac: `brew install node@22` or `nvm install 22`. |
| npm | **10+** | Ships with Node. If `npm install` / `npm ci` crashes (a known npm 10 bug on this lockfile), run **`npx npm@latest install`** instead. |
| Git | any | |
| OpenSSL | any | To generate the auth secret (preinstalled on macOS). |
| Playwright Chromium | e2e tests only | `npx playwright install chromium` once. |

Disk: ~1 GB for `node_modules`, ~60 MB per seeded data dir. RAM: 8 GB is enough; run one Next server at a time.

## 2. Install and run (≈ 5 minutes)

```bash
git clone <repo> influensia-platform && cd influensia-platform    # or unpack influensia-platform-deliver.tar.gz
npm ci                                  # or: npm install — if either crashes: npx npm@latest install
cp .env.example .env.local
openssl rand -hex 32                    # paste the output as BETTER_AUTH_SECRET=… in .env.local
npm run db:seed                         # builds ./.data with the demo dataset and self-checks it (~10 s)
npm run dev                             # → http://localhost:3000
```

`.env.local` needs exactly two lines for local use:

```
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=<64 hex chars from openssl>
```

- **PGlite is single-process.** Stop `npm run dev` (Ctrl-C) before `db:seed` / `db:reset` / `outbox:drain`, or they fight over `./.data/pglite`.
- `BETTER_AUTH_URL` must equal the origin you open in the browser, port included — otherwise every sign-in is `403 INVALID_ORIGIN`. Use `http://localhost:3000`, not `127.0.0.1`.
- Production mode locally: `npm run build && npm start`.
- A stuck server: `pkill -f "[n]ext dev"; pkill -f "[n]ext start"` (the `[n]` keeps pkill from matching your own shell).

### 2.1 Today-relative demo data

The demo dataset (SPEC §7) is written for "today" = **Mon 28 Sep 2026**. `npm run db:seed` moves **every** date it writes — timestamps, due dates, ETAs, offer/quote validity, catalog validity, dates inside update texts ("ETA 1 Dec 2026"), dated file names — forward by the number of days between 28 Sep 2026 and the day you run it. So on any future day the demo looks fresh: offers are still valid, ETAs are ahead, "last change 5 d" reads the same, and the ops dashboard shows **3 stale · 9 waiting on us · 3 waiting on client · 1 unassigned** (with *All* selected).

- The shift is whole calendar days, so the seed's "today" is the real today. The dataset keeps its stale/not-stale margins on every weekday (not-stale lines changed ≤ 6 calendar days ago, stale ones ≥ 11). The seed re-runs its SPEC §7.16 self-checks on the shifted data every time and prints `clock <date>, shifted +N d`.
- **Seed on the day of the demo.** The data is correct for the day it was seeded and the next; after that lines start going stale and quotes expire, exactly as they would in real life.
- References (`REQ-2026-0312`, `ORD-2026-0290`, bank references like `WIRE-0922-A`) are identifiers, not dates, and never move.
- `SEED_SHIFT_DAYS=0 npm run db:seed` gives the literal SPEC dataset (28 Sep 2026); any whole number works (`SEED_SHIFT_DAYS=35`). If `SEED_CLOCK` is set, the shift is computed from that date instead of the wall clock. Logic: `src/db/seed-clock.ts`.

## 3. Logins (password `Password123!`)

| Email | Role | Lands on |
|---|---|---|
| `marko@influensia.ro` | admin | `/ops` — also invites users, edits clients and pricing rules, runs the outbox worker, publishes ranges/products |
| `bogdan@influensia.ro` | agent | `/ops` |
| `cristina@influensia.ro` | agent | `/ops` |
| `piotr@example.pl` | client — Piotr's team (PL) | `/app` |
| `buyer@koff.example` | client — KOFF (PL), user "Anna" | `/app` |

Clients never see `/ops` (404); agents opening `/app` are redirected to `/ops`. New users are created only by an admin (`/ops/clients` → "+ Client" / "Invite user"); the invite link opens a set-password page. Use two browser profiles (or one normal + one private window) to be client and agent side by side.

## 4. Ten-minute guided demo

Seed first (`npm run db:seed`), then `npm run dev`. Dates below are relative to the seed day ("today").

### Client journey — 5 min

1. **Piotr's dashboard** — sign in as `piotr@example.pl` → `/app`. One "Waiting on you" card (*Sample received — Standard sleeves 80 µm*), 8 lines in progress grouped by milestone, each with a plain-language next step ("Price by ~…") and a dot stepper; the order shows its Gdańsk ETA.
2. **A line in production** — open `REQ-2026-0312-01` (`/app/lines/REQ-2026-0312-01`). Dated 9-step stepper, Now → Next band, facts strip (qty, price + fee, ETA), what we confirmed (spec v1), accepted offer, approved sample, order card, "More from this factory". Point out: **no supplier name anywhere** — the factory is "Factory F-0042".
3. **Approve a sample** — back on the dashboard click **Approve sample** (`/app/samples/SMP-2026-0312-02-1`) and approve. The waiting card disappears; ops gets an email (see `/ops/outbox`).
4. **The order** — `/app/orders/ORD-2026-0312`: payments (deposit + fee paid, balance "on QC pass"), artwork approved, published PI and dieline, shipping ETA.
5. **Catalog & factory range** — `/app/catalog`: reference prices with MOQ, incoterm, spec version, valid-until; the F-0042 range → tick items, set quantities, **Request these items** (creates a new request in one step).
6. **KOFF decides an offer** — sign in as `buyer@koff.example`. The dashboard shows two actions. Open `/app/offers/OFR-2026-0301-01-v1` (gloves): valid-until countdown, option A price, fee, total, what happens next → **Accept option A**.
7. **Delivered order** — `/app/orders/ORD-2026-0290` (shelving): full history, paid in full, QC passed, bill of lading, **Confirm delivery**, then **Reorder** (same spec, new quantity).

### Agent journey — 5 min

1. **Ops dashboard** — sign in as `bogdan@influensia.ro` → `/ops`, switch **Mine → All** (`/ops?scope=all`): 3 stale · 9 waiting on us · 3 waiting on client · 1 unassigned. **Claim** the unassigned `REQ-2026-0325-01` (LED floodlight).
2. **Sourcing board** — `/ops/lines/REQ-2026-0312-01?tab=sourcing`: 9 suppliers, compare strip (best clean $0.0539 Yuantuo, lowest $0.0320 excluded as dropped/expired, spread 2.4×, 6 quotes of 8 contacted), per-row factory/trader verdicts, the `ZZLEAKTEST` canary supplier (visible to ops only).
3. **Leak check** — same line, **Timeline** tab: choose *Client update*, type `as Yuantuo confirmed, production starts Monday` → **Post** is blocked by the leak check. Rephrase without the name → published.
4. **Build an offer** — `/ops/lines/REQ-2026-0312-03?tab=offer` (Japanese sleeves, negotiating): options from quotes, price ladder with uplift/fee, deviations in plain words, **Send** → the client sees "Price ready".
5. **Order operations** — `/ops/orders/ORD-2026-0312`: PO with ex-works ETA, payments, documents (publish only after leak check; the canary `quote-…-copy.xlsx` stays internal), inspection → balance → forwarder → shipped → delivered.
6. **Find anything** — press **⌘K** and type `0290` or `Yuantuo`.
7. **Emails** — sign in as `marko@influensia.ro` → `/ops/outbox`: every notification the demo produced; **Run worker now** writes them to `./.data/outbox.log` (nothing is sent in local mode).

To start over: stop the server, `npm run db:reset`, start again.

## 5. Data and reset

| Path | What | Reset |
|---|---|---|
| `./.data/pglite/` | the database | `npm run db:reset` (= `rm -rf .data && npm run db:seed`) |
| `./.data/files/` | uploads: `org/{orgId}/{entity}/{entityId}/{client\|internal}/{uuid}.ext` | same |
| `./.data/outbox.log` | every "sent" email as one JSON line (local sender) | same |
| `./.data/e2e/`, `./.data/e2e-snapshot/` | Playwright's own seeded copy + pristine snapshot | recreated by every e2e run |
| `docs/fixtures/` | files the seed writes for tests (sample PDFs/CSV) | regenerated by every seed |

`.data/`, `.next/`, `node_modules/`, `test-results/`, `playwright-report/`, `docs/fixtures/` and `.env*.local` are git-ignored.

## 6. Tests

```bash
npm run lint          # ESLint incl. the anonymity import boundary (client code may not import the supplier schema or ops modules)
npm run typecheck     # tsc --noEmit
npm run test:unit     # Vitest — 197 tests, ~25 s (one file seeds its own PGlite with SEED_SHIFT_DAYS=0)
npm run build         # next build
CI=1 npx playwright test   # Playwright — 42 tests against next build + next start (~5 min); without CI=1 it uses next dev (slower)
```

- E2E uses port **3100** (`E2E_PORT`) and its own data dir, so it can run while you develop on :3000 — but only one e2e run at a time.
- The e2e seed is **today-relative too**: `playwright.config.ts` resolves `SEED_SHIFT_DAYS` once per run and gives the same value to the seeding server and to the specs, which compute expected dates with `sd()` / `sdLong()` from `tests/e2e/helpers.ts`. Export `SEED_SHIFT_DAYS=<n>` to replay a run as of another day.
- The web server seeds `.data/e2e`, snapshots it and starts Next with `E2E_RESET=1`; each spec file's `beforeAll(resetDb)` restores the snapshot through `POST /api/test/reset` (404 in every other environment).
- `tests/e2e/anonymity.spec.ts` (@critical) crawls every `/app` page and client file link for both clients and fails on any supplier identifier (canary `ZZLEAKTEST`, supplier names, contacts, `+86`, `Co., Ltd`, `有限公司`, platform domains, `SUP-`/`PO-` refs).
- One file: `npx playwright test tests/e2e/orders.spec.ts`. Failure traces: `npx playwright show-trace test-results/*/trace.zip`.

## 7. Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `BETTER_AUTH_URL` | `http://localhost:3000` | Must equal the served origin. |
| `BETTER_AUTH_SECRET` | dev fallback | **Required** (`openssl rand -hex 32`). Rotating it signs everyone out. |
| `DATABASE_URL` | unset → PGlite | Postgres connection string; switches the driver (§9.1). |
| `PGLITE_DIR` / `FILES_DIR` / `OUTBOX_LOG` | `./.data/pglite` / `./.data/files` / `./.data/outbox.log` | Local storage locations. |
| `SEED_SHIFT_DAYS` | unset → days since 28 Sep 2026 | Seed only: whole days to move the demo dataset (§2.1). `0` = literal SPEC dates. |
| `SEED_CLOCK` | unset → wall clock | Fixed "now" (ISO) read by every service through `clock.ts`; the seed also derives its shift from it. Leave unset for demos. |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | unset → local disk | R2/S3 storage (§9.2 — adapter is a stub today). |
| `RESEND_API_KEY`, `EMAIL_FROM` | unset → local sender | Real email (§9.3 — sender not wired yet). |
| `CRON_SECRET` | unset | Bearer token for `/api/cron/outbox`. |
| `E2E_PORT`, `E2E_RESET`, `E2E_SNAPSHOT_DIR`, `AUTH_RATE_LIMIT` | set by `playwright.config.ts` | Test-only. Never set `E2E_RESET` or `AUTH_RATE_LIMIT=off` in production. |

## 8. Known gaps

From `docs/QA_REPORT.md` (fix status) and `docs/UX_REVIEW.md` (deferred items):

- **Hosting adapters are stubs:** R2/S3 storage (`src/server/shared/storage/s3.ts` throws) and the Resend email sender (local sender only). See §9.
- **QA-26 (deferred):** no forced password change on first sign-in with an admin-issued temporary password (users change it in Settings; the invite link gives a proper set-password page). Login throttling is Better Auth's per-IP limiter only, not the per-account lockout of AC-AUTH-07/08/09.
- **QA-14 (partly):** the ops price-input parser strips a leading "-" and letters before the server validates.
- **UX deferred:** numeric inputs are not grouped as you type (1000000 vs 1,000,000); no dark-mode toggle (tokens exist); no combined filterable table on the ops dashboard; no request ⋯ menu (add line / import / close request); spec keys are free-form (datalist of known keys, no per-category template); single-transition change-state still opens the sheet; document actions are always visible (no hover reveal); client dashboard sort order differs slightly from the list; the new-request rail does not show the assigned agent; edge-to-edge / horizontal mobile catalog cards; green settings switch; stepper connector animation.
- SPEC F-28 `X-Test-Clock` header not implemented (only `SEED_CLOCK` / `setClock()`); no background stale worker — staleness is computed live.
- SPEC 2.4 `/api/app/**` JSON routes are not built (pages use server components + actions), so the anonymity crawl covers pages and file links.
- Ops "preview as client" exists for orders only. Supplier performance: `defect_rate` and `quote_accuracy` are not computed yet.

## 9. Next steps to go live

Order: Postgres → R2 → Resend → Vercel → real users. Nothing else in the code needs to change for hosting.

### 9.1 Postgres (Neon recommended, Postgres 16)
1. Create a Neon project (EU region); copy the **pooled** connection string into `DATABASE_URL` (the client runs with `prepare: false`).
2. `DATABASE_URL=… npm run db:migrate` applies `drizzle/*.sql` (`app` + `supplier` schemas + Better Auth tables). Run it in the deploy step so a bad migration fails the deploy, not the first request.
3. Optional demo data: `DATABASE_URL=… npm run db:seed` **truncates every table** and reseeds — never against production data. Use a separate Neon branch for demos.
4. Schema changes: edit `src/db/schema/*.ts` → `npm run db:generate -- --name <what>` → commit `drizzle/`. Never edit an applied migration.
5. E2E always uses PGlite (the snapshot/reset mechanism is PGlite-only).

### 9.2 Cloudflare R2 (files)
Create a private bucket; set `S3_BUCKET`, `S3_ENDPOINT` (`https://<account>.r2.cloudflarestorage.com`), `S3_REGION=auto` and an R2 API token's keys. Then implement `S3Storage` (`put/get/copy/delete/exists/downloadUrl`) with `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` — downloads become a 302 to a 60 s presigned URL after the same `canReadKey` check (ARCHITECTURE §6). Key layout and the `/client/` vs `/internal/` rule stay the same; migrate existing files by copying `./.data/files/org/**` to the bucket root.

### 9.3 Resend (email)
Verify the sending domain in Resend (SPF/DKIM); set `RESEND_API_KEY` and `EMAIL_FROM`. Implement `resendSender` next to `localSender` in `src/server/shared/outbox.ts`, wrap it in `withLeakGate(sender, await loadLeakSources(db))` (last-gate leak check on every `client_*` email) and select it when `RESEND_API_KEY` is set.

### 9.4 Vercel
Import the repo; Node runtime (not edge) for everything that touches the db; set `BETTER_AUTH_URL` (the production origin), `BETTER_AUTH_SECRET`, `DATABASE_URL`, the S3 and Resend variables and `CRON_SECRET`; add a Vercel Cron hitting `/api/cron/outbox` every minute. PGlite does not work on serverless — `DATABASE_URL` is mandatory there. Add preview domains to Better Auth `trustedOrigins` if you use preview deployments.

### 9.5 Before real clients
Create the agency admin with `db:seed` on a demo branch only; on production create users through `/ops/clients` (invite links). Decide QA-26 (forced password change). Run `CI=1 npx playwright test` against every release — the anonymity crawl is the guardrail for the core promise (clients never see who the factory is).

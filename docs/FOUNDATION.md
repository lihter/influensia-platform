# Influensia Sourcing Platform — Foundation

Version 1.1 · 28 Sep 2026 · What the foundation phase delivered, how to run it, the module APIs feature engineers must use, and who owns which files. v1.1 adds the integration-pass shared changes (§9). Day-to-day operation (install, logins, env, switching to Postgres/R2/Resend): `docs/RUNBOOK.md`.

Read `docs/ARCHITECTURE.md` (infra, verbatim), `docs/SPEC.md` (product) and `docs/DESIGN.md` (tokens/components) first; this document is the map between them and the code.

---

## 1. Run it

```bash
npm install            # npm 10 crashes on some installs → `npx npm@12 install`
npm run db:seed        # resets ./.data (PGlite + files + outbox.log), migrates, seeds SPEC §7, prints a summary (~9 s)
npm run dev            # http://localhost:3000  (.env.local already has BETTER_AUTH_URL/SECRET for :3000)
```

Logins (password `Password123!`): `marko@influensia.ro` (admin) · `bogdan@influensia.ro` (agent) · `cristina@influensia.ro` (agent) → `/ops`; `piotr@example.pl` (Piotr's team) · `buyer@koff.example` (KOFF) → `/app`.

Checks (all green on the integration commit):

```bash
npm run lint && npm run typecheck && npm run test:unit && npm run build && npm run test:e2e
```

- `test:unit` — Vitest, 137 tests in 11 files: foundation (state machine, leak check, DTO denylist, money, derived, messages) + per-feature pure logic.
- `test:e2e` — Playwright, 42 tests in 7 spec files (anonymity, board, catalog, clients, orders, requests, smoke). It seeds its **own** PGlite dir (`.data/e2e/`), copies it to `.data/e2e-snapshot/`, and starts `next dev -p 3100` (`CI=1` → `next build && next start`); the developer's `.data/pglite` is untouched. **Every spec file starts from the fresh seed**: `test.beforeAll(resetDb)` (`tests/e2e/helpers.ts`) POSTs `/api/test/reset`, which closes PGlite in-process, restores the snapshot (db + files + outbox.log) and drops the cached db/auth singletons — see §9. Tests inside a file are serial and may depend on each other; files are independent. In this container `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` is set by the config. Full run ≈ 6 min against `next dev`, ≈ 2.5 min with `CI=1` (both green). The config also sets `AUTH_RATE_LIMIT=off` because `next start` enables Better Auth's per-IP sign-in limiter.
- **PGlite is single-process**: stop `next dev` before `db:seed`/`db:reset`. Set `DATABASE_URL` to use Postgres instead (seed truncates and reseeds).

Other scripts: `db:generate -- --name <what>` (after any schema change; commit `drizzle/`), `db:migrate`, `db:reset`, `auth:schema` (regenerates `src/db/schema/auth.ts` — never hand-edit), `outbox:drain`.

---

## 2. What exists

| Area | Files | Notes |
|---|---|---|
| Scaffold | `next.config.ts`, `eslint.config.mjs`, `vitest.config.mts`, `playwright.config.ts`, `drizzle.config.ts`, `src/app/globals.css`, `src/app/layout.tsx`, `src/i18n/request.ts`, `messages/en.json` | Next 16.3.6 / Tailwind 4 / shadcn v4 (radix) / next-intl single locale / Figtree + JetBrains Mono via `next/font`. `globals.css` is DESIGN §2.3 verbatim plus `.sheet`, `.eyebrow`, `.rule-ink`, `.link` utilities. |
| Schema | `src/db/enums.ts`, `src/db/types.ts`, `src/db/schema/{app,supplier,auth}.ts`, `drizzle/0000_init.sql` | 37 app+supplier tables + 7 Better Auth tables. All SPEC §3.6 enum values live in `enums.ts` as `text(col, { enum })`. |
| DB | `src/db/index.ts` (`getDb()`, `Db`, `Tx`, `DbOrTx`), `src/db/migrate.ts` | Dual driver, migrate-at-startup, globalThis singleton (spike, verbatim). |
| Auth | `src/lib/auth/{server,client,cli-config,invite-context}.ts`, `src/app/api/auth/[...all]/route.ts`, `src/proxy.ts`, `src/app/(auth)/**`, `src/app/logout/route.ts` | Invite-only: `user.create.before` hook rejects any sign-up not inside `inviteContext.run(...)`. `emailAndPassword.autoSignIn: false` — inviting a user never touches the caller's session. `inviteContext` (AsyncLocalStorage) lives on `globalThis` like `getAuth()`, so Turbopack HMR can't split them. |
| Authorization | `src/server/shared/authorize.ts` | `authorize()`, `currentCtx()`, `requireClientPage()`, `requireOpsPage()`, role helpers. |
| Shared modules | `src/server/shared/*` | state machine, transition, activity, outbox, storage, files, leak check, derived, compare, money, dates, clock, ids, labels, users, line-context, sourcing-counts, http. |
| Client DTOs | `src/server/client/dto/*.ts` | Every client-facing shape, `.strict()`, denylist-tested. |
| Repositories | `src/server/client/dashboard.ts`, `src/server/ops/{dashboard,lines,admin}.ts` | Patterns to copy. |
| Shells & pages | `src/components/app/app-shell.tsx`, `src/components/ops/ops-shell.tsx`, `src/app/(client)/**`, `src/app/(ops)/**` | Both doors, both dashboards, placeholder pages for every nav link, 404/error boundaries. |
| Shared components | `src/components/shared/*` (index: `@/components/shared`) | See §5. |
| Seed | `src/db/seed.ts` | SPEC §7 in full, idempotent, asserts §7.16 before exiting. |
| Tests | `tests/unit/*.test.ts`, `tests/e2e/*.spec.ts`, `tests/e2e/helpers.ts` | `anonymity.spec.ts` is the SPEC 5.4 crawl (§9). |
| E2E reset | `src/app/api/test/reset/route.ts`, `src/server/shared/test-reset.ts` | 404 unless `E2E_RESET=1` + `E2E_SNAPSHOT_DIR` and no `DATABASE_URL`. |

---

## 3. Conventions you must follow

1. **No raw db in `src/app/**`** (lint-enforced): pages, layouts, route handlers and `actions.ts` call repositories in `src/server/{client,ops,shared}`. A repository takes `ctx: Ctx` first and scopes by `ctx.orgId` (client) or asserts `isOps(ctx)` (ops). Never trust an `orgId` from input.
2. **Anonymity boundary** (lint-enforced): `src/server/client/**`, `src/app/(client)/**`, `src/components/app/**` may not import `@/db/schema/supplier` or `@/server/ops/**`. Client repositories return `XDto.parse({ ...explicit fields... })` — never `Dto.parse(row)` / `{...row}`. Add new client shapes to `src/server/client/dto/` (they are picked up by the denylist test automatically via glob).
3. **Every mutation logs activity** (`logActivity(tx, …)`) inside its transaction; client-visible payloads are client-DTO-shaped (no supplier keys).
4. **State changes only via `transition()` / `transitionOrder()`**. Never write `state`/`milestone` directly.
5. **Server actions**: `actions.ts` beside the page, `"use server"`, zod schema in the file, `authorize(...)` first, one repository call, `revalidatePath`, return `ActionResult` (`{ ok: true, data } | { ok: false, error, errors?, hits? }`) via `toActionError(e)` — never throw across the boundary except `redirect()`.
6. **Pages** are `dynamic = "force-dynamic"`; pages that touch the db start with `await requireClientPage()` / `requireOpsPage()` (they redirect/404 instead of throwing — pages render in parallel with layouts in Next 16).
7. **Money**: integer minor units + currency for amounts (`*_minor`); unit prices in `*_minor_e2` (minor × 100 = 1/10,000 of a dollar) so `$0.0539` is exact. Format only through `money.ts` / `<Money>` `<UnitPrice>`.
8. **Time**: `now()` from `clock.ts` (honours `SEED_CLOCK`), `dates.ts` for formatting and working days. Dates columns are `yyyy-mm-dd` strings, timestamps are `Date`.
9. **Strings**: `messages/en.json` via `useTranslations`/`getTranslations`; in repositories/seed use `labels.ts` (reads the same JSON). Client-facing keys never say organisation/supplier/factory (`messages.test.ts`).
10. **Refs**: `nextRef(db, "REQ"|"ORD"|"PRD"|"SUP"|"FACTORY_LABEL"|"FR")`; derived refs from `ids.ts` (`lineRef`, `offerRef`, `sampleRef`, `orderRefFromRequest`, `poRef`, `piNumber`). URLs use refs, never uuids.

---

## 4. Module APIs

### `src/server/shared/authorize.ts`
```ts
type Ctx = { userId; email; name; orgId; authOrgId; role: Role; orgType }
authorize(opts?: { roles?: Role[] }): Promise<Ctx>          // throws Unauthorized (401) / Forbidden (403)
currentCtx(): Promise<Ctx | null>                             // never throws for "not signed in / no membership"
requireClientPage(next?) / requireOpsPage(next?)              // page guards: redirect to /login, /ops, or notFound()
isOps(ctx) · isClient(ctx) · isAdmin(ctx) · doorFor(role) · CLIENT_ROLES · OPS_ROLES
Unauthorized · Forbidden · NotFound                            // mapped by route() and toActionError()
```

### `src/server/shared/state-machine.ts` (pure)
`STATES` (24) · `MILESTONES` (9) · `MILESTONE_OF` · `milestoneFor(state)` · `milestoneStep(m)` (1..9) · `ACTION_MILESTONES` · `TRANSITIONS` · `canTransition` · `assertTransition` (throws `IllegalTransition` with `code = "E_ILLEGAL_TRANSITION"`) · `milestoneChanged(from, to)` · `LANE_OF` · `isBeforeOrder` · `DEFAULT_OWNER` · `FEED_STATES` / `isFeedState` (which `state_changed` events belong in the client Updates feed).

### `src/server/shared/transition.ts`
```ts
transition(lineId, to, ctx | null, opts?)        → { from, to, milestone, eventId }
transitionOrder(orderId, to, ctx | null, opts?)  // mirrors state to every order line's request line
opts: { note?, payload?, notifyClient?: false, override?: { reason }, at?, tx?, clearException? }
setException({ lineId } | { orderId }, exception | null, ctx, { reason?, at?, tx? })
```
In one transaction: `FOR UPDATE` lock → table check (or admin `override`) → state/milestone/`last_state_change_at`/`stale_since=null` → request status roll-up → `state_changed` activity (client-visible, payload `{ref, from, to, milestone, milestoneChanged, feed, note, …payload}`) → outbox: `client_milestone_changed` to every client user when the milestone changed (skip with `notifyClient: false` when you enqueue a more specific template, SPEC N-05), `ops_new_request` to all agents/admins when `to === "submitted"`.

### `src/server/shared/activity.ts`
`logActivity(tx, { orgId, entityType, entityId, type, actorId?, actorName?, payload?, visibility?, at? })` → event id. `listActivity(db, { entityType, entityId, visibility?, limit? })`.

### `src/server/shared/outbox.ts`
`enqueue({ userId, toEmail?, template, subject?, entityRef?, payload, idempotencyKey, sendAfter?, at? }, tx?)` (ON CONFLICT DO NOTHING on the key; convention `<template>:<entityId>:<discriminator>[:<userId>]`) · `drain(sender = localSender, limit = 50)` → `{ due, sent, failed }` with 1/5/15/60/240-min backoff, `failed` after 5 · `retry(id)` · `localSender` (console + `OUTBOX_LOG` = `./.data/outbox.log`) · `withLeakGate(sender, sources)` (last-gate leak check on every `client_*` row). Templates are the SPEC §6 names (`NOTIFICATION_TEMPLATES` in `enums.ts`). Recipients: `users.ts` → `clientUsersOf(db, orgId)`, `opsUsers(db)`, `userById`, `userNames`.

### `src/server/shared/storage/*` + `files.ts`
`getStorage()` (local disk under `FILES_DIR` or `./.data/files`; S3/R2 stub when `S3_BUCKET`) · `fileKey({ orgId, entity, entityId, visibility, id, ext })` → `org/{orgId}/{entity}/{entityId}/{client|internal}/{uuid}.ext` · `assertValidKey` · `withVisibility(key, "client")` · `storeUpload(db, { orgId, userId, data, mime, originalName, entity, entityId, visibility, at? })` (sharp re-encode to JPEG for images, EXIF stripped, `files.exif_stripped`) · `storeDocument(db, {...same, filename, kind, sources?})` (adds the `documents` row + `document_uploaded` event; leak-checks filenames of client uploads) · `isPublishableKind(kind)` · `canReadKey(ctx, key, agencyOrgId)` · `parseKey`. Download route: `GET /api/files/{key}` — clients get 404 for other orgs and for any `/internal/` segment; agency-org `/client/` assets (catalog images) are readable by every signed-in user.

### `src/server/shared/leak-check.ts` (pure)
```ts
leakCheck({ text?, filenames?, pdfText?, fields?: Record<string,string> }, sources) → { ok: true } | { ok: false, hits: LeakHit[] }
assertClean(input, sources)          // throws LeakCheckError (code E_LEAK_CHECK, 422)
loadLeakSources(db, { fresh? })      // legal/CN names, handles, phones, contact names, USCC — cached 60 s; invalidateLeakSources()
stripCompanySuffix(name)
```
Detects full/stripped supplier names, distinctive tokens ≥ 6 chars (minus a generic-word set), CN names, handles, phones (digits), non-first-name contact names, USCC, platform URLs, `wechat|weixin|微信`, CN mobiles, `Co., Ltd`/`有限公司`, `SUP-`/`PO-`/`FR-` refs; exempts `Factory F-0042`; also scans URL-decoded and entity-decoded copies. Hits carry `{ kind, match, where }` (`where` = `text` | `filename` | `pdf_text` | your field name).

### `src/server/shared/derived.ts` · `compare.ts` · `line-context.ts` · `sourcing-counts.ts`
- `waitingOn({ state, exception?, offerStatus?, sampleStatus?, payments?, artworks? })` → `{ party, reason, detail? }` (SPEC B.2); `isStale(entity, now?)`, `staleSince(entity)` (SPEC B.3, 5 working days, Mon–Fri).
- `compare(line, participations, fx, now?)` → `{ quotes, bestClean, lowestQuoted, spread, quotesCount, contactedCount, staleCount }` (SPEC B.4) over plain `ParticipationInput` rows (ops maps supplier rows; the `label` is the supplier name and stays on the ops side); `normaliseQuote`; `sourcingProgress(parts)` → `{ reached, priced }`.
- `loadLineContexts(db, { orgId?, lineIds?, includeCancelled?, includeDrafts? })` → `LineContext[]` — everything the dashboards/lists need per line in app-schema terms (latest offer/sample, order + payments + artworks + ETAs, agent name, sourcing counts, `waiting`, `stale`). Use it instead of re-joining.
- `sourcingCounts(db, lineIds)` and `factoryLabelForLine(db, { lineId, orgId })` are the only supplier-schema reads allowed to feed client code, and they return numbers / a label.

### `src/server/shared/money.ts` · `dates.ts` · `clock.ts` · `labels.ts` · `ids.ts` · `http.ts`
- `formatMoney({ minor, currency })` `$6,740.00` · `formatUnitPrice({ minorE2, currency, unit? }, { decimals?, withUnit? })` `$0.0539 / pcs` · `formatQty` · `formatPct` · `parseMoneyToMinor` · `lineTotalMinor(qty, e2)` · `convertE2`.
- `formatDate` `22 Sep 2026` · `formatDateShort` · `formatDateTime` · `relative` · `daysBetween` · `ageLabel` `15 d` · `workingDaysBetween` · `addWorkingDays` · `isoDate`.
- `now()` · `today()` · `setClock(date | null)` (tests).
- `subLabelFor(state, { agentName, reached, priced, isRepeat })` · `exceptionClientText` · `eventText(type, payload)` (payload.text wins) · `isFeedEvent(type, payload)` · `milestoneLabel` · `stateLabel`.
- `nextRef` · `setSequence` · `formatRef` · derived ref helpers.
- `route(handler)` for route handlers (maps Unauthorized/Forbidden/NotFound/Zod/IllegalTransition/LeakCheckError → 401/403/404/400/409/422) · `ActionResult<T>` · `toActionError(e)`.

### `src/server/shared/supplier-performance.ts`
`recordSupplierPerformance(tx, orderId, at?) → Promise<void>` — SPEC 3.4 roll-up on `→ completed`: per distinct PO supplier, `orders_count + 1`, running `on_time_rate` (delivered ≤ `shipments.eta_port`; unchanged when no port ETA), `last_order_at`. Called inside the completing transaction by **both** paths: agent Close (`changeOrderState(…, "completed")` in `ops/orders.ts`) and client Confirm delivery (`confirmDelivery` in `client/orders.ts`). Touches the supplier schema internally, returns nothing — safe for client code.

### `src/server/shared/range-request.ts`
`createRangeRequest(tx, ctx, { rangeId, lineId, lineRef, factoryLabel, at? }) → { participationId }` — for a request line the caller has **already inserted** (state `negotiating`, `from_range_id`), creates the range factory's `selected` participation, sets `request_lines.selected_participation_id`, logs `participation_added` (internal). The participation id is a ServerOnly value for that column; nothing supplier-shaped comes back. Used by `requestRangeItems` in `client/ranges.ts` (replaces the old raw-SQL insert).

### Client document URLs
Every client-facing file link is `/api/files/{client key}?filename=…` (+ `&dl=1` for downloads) built by `clientDownloadUrl(storageKey, filename)` in `src/server/client/documents.ts`, which refuses a non-`/client/` key. `ClientDocumentDto.downloadUrl` and `ClientRangePdfDto.downloadUrl` always carry this shape; there is no `/api/app/documents` route. Catalog/range images use `/api/files/{client key}` directly.

### `src/server/shared/test-reset.ts` (E2E only)
`testResetEnabled()` · `resetToSnapshot()` — see §1 and `tests/e2e/helpers.ts` (`resetDb`, `login`). Never enabled with `DATABASE_URL`.

### `src/server/ops/admin.ts`
`inviteUser(ctx | null, { email, name, role, orgId? | orgName?, country?, password?, at? })` → `{ userId, orgId, email, tempPassword, inviteToken }`: creates org when needed (agents/admins always join the agency), Better Auth user + membership + `app.users` profile, invite token hash (7 d), `user_invited` event, `auth_invite` outbox row. Exposed to admins as `inviteUserAction` in `src/app/(ops)/ops/clients/actions.ts`.

### `src/server/ops/lines.ts`
`assignLine(ctx, lineId, agentId, agentName)` / `claimLine(ctx, lineId)` — `line_assigned` (internal) + `submitted → in_review` via `transition()`.

### Repositories to copy from
- Client: `src/server/client/dashboard.ts` — `getClientDashboard(ctx)`; exports `waitingItems(lcs)`, `activeLine(lc)`, `clientWaitingReason(lc)`, `etaLabelFor(lc)` for the list/line/order pages.
- Ops: `src/server/ops/dashboard.ts` — `getOpsDashboard(ctx, { mine })` → `OpsRow[]` buckets.

---

## 5. Components (`@/components/shared`)

| Component | Use |
|---|---|
| `PageHeader { eyebrow, eyebrowVariant, title, titleSuffix, meta, actions, tabs, sticky }` | DESIGN §4.2 on every page. |
| `Eyebrow { variant: plain\|pill, number }` | Numbering device. |
| `SectionBand`, `SectionHeading { number, title, action }`, `SheetList`, `SheetRow { href }` | Grounds, the 1 px ink rule, the sheet list. |
| `StateChip { state, stale }`, `MilestoneChip { milestone, waitingOnClient, showStep }`, `ParticipationChip`, `ExceptionChip { client }`, `OfferStatusChip`, `SampleStatusChip`, `PaymentStatusChip`, `VisibilityBadge`, `UtilityBadge` | The three chip families (DESIGN §5.3) + utility badges. Tones in `state-tone.ts`. |
| `MilestoneStepper { milestone, subLabel, waitingOnClient, sampleSkipped, state (ops), variant }`, `MilestoneBar` | 9 steps with ▲; phone summary; ops sub-state. |
| `WaitingOnYouCard { items, tone: client\|agency\|neutral }` | The one green surface; ops mirrors. |
| `KpiTile { label, value, meta, href, tone }` | Ops dashboard tiles. |
| `DataTable { columns, data, rowHref, isStale, isSelected, isNew, density, emptyState, initialSorting, globalFilter, maxHeight }` + `PrimaryCell` | TanStack (legacy API on v9) dense table; `meta: { numeric, strong, sticky, width, className }` per column; J/K/Enter. |
| `EmptyState { icon, title, body, action }` | DESIGN §5.6. |
| `Money`, `UnitPrice { plusFee, feeMinor, size }`, `Qty`, `Pct`, `DateTime { variant }`, `Age { stale }`, `Ref` | Mono formatters. |
| `Timeline { entries, showVisibility }` / `TimelineItem` (`kind`: milestone · action_milestone · note · whatsapp · question · system · document) | Client Updates/History and the ops feed. |
| `DocumentRow { name, kind, bytes, at, visibility, href, actions }` | Sheet-list document row with visibility badge. |
| `FactoryLabel { label, disclosed? }` | "Factory F-0042" dashed chip; has no supplier prop by design. |
| `FactsStrip { facts }` | Quantity · Price · ETA strip. |
| `FormShell { trigger, eyebrow, title, onSubmit, submitLabel, wide, submitVariant }` | Sheet-based create/edit form with sticky footer. |
| `PlaceholderPage { ns }` | What the placeholder routes render — replace, don't extend. |

shadcn components in `src/components/ui/` carry the DESIGN §2.3 overrides (`Button` variants `action`/`green`, `Badge` tone variants, underline `Tabs`, 12 px `Card`, 480 px `Sheet`). Do not re-run `shadcn add` over an existing file.

---

## 6. File ownership for the feature phase

Foundation-owned (do **not** edit; open an issue/PR to the foundation owner instead):

```
package.json, *.config.*, eslint.config.mjs, tsconfig.json, .env.example, drizzle/**          (schema changes: add columns in src/db/schema/*.ts → db:generate → send the migration for review)
src/db/**                       (except: you MAY add tables/columns to schema/app.ts|supplier.ts and extend seed.ts data for your feature — keep §7.16 checks green)
src/lib/**  src/i18n/**  src/proxy.ts  src/app/layout.tsx  src/app/globals.css  src/app/page.tsx  src/app/not-found.tsx
src/app/(auth)/**  src/app/logout/**  src/app/api/auth/**  src/app/api/files/**  src/app/api/cron/**
src/app/(client)/layout.tsx  src/app/(client)/app/page.tsx  src/app/(client)/{error,not-found}.tsx
src/app/(ops)/layout.tsx  src/app/(ops)/ops/page.tsx  src/app/(ops)/ops/actions.ts  src/app/(ops)/{error,not-found}.tsx
src/server/shared/**  src/server/client/dto/**  src/server/client/dashboard.ts  src/server/ops/{dashboard,lines,admin}.ts
src/components/ui/**  src/components/shared/**  src/components/app/{app-shell,client-dashboard}.tsx  src/components/ops/{ops-shell,ops-dashboard-tables}.tsx
tests/unit/{state-machine,leak-check,dto-denylist,money,derived,messages}.test.ts  tests/e2e/smoke.spec.ts
```

Feature ownership (create freely inside; add `messages/en.json` keys under your namespace; add DTOs under `src/server/client/dto/<feature>.ts`; add unit/e2e tests under your feature name):

| Feature (SPEC) | Routes | Server | Components |
|---|---|---|---|
| Intake + lists + queue (F-04, F-05, F-06, F-14) | `src/app/(client)/app/requests/**`, `src/app/(ops)/ops/queue/**`, `src/app/(ops)/ops/requests/**` | `src/server/client/requests.ts`, `src/server/ops/requests.ts` | `src/components/app/requests/**`, `src/components/ops/requests/**` |
| Line page + spec/cost/board/offer/timeline + samples (F-07, F-15…F-20, F-08, F-09) | `src/app/(client)/app/lines/**`, `app/offers/**`, `app/samples/**`, `src/app/(ops)/ops/lines/**` | `src/server/client/{lines,offers,samples,comments,documents}.ts`, `src/server/ops/{participations,quotes,offers,samples,comments,publish}.ts` | `src/components/app/lines/**`, `src/components/ops/board/**` |
| Orders (F-10, F-22, F-23) | `src/app/(client)/app/orders/**`, `src/app/(ops)/ops/orders/**` | `src/server/client/orders.ts`, `src/server/ops/orders.ts`, `documents.ts` | `src/components/app/orders/**`, `src/components/ops/orders/**` |
| Suppliers + products + catalog + ranges (F-11, F-21, F-24, F-25, F-12) | `src/app/(client)/app/catalog/**`, `src/app/(ops)/ops/suppliers/**`, `ops/products/**`, `ops/factory-ranges/**` | `src/server/client/{catalog,ranges}.ts`, `src/server/ops/{suppliers,products,ranges}.ts` | `src/components/app/catalog/**`, `src/components/ops/{suppliers,products}/**` |
| Clients admin + outbox + settings (F-26, F-27, F-01 settings) | `src/app/(ops)/ops/clients/**` (owns `actions.ts` there), `ops/outbox/**`, `ops/settings/**`, `src/app/(client)/app/settings/**` | `src/server/ops/{clients,outbox}.ts` | `src/components/ops/{clients,outbox}/**` |

Replace the placeholder `page.tsx` files in your routes (they render `PlaceholderPage`). Keep the nav labels; add nested routes as needed. Anything under `src/app/api/app/**` and `src/app/api/ops/**` (SPEC §2.4 JSON routes) belongs to the feature that owns the entity.

---

## 7. Deviations from SPEC / ARCHITECTURE (deliberate)

| Topic | Decision |
|---|---|
| Runtime | ARCHITECTURE wins over SPEC §0.2: PGlite at `./.data` (no docker, no `./var`), local outbox sender + `/api/cron/outbox`; no separate worker process (PGlite is single-process). `/ops/outbox` "Run worker now" is the feature's job (call `drain(localSender)`). |
| Auth URLs | `/login`, `/logout`, `/forgot-password` (task/SPEC), not the spike's `/sign-in`. `/invite/[token]` and `/reset-password/[token]` are not built: `forgot-password` is a stub that always shows success; invited users sign in with the temp password `inviteUser` returns (the token hash is stored for the feature to wire up). |
| Enums | `text(col, { enum })` (ARCHITECTURE) rather than `pgEnum` (SPEC App. A); values are verbatim SPEC §3.6 in `src/db/enums.ts`. |
| Unit prices | `*_minor_e2` (minor × 100) per ARCHITECTURE §9, not plain `*_minor`. Amounts stay `*_minor`. |
| Users table | `app.users` is a profile keyed by the Better Auth user id (email, name, deactivated/invite/password fields); roles live only on Better Auth `member.role`. |
| Cross-schema ids | `participation_id`, `po_id`, `supplier_id` on app tables are plain uuids without FKs (avoids an import cycle) and are branded `ServerOnly<string>`. |
| Preview mode | `/app` is clients-only; agents are redirected to `/ops` (SPEC 1.2). `/ops/.../preview` routes are the feature's job. |
| Client feed | `state_changed` events carry `payload.feed` (via `FEED_STATES`) so the Updates feed matches SPEC 7.12 without duplicating milestone crossings already covered by a more specific event; History shows every client-visible event. |
| Seed | Inserts rows directly with explicit timestamps (fast, deterministic) instead of replaying the domain services; users go through `inviteUser` → Better Auth. Activity and outbox rows are generated to mirror the histories; outbox rows are marked `sent` and written to `outbox.log` (80 rows). `docs/fixtures/*` are regenerated each run (git-ignored). |
| Ops dashboard "Mine" | Default Mine for agents (per SPEC) includes unassigned submitted lines so the queue is never hidden. |

---

## 8. Known gaps (for the feature phase)

- Invite landing (`/invite/[token]`), password reset tokens, rate limiting (AC-AUTH-07/08/09). (`/app/settings` F-01 self-service exists since the feature phase: rename + password change.)
- `resendSender` (React Email templates) — `withLeakGate(localSender, sources)` is wired conceptually; `/api/cron/outbox` uses `localSender`.
- `X-Test-Clock` header (SPEC F-28) — only `SEED_CLOCK` / `setClock()` exist; the stale worker that persists `stale_since` (derived values are computed live by `loadLineContexts`).
- `publishDocument()` (copy to `/client/` + leak check) and PDF/xlsx text extraction — `storeDocument`, `withVisibility`, `isPublishableKind`, `leakCheck` are ready.
- S3/R2 storage adapter is a stub (as in the spike).
- The anonymity crawl covers every `/app` page + client file link for both client users, cross-org 404s and ops non-vacuity; it does not yet crawl the SPEC 2.4 `/api/app/**` JSON routes (none are built — pages use server components/actions) or the `data-dto` JSON islands (none exist).
- `activity-coverage.test.ts` and `dto-strict.test.ts` (runtime parse over every seeded entity) — the seed already parses the dashboard DTOs for every line; extend per feature.
- Dark theme tokens are in `globals.css`; no toggle is wired.

---

## 9. Integration pass (v1.1) — shared changes after the feature phase

| Change | Where | Notes |
|---|---|---|
| `autoSignIn: false`; invite workaround removed; `AUTH_RATE_LIMIT=off` escape hatch (e2e only) | `src/lib/auth/server.ts`, `src/server/ops/clients.ts` (`inviteAsAdmin`) | The old `keepCallerSession` cookie juggling is gone; clients.spec asserts the admin stays on `/ops` after "+ Client". |
| HMR-safe invite context | `src/lib/auth/invite-context.ts` | `globalThis.__influensiaInviteContext`. |
| New activity types | `src/db/enums.ts` `ACTIVITY_TYPES` | `org_updated`, `user_deactivated`, `user_reactivated`, `pricing_rule_saved`, `profile_updated`, `supplier_created`, `supplier_updated`, `supplier_deleted`, `contact_added`, `contact_updated`, `contact_removed`, `product_created`, `product_updated`, `product_published`, `product_unpublished`, `product_image_added`, `product_image_removed`, `image_approved_clean`, `range_created`, `range_item_added`, `range_item_updated`, `range_item_removed`, `range_published`, `range_unpublished`. No more `as unknown as ActivityType` casts or `line_updated` + `payload.action`; every one of these events carries `payload.text` (all internal). `line_updated` stays for genuine line/order edits. |
| Ops nav | `src/components/ops/ops-shell.tsx`, `src/app/(ops)/layout.tsx` | Settings (`/ops/settings`) added; Outbox shows `pendingOutboxCount()` as a warning-tone badge (`data-testid=nav-count`). Client account menu already had Settings. |
| Shared helpers | `src/server/shared/{supplier-performance,range-request}.ts` | §4. ESLint boundary unchanged: `shared/**` may import the supplier schema, `client/**` may not. |
| DTO barrel | `src/server/client/dto/index.ts` | Re-exports every DTO file (requests, lines, orders, documents, catalog, ranges, settings). |
| Download URLs | `clientDownloadUrl` | §4 "Client document URLs". |
| `turbopack.root` | `next.config.ts` | Pinned to the project dir; `serverExternalPackages` unchanged. |
| Confirm-order cross-links | `src/components/ops/board/offer-builder.tsx`, `src/components/ops/requests/request-detail.tsx` | Offer tab → `/ops/orders/new?lineId=<lineRef>`; request page (any accepted line) → `/ops/orders/new?req=<reqRef>`. The page accepts `lineId`/`line`/`req`/`requestRef`. |
| Queue source badges | `src/server/ops/requests.ts`, `src/components/ops/requests/{queue-table,strings}.ts(x)` | `from_range_id` lines → "Range", `from_catalog` → "Catalog" (repeat still wins). |
| `/app/orders/[ref]/range` | `src/app/(client)/app/orders/[ref]/range/page.tsx`, `rangeIdForOrder` in `client/ranges.ts` | SPEC 2.2 route the order/line pages link to; redirects to `/app/ranges/[id]`, 404 for other orgs / no published range (AC-RNG-04). Found by the anonymity crawl. |
| Blocked publish is recorded from the dialog | `previewPublish` in `src/server/ops/documents.ts` | Clicking Publish on a leaky document logs `leak_check_blocked` + `ops_leak_blocked` (AC-DOC-02), same as a blocked `publishDocument`. |
| E2E isolation + anonymity crawl | `playwright.config.ts`, `tests/e2e/{helpers,anonymity.spec}.ts`, `src/app/api/test/reset` | §1. The crawl allow-lists exactly one client-authored string: KOFF's own pasted alibaba.com reference link on draft REQ-2026-0322-01. |


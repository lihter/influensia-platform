# Influensia Sourcing Platform — v1 Build Spec (local build)

| | |
|---|---|
| Version | 1.0 — 28 Sep 2026 |
| Status | READY TO BUILD |
| Sources of truth | `docs/blueprint.html` (decisions D-01…D-23, stack T-01…T-14, 36-table model, anonymity mechanisms 1–9, wireframes) · `docs/discovery.html` (lifecycle, Quote-vs-Offer boundary, data per milestone) · `docs/SEED_CONTEXT.md` · `docs/sourcing_tracker_export.txt` |
| Audience | Engineers building v1; QA testing v1 in a browser. Nobody will answer follow-up questions — where this document is silent, the blueprint decides; where both are silent, do the simplest thing that keeps every acceptance criterion green. |
| Scope | The **local v1 build**: everything below runs on one laptop with seeded data, no external services. Hosted deployment (Vercel, Neon, R2, Resend) is out of scope for this spec but nothing here may make it harder (T-01…T-14 remain the target). |

## Contents

0. Conventions, local runtime, glossary
1. Personas, the two doors, permissions matrix
2. Route map (auth, /app, /ops, /api)
3. State machine and enums
4. Feature specs F-01 … F-30 with acceptance criteria
5. Anonymity requirements (testable)
6. Notification events
7. Seed dataset
8. Non-goals for v1
9. Build order and definition of done
- Appendix A — Data-model deltas vs the blueprint
- Appendix B — Derived-value functions (milestone, waiting_on, stale, compare, leak check)
- Appendix C — messages/en.json key groups

---

## 0. Conventions, local runtime, glossary

### 0.1 Fixed decisions

Every decision in the blueprint (D-01…D-23, T-01…T-14) is binding. This spec adds detail; it never reverses. Where this spec names a column or enum value not in the blueprint, it is listed in Appendix A so the schema stays one document.

### 0.2 Local runtime (what "works on a laptop" means)

| Concern | Local implementation | Hosted equivalent (unchanged target) |
|---|---|---|
| App | Next.js 16 App Router, `pnpm dev` on `http://localhost:3000` | Vercel (T-01) |
| Database | PostgreSQL 16 in `docker compose` (`db` service, port 5432, database `influensia`), Drizzle migrations, **two schemas `app` and `supplier`** (T-02) | Neon |
| Auth | Better Auth 1.7, email + password, Drizzle adapter (T-03). Session cookie 30 days. | same |
| Files | Local disk under `./var/files/` behind a `StorageAdapter` interface with the **same key scheme** `org/{orgId}/{entity}/{id}/{client\|internal}/{uuid}` (T-05). Download goes through the app (streams the file), never a static route. Images re-encoded with `sharp` (EXIF stripped). | Cloudflare R2, presigned URLs |
| Email | **Never sent.** `notification_outbox` rows are drained by the local worker, which appends one JSON line per email to `./var/outbox.log` and prints `[outbox] template=<name> to=<email> subject=<subject>` to the console, then marks the row `sent`. | Resend (T-06) |
| Background work | `pnpm worker` process ticking every 30 s **and** a "Run worker now" button on `/ops/outbox`. Jobs: drain outbox, expire offers, compute stale flags (see B.3), daily digest at 07:00 Europe/Zagreb (also triggerable manually). | Vercel Cron every minute (T-07) |
| Seed | `pnpm db:reset` = drop + migrate + seed (Section 7). Idempotent. | same script, gated |
| Tests | `pnpm test` (Vitest) · `pnpm test:e2e` (Playwright, includes the anonymity crawl) | GitHub Actions |
| Time | All timestamps UTC in the DB; display in Europe/Zagreb for ops, in the org's timezone (default Europe/Warsaw for seeded clients) for /app. Working days = Mon–Fri, no holiday calendar. | same |
| Money | Integer minor units + ISO currency (D-21). USD everywhere client-facing. FX table seeded with `USD/CNY 6.6933 @ 2026-09-21` (from the Best Prices tab). | same |
| i18n | `messages/en.json` via next-intl (D-20). No hard-coded UI strings. | same |

### 0.3 Reference formats (T-11)

| Entity | Format | Example | Sequence |
|---|---|---|---|
| Request | `REQ-{yyyy}-{nnnn}` | `REQ-2026-0312` | `sequences(name='REQ', year)` |
| Request line | `{request_ref}-{nn}` | `REQ-2026-0312-01` | line_no within request |
| Offer | `OFR-{yyyy}-{nnnn}-{nn}-v{n}` | `OFR-2026-0312-01-v1` | version within line |
| Offer option | `{offer_ref}/{A\|B\|C}` | `OFR-2026-0312-01-v1/A` | — |
| Sample | `SMP-{yyyy}-{nnnn}-{nn}-{n}` | `SMP-2026-0312-01-1` | per line |
| Order | `ORD-{yyyy}-{nnnn}` — reuses the request number; a second order from the same request gets `-B`, `-C` | `ORD-2026-0312` | derived |
| Purchase order | `PO-{yyyy}-{nnnn}-{nn}` | `PO-2026-0312-01` | per order |
| Product | `PRD-{nnnn}` | `PRD-0041` | `sequences('PRD')` |
| Supplier | `SUP-{nnnn}` | `SUP-0007` | `sequences('SUP')` |
| Factory range label | `Factory F-{nnnn}` | `Factory F-0042` | `sequences('FACTORY_LABEL')` — **never derived from the supplier** |
| Factory range (internal ref) | `FR-{nnnn}` | `FR-0001` | `sequences('FR')` |

Primary keys are UUIDv7. URLs use refs, never UUIDs, except for entities without refs (documents, comments, inspections, shipments, ranges use `FR-`), which use UUIDs.

### 0.4 Glossary

| Term | Meaning |
|---|---|
| Line | A `request_lines` row. Sourcing status lives here. One product × one quantity. |
| Participation | A `supplier_participations` row: one supplier working one line (the sourcing-board row). |
| Quote | A `quotes` row under a participation, internal only. |
| Offer | The client-facing, anonymised price document for one line, with options A/B/C. |
| Milestone | One of 9 client-visible steps. Derived from state, never stored independently of it (stored for indexing, always recomputed on write). |
| State | One of 24 internal states. On a line before an order exists; on the order (and mirrored to its lines) afterwards. |
| Exception | A nullable flag on a line or order (`needs_input`, `change_requested`, …). Does not change the milestone. |
| Waiting on | Derived: `client` / `agency` / `none`. Drives both dashboards. |
| Stale | Derived: waiting on agency and no state change for > 5 working days. |
| Publish | The explicit act of making a document, comment, offer, product or range visible to a client. Always runs the leak check. |
| Leak check | Scan of text/filename/PDF text layer for supplier identifiers (B.5). |
| Clean image | `product_images.kind = clean` — the only image kind serialised to clients. |
| ZZLEAKTEST | The seeded canary supplier `ZZLEAKTEST Co., Ltd.` whose identifiers must never appear on any /app page or client API response. |

---

## 1. Personas, the two doors, permissions

### 1.1 Personas

| Persona | Seed user | Door | What they come to do | What they must never see |
|---|---|---|---|---|
| **Client buyer** (Piotr — Allegro seller, first platform client) | `piotr@example.pl` | `/app` | Paste links → get a price → accept → approve sample → pay → upload artwork → see ETA → confirm delivery → reorder. One question: "what do you need from me?" answered by the dashboard. | Any supplier identity, raw quotes, internal notes, margins, target prices, other clients' data. |
| **Client buyer at a distributor** (KOFF buyer) | `buyer@koff.example` | `/app` | Same as above; more lines in flight; catalog reorders. | Same. |
| **Agent** (Bogdan — negotiation, factory contact; Cristina — commercial, spec) | `bogdan@influensia.ro`, `cristina@influensia.ro` | `/ops` | Claim requests, freeze specs, run the sourcing board, log quotes, build offers, run orders, publish documents, keep status fresh. | Nothing hidden; pricing-rule editing and user admin are admin-only. |
| **Admin** (Marko) | `marko@influensia.ro` | `/ops` | Everything an agent does + invite users, create clients, publish catalog products and factory ranges, edit pricing rules, run the worker, inspect the outbox. | — |
| **Automation** (service account) | none in v1 local | `/api/v1` | Out of scope for the local build; `api_keys` table exists, no endpoints. | — |

### 1.2 The two doors (D-01)

* One codebase. Role decides the door: `client_owner` / `client_member` → `/app`; `agent` / `admin` → `/ops`.
* A client user requesting any `/ops/*` URL gets **404** (not 403 — the existence of ops is not disclosed). An agent/admin requesting `/app/*` gets redirected to `/ops` (agents preview client pages through `/ops/.../preview`, see Section 2).
* Unauthenticated requests to `/app/*` or `/ops/*` redirect to `/login?next=<path>`.
* Code boundary (blueprint §07 mechanism 1): `src/server/client/**` may import `db/schema/app` only; `src/app/(client)/**` may import only `src/server/client` and `src/server/shared`. Enforced by ESLint `no-restricted-imports`; CI fails on violation.

### 1.3 Organisations (D-03)

* `organizations.type ∈ {agency, client, partner}`. Exactly one `agency` org exists (Influensia). Every client user belongs to exactly one client org via `memberships`.
* Inviting a client user with no org creates one named after the user's company field (fallback: the email domain) with defaults: `commercial_mode=agency_passthrough`, `pricing_display=factory_plus_fee`, `currency_display=USD`, `default_incoterm=FOB`, `deposit_pct=30`, `language=en`.
* The word "organisation"/"organization"/"company account" never appears in `/app` UI strings. Test: `messages/en.json` keys under `app.*` contain no such substring (unit test).

### 1.4 Permissions matrix

Legend: **C** create · **R** read · **U** update · **D** soft-delete · **–** none · footnotes narrow the scope. "Client" = `client_owner` and `client_member` (identical in v1; `client_member` is reserved and never created by the seed or the invite UI).

| Entity / action | Admin | Agent | Client |
|---|---|---|---|
| organizations | CRUD | R | – (never surfaced) |
| users, memberships (invite, deactivate, reset password) | CRUD | R | R self · U own name/password |
| requests | CRUD (any org) | CRU (any org; create = `agent_on_behalf`) | CRU own org¹ · cancel own line² |
| request_lines — client fields (name, qty, links, note, customisation) | CRU | CRU | CRU own until `spec_frozen`¹; after that change request only |
| request_lines — internal fields (spec, cost_model, target, assignment, selected/backup participation, state) | CRU | CRU | – |
| products | CRUD · publish to catalog · set reference price | CRU (no publish) | R catalog + own-line products (client projection only) |
| product_specs | CRU | CRU | R frozen versions of own lines (fields only) |
| product_images | CRUD | CRU | R `clean` only |
| suppliers, supplier_contacts, price lists, catalogues, performance | CRUD | CRU | **never** |
| supplier_participations | CRUD | CRU | **never** |
| quotes, quote_price_breaks | CRUD | CRU | **never** |
| rfqs | CRU | CRU | – |
| offers, offer_options | CRUD · send | CRU · send | R own (sent+) · accept / ask changes / decline |
| samples | CRUD | CRU | R own · approve / reject · upload photos |
| factory_ranges, items | CRUD · **publish** | CRU (no publish) | R published ranges on own lines/orders (label + items only) |
| orders | CRUD · state transitions | CRU · state transitions | R own · confirm delivery |
| order_lines | CRU | CRU | R own (client projection) |
| purchase_orders | CRUD | CRU | **never** |
| payments | CRU · mark paid | CRU · mark paid | R own (due/paid) |
| artworks | CRU · approve / request changes | CRU · approve / request changes | C/U own (upload, revise) · R status |
| inspections | CRUD | CRU | R own: result, date, report if `visible_to_client` |
| shipments | CRU | CRU | R own (client projection) |
| documents | CRUD · publish | CRU · publish | R own `visibility=client` · C `reference_image`, `artwork`, `sample_photo` (on reject) |
| comments — client-visible / question | CRU | CRU | C question on own entity · R own `visibility=client` |
| comments — internal note, WhatsApp log | CRUD | CRU | **never** |
| activity_events | R all | R all | R own `visibility=client` |
| notification_outbox | R · run worker · retry | R | – |
| pricing_rules, fx_rates | CRU | R | **never** |
| api_keys | CRUD | – | – |

¹ "own org" = `org_id` equals the user's membership org. Every client repository method takes `orgId` from the session and adds `WHERE org_id = $orgId`; there is no client repository method without it.
² Client cancellation allowed while the line's state is before `order_confirmed` (Section 3.4).

Agents see **all** client orgs in v1 (per-agent client scoping is v1.1).

---

## 2. Route map

All pages are server components with server actions for mutations; TanStack Query fetches only from the JSON routes listed in 2.4. Every `/app` page and every `/api/app` route is a crawl target (Section 5.4).

### 2.1 Auth routes

| URL | Purpose | Primary data | Primary action |
|---|---|---|---|
| `/` | Entry | session | Redirect: no session → `/login`; client → `/app`; agent/admin → `/ops` |
| `/login` | Email + password sign-in | — | Sign in → role redirect (`?next=` honoured only for same-door paths) |
| `/forgot-password` | Request reset | — | Writes `auth_password_reset` outbox row (always shows success, even for unknown email) |
| `/reset-password/[token]` | Set new password | token (24 h validity) | Set password, sign in |
| `/invite/[token]` | First login from invite | invite token (7 d validity), user email pre-filled | Set name + password → sign in → door |
| `/logout` (POST) | Sign out | — | Clears session → `/login` |

### 2.2 Client portal `/app`

| URL | Page | Purpose | Primary data | Primary action | Spec |
|---|---|---|---|---|---|
| `/app` | Dashboard | "Waiting on you" + active lines by milestone | lines of org with `waiting_on=client`; active lines grouped by milestone; last 5 updates | Open the action card → the ▲ action page; "New request" | F-03 |
| `/app/requests/new` | New request | Paste links / add photos, qty per line, note; xlsx import | — | Send request (creates `requests` + lines, state `submitted`) | F-04 |
| `/app/requests` | Requests & orders | List with tabs Active · Waiting on you · Delivered · Drafts | lines + orders of org | Open line / order | F-05 |
| `/app/requests/[reqRef]` | Request page | Header + lines with milestone chips; request-level Updates/Documents/History/Ask | one request, its lines | Open a line; edit (draft/submitted only); Ask | F-06 |
| `/app/lines/[lineRef]` | Line page | The single page for a line: stepper, facts, actions, offer summary, sample, Updates, Documents, History, previous orders, Ask | one line + its offer/sample/order links | The ▲ action for the current milestone | F-07 |
| `/app/offers/[offerRef]` | Offer page | Options A/B/C, ladder, MOQ, lead, deviations, sample cost, validity | one offer (client DTO) | Accept option · Ask for changes · Decline | F-08 |
| `/app/samples/[sampleRef]` | Sample page | Status, tracking, photos | one sample (client DTO) | Approve · Reject (with photos + reason) | F-09 |
| `/app/orders/[orderRef]` | Order page | Execution stepper, facts, money, artwork, QC, shipping, documents, Updates, History, Ask, Reorder | one order + lines, payments, artwork, inspection projection, shipment projection, documents | View invoice · Upload artwork · View QC report · Confirm delivery · Reorder | F-10 |
| `/app/orders/[orderRef]/range` | More from this factory | Published factory range for this order's supplier | range label + items | Select items → new request pre-linked | F-25 |
| `/app/catalog` | Catalog | Published products with reference price | products `visibility=catalog` | Request offer | F-11 |
| `/app/catalog/[prdRef]` | Catalog product | Product detail, reference price attributes, previous orders of this product (own) | one product (client projection) | Request offer (pre-filled request) | F-11 |
| `/app/settings` | Profile | Name, password, notification email | own user | Save | F-01 |

Every `/app` page renders a persistent left nav: Dashboard · Requests & orders · Catalog · (bottom) Settings · Sign out. Brand: "Influensia" wordmark (BRAND_INPUT palette). No "organisation" anywhere.

### 2.3 Ops workspace `/ops`

| URL | Page | Purpose | Primary data | Primary action | Spec |
|---|---|---|---|---|---|
| `/ops` | Ops dashboard | Stale · Waiting on us · Waiting on client · Unassigned; digest of today's client actions | derived lists across all orgs | Claim, open | F-13 |
| `/ops/queue` | Request queue | All submitted lines not yet `spec_frozen`, filter by assignee/client | lines in `submitted`/`in_review` | Claim / Assign | F-14 |
| `/ops/requests` | Requests | All requests, filters (client, state, agent, stale) | requests + line roll-up | Open; New request on behalf | F-14 |
| `/ops/requests/new` | New request (on behalf) | Same intake as client + org picker + source | — | Create (source `agent_on_behalf`) | F-04 |
| `/ops/requests/[reqRef]` | Request (ops) | Header, client, lines table with state/waiting/stale/agent; Confirm order from accepted lines | request, lines | Open line; Confirm order | F-15, F-22 |
| `/ops/lines/[lineRef]?tab=spec` | Line — Spec & freeze | Client input, spec fields, images, freeze | line, spec versions | Freeze spec vN | F-15 |
| `/ops/lines/[lineRef]?tab=cost` | Line — Cost & target price | Cost model, uplift, target | line.cost_model, pricing_rules | Save · Confirm target | F-16 |
| `/ops/lines/[lineRef]?tab=sourcing` | Line — Sourcing board | Participations, quotes, compare | participations, quotes, suppliers | Add supplier · Log quote · Set status · Shortlist · Select | F-17 |
| `/ops/lines/[lineRef]?tab=offer` | Line — Offer builder | Build/send offers, see decisions | offers, options, selected quotes | Send offer · Confirm order | F-18 |
| `/ops/lines/[lineRef]?tab=timeline` | Line — Timeline | Activity, comments, WhatsApp log, questions | activity_events, comments | Post update · Internal note · Log WhatsApp · Answer question · Set exception | F-19 |
| `/ops/lines/[lineRef]/samples` | Line — Samples | Sample records | samples | New sample · Mark shipped/received | F-20 |
| `/ops/lines/[lineRef]/preview` | Client preview | Renders the client line page **through the client DTO** with a "Viewing as client" banner | client DTO | — | F-07 |
| `/ops/suppliers` | Suppliers | Table: ref, name, CN name, verdict, grade, city, channels, participations count, last contact | suppliers | New supplier; open | F-21 |
| `/ops/suppliers/new` | New supplier | Form | — | Create | F-21 |
| `/ops/suppliers/[supRef]` | Supplier page | Profile, contacts, verdict/grade, price lists, catalogues, participations across lines, performance, disclosed_to | supplier + children | Edit · Add contact · Upload price list | F-21 |
| `/ops/orders` | Orders | All orders, filters (client, state, stale) | orders | Open | F-22 |
| `/ops/orders/[orderRef]` | Order (ops) | Tabs: Overview · Payments · Artwork · Purchase orders · Inspection · Shipment · Documents · Timeline | order + children | State transitions per tab | F-22, F-23 |
| `/ops/orders/[orderRef]/preview` | Client preview | Client order page via client DTO | client DTO | — | F-10 |
| `/ops/products` | Products | All products, visibility, reference price, lines/orders count | products | New · Open | F-24 |
| `/ops/products/[prdRef]` | Product page | Specs (versions), images (kinds), reference price, visibility, lines, orders by client (ops-only history) | product + children | Publish to catalog · Set reference price · Approve clean image | F-24 |
| `/ops/factory-ranges` | Factory ranges | List: label, supplier (ops), client org, items, published | ranges | New | F-25 |
| `/ops/factory-ranges/new` | New range | Pick supplier + client org, upload sanitised PDF, enter items | — | Save draft | F-25 |
| `/ops/factory-ranges/[frRef]` | Range page | Items, PDF, leak-check result, publish | range | Publish (admin) | F-25 |
| `/ops/clients` | Clients | Client orgs: name, country, mode, display, users, active lines, orders | organizations `type=client` | New client · Invite user | F-26 |
| `/ops/clients/[orgId]` | Client page | Settings (commercial_mode, pricing_display, deposit_pct, incoterm), users, requests, orders, previous products | org + children | Edit · Invite user · Resend invite · Deactivate | F-26 |
| `/ops/outbox` | Notifications outbox | Outbox rows with status, template, recipient, payload, rendered preview | notification_outbox | Run worker now · Retry failed · Trigger daily digest | F-27 |
| `/ops/settings/pricing-rules` | Pricing rules (admin) | Margin/fee/uplift by category | pricing_rules | Edit | F-16 |

Ops nav: Dashboard · Queue · Requests · Orders · Suppliers · Products · Factory ranges · Clients · Outbox · (admin) Pricing rules. Global search box (ref or name → request/line/order/supplier/product).

### 2.4 JSON routes

Client (must contain **only** client DTOs; all are crawl targets):

| Route | Returns |
|---|---|
| `GET /api/app/dashboard` | `ClientDashboardDto` |
| `GET /api/app/lines/[lineRef]` | `ClientLineDto` |
| `GET /api/app/lines/[lineRef]/timeline` | `ClientTimelineDto` (client-visible events + comments) |
| `GET /api/app/offers/[offerRef]` | `ClientOfferDto` |
| `GET /api/app/samples/[sampleRef]` | `ClientSampleDto` |
| `GET /api/app/orders/[orderRef]` | `ClientOrderDto` |
| `GET /api/app/orders/[orderRef]/range` | `ClientFactoryRangeDto` |
| `GET /api/app/catalog` | `ClientCatalogDto[]` |
| `GET /api/app/catalog/[prdRef]` | `ClientCatalogProductDto` |
| `GET /api/app/documents/[docId]/download` | File stream — only if `visibility=client` and org matches, else 404 |
| `POST /api/app/uploads` | Multipart upload for `reference_image` / `artwork` / `sample_photo` (client kinds only) |

Ops: `GET /api/ops/search?q=`, `GET /api/ops/documents/[docId]/download`, `POST /api/ops/uploads`, `POST /api/ops/worker/run` (admin). Everything else is a server action.

---

## 3. State machine and enums

Engineers copy these names verbatim into the Drizzle `pgEnum`s and into `messages/en.json` label keys. All enum values are `snake_case` strings unless noted (grades are single upper-case letters).

### 3.1 Where state lives

* `request_lines.state` holds the state for the whole life of a line. Before an order exists it is moved by line actions. After `orders` row exists that includes the line, **`orders.state` is authoritative** and every transition on the order is mirrored to all its `order_lines → request_lines` (same value, same `last_state_change_at`).
* `milestone` is stored on both tables for indexing but is **always** written by `milestoneFor(state)` (B.1) inside the same transaction as the state. There is no code path that writes `milestone` alone.
* `exception` (nullable) sits beside `state` on both tables. It never changes `milestone`.
* Every transition writes an `activity_events` row `type=state_changed` with `payload={from, to, reason?}` and updates `last_state_change_at`.

### 3.2 `line_state` — the 24 internal states

| # | `line_state` | Label (ops) | Lane | Milestone | Owner (who owes the next move) | Client can | Client sees, in addition to the milestone |
|---|---|---|---|---|---|---|---|
| 1 | `draft` | Draft | sourcing | `received` | client | Edit everything, delete the line, submit | — |
| 2 | `submitted` | Submitted | sourcing | `received` | agency (unassigned = waiting on us) | Edit everything (name, qty, links, note, images) | "Received — we are assigning it" |
| 3 | `in_review` | In review | sourcing | `received` | agency | Edit everything; answer questions | Agent name |
| 4 | `spec_frozen` | Spec frozen | sourcing | `finding_factory` | agency | Change request only | Frozen spec summary (fields) |
| 5 | `cost_target_price` | Cost model + target price | sourcing | `finding_factory` | agency | Change request only | nothing new (target price is internal) |
| 6 | `rfq_out` | RFQ out | sourcing | `finding_factory` | agency | Change request only | "N factories contacted" |
| 7 | `quotes_in` | Quotes in | sourcing | `finding_factory` | agency | Change request only | "N contacted · M quoted" |
| 8 | `shortlisted` | Shortlist | sourcing | `finding_factory` | agency | Change request only | same |
| 9 | `negotiating` | Negotiating | sourcing | `finding_factory` | agency | Change request only | same |
| 10 | `offer_ready` | Offer ready (FOB confirmed) | sourcing | `price_ready` ▲ | client while `offer.status=sent`; agency otherwise | Accept / ask changes / decline; browse factory range | The offer |
| 11 | `sampling` | Sample | sourcing | `sample` ▲ | agency until `sample.status=received`; then client | Approve / reject with photos | Sample status, tracking, photos |
| 12 | `offer_accepted` | Offer accepted | sourcing | `order_confirmed` | agency | Cancel (still free) | "Preparing your order confirmation" |
| 13 | `order_confirmed` | Order confirmed | execution | `order_confirmed` ▲ | agency (issue PI) → client | View invoice | PI/invoice document, amounts due, locked qty & price |
| 14 | `awaiting_deposit` | Deposit + fee due | execution | `order_confirmed` ▲ | client | View invoice, (wire) | Amounts due |
| 15 | `awaiting_artwork` | Packaging templates | execution | `order_confirmed` ▲ | client until artwork `submitted`; agency while reviewing | Upload / revise artwork | Artwork status, dieline document |
| 16 | `in_production` | In production | execution | `in_production` | agency | — | Ex-works ETA, production photos if published |
| 17 | `qc_inspection` | QC inspection | execution | `quality_check` ▲ | agency | View QC report when published | Inspection date, result when set |
| 18 | `awaiting_balance` | Balance due | execution | `quality_check` ▲ | client | View balance invoice | Amount due |
| 19 | `forwarder_booked` | Forwarder connected | execution | `shipping` | agency | — | Cargo-ready date, ETD |
| 20 | `shipped_exworks` | Shipped ex-works | execution | `shipping` | agency | — | ETD |
| 21 | `departed_origin` | Departed origin | execution | `shipping` | agency | — | Mode, ETA port, tracking, B/L + packing list when published |
| 22 | `eu_port_customs` | EU port / customs | execution | `shipping` | agency | — | Customs status, ETA |
| 23 | `delivered` | Delivered | execution | `delivered` ▲ | client | Confirm delivery, reorder | Delivered date |
| 24 | `completed` | Completed | execution | `delivered` | none | Reorder | — |

Lane order is the only legal forward direction; skips are allowed where 3.4 says so.

### 3.3 `milestone` — the 9 client milestones (D-05)

| # | `milestone` | Client label | ▲ action (D-06) | Dashboard card title | Order-page button |
|---|---|---|---|---|---|
| 1 | `received` | Received | — | — | — |
| 2 | `finding_factory` | Finding factory | — | — | — |
| 3 | `price_ready` | Price ready | Accept price | "Price ready for {line name}" | Accept price |
| 4 | `sample` | Sample | Approve sample | "Sample received — approve or reject" | Approve sample |
| 5 | `order_confirmed` | Order confirmed | View invoice / upload artwork | "Invoice ready — deposit due {date}" / "Upload artwork for {line}" | View invoice · Upload artwork |
| 6 | `in_production` | In production | — | — | — |
| 7 | `quality_check` | Quality check | View QC report (+ pay balance) | "QC passed — balance {amount} due {date}" | View QC report |
| 8 | `shipping` | Shipping | — | — | — |
| 9 | `delivered` | Delivered | Confirm delivery | "Confirm you received {order}" | Confirm delivery |

Stepper rendering: 9 steps; steps before the current milestone are "done"; the current step shows the state's client sub-label (3.2 last column) and the exception badge if any; `sample` is rendered as "skipped" (grey, strikethrough) when an order was confirmed without a sample.

### 3.4 Transitions

Columns: **Trigger** = the UI action or job; **Actor**; **Pre** = preconditions (all must hold); **Effects** = beyond the standard `state_changed` event.

| From → To | Trigger | Actor | Pre | Effects |
|---|---|---|---|---|
| `draft` → `submitted` | Client "Send request" (also creates directly as `submitted` when not saved as draft) | client, agent (on behalf) | ≥1 line with name-or-link and qty ≥ 1 | `requests.status=submitted`, `submitted_at`; outbox `client_request_received` (client) + `ops_new_request` (all agents) |
| `submitted` → `in_review` | "Claim" / "Assign" | agent, admin | `assigned_agent_id` set in same action | milestone unchanged; outbox `client_milestone_changed` is **not** sent (same milestone) |
| `submitted` → `spec_frozen` | "Freeze spec" on an unassigned line (auto-claims to the acting agent first, one action) | agent | as below | as below, plus `line_assigned` |
| `in_review` → `spec_frozen` | "Freeze spec" | agent | spec completeness gate (F-15) passes; product exists (created on freeze if null) | `product_specs` row `version=n, frozen_at`; `request_lines.spec_version=n`; client edit locked; outbox `client_milestone_changed` |
| `spec_frozen` → `cost_target_price` | "Save cost model" (first save) | agent | cost_model has `est_prod_cost_minor > 0` | `target_price_minor` computed |
| `cost_target_price` → `rfq_out` | "Mark RFQ sent" (or "Generate RFQ" stub) | agent | `target_confirmed_by` set; ≥1 participation exists **or** `recipients_count ≥ 1` entered | `rfqs` row; all participations without status get `contacted`; `first_contact_at` |
| `spec_frozen` → `rfq_out` | "Mark RFQ sent" without a cost model | agent | ≥1 participation | Allowed shortcut; cost tab shows warning "no target price" |
| `rfq_out` → `quotes_in` | **System**: first quote logged on any participation of the line | system | — | participation → `quoted` |
| `quotes_in` → `shortlisted` | "Shortlist" on ≥1 participation | agent | shortlisted participations have `reason` | — |
| `shortlisted` → `negotiating` | Participation status set to `negotiating` | agent | — | — |
| `quotes_in` → `negotiating` | same, skipping shortlist | agent | — | allowed |
| `negotiating` / `quotes_in` / `shortlisted` → `offer_ready` | **System**: "Send offer" | agent | offer passes leak check; ≥1 option; each option has a `participation_id` with a quote; `selected_participation_id` set (= option A's participation unless chosen) | `offers.status=sent`, `sent_at`, `valid_until`; outbox `client_offer_ready`; `waiting_on=client` |
| `offer_ready` → `offer_ready` (no state change) | Client "Ask for changes" | client | offer `sent` | `offers.status=changes_requested`, `exception=change_requested`, comment (client) with the text; outbox `ops_client_action` |
| `offer_ready` → `negotiating` \| `rfq_out` \| `shortlisted` | "Reopen sourcing" | agent | offer not `accepted` | offer stays `changes_requested`/`declined`; exception cleared |
| `offer_ready` → `offer_ready` | "Send offer" v(n+1) | agent | previous offer `changes_requested`, `declined` or `expired` | previous offer unchanged; new version `sent`; exception cleared |
| `offer_ready` → `sampling` | Client "Accept" with `sample_required=true` on the option, **or** agent "Order sample" | client / agent | offer `sent` | `offers.status=accepted`, `accepted_option_id`, `decided_at`; `samples` row `status=ordered` (agent completes cost/courier later); outbox `ops_client_action` |
| `offer_ready` → `offer_accepted` | Client "Accept" with `sample_required=false` | client | offer `sent` | `offers.status=accepted`, `accepted_option_id`, `decided_at`; outbox `ops_client_action` + `client_milestone_changed` |
| `sampling` → `offer_accepted` | Agent "Skip sample" | agent | no sample in `received`/`approved`; reason ≥ 5 chars | sample rows (if any) stay as they are; outbox `client_milestone_changed` |
| `offer_accepted` → `sampling` | Agent "Order sample" (client asked for one after accepting) | agent | — | `samples` row `ordered`; outbox `client_milestone_changed` |
| `offer_ready` → `offer_ready` | Client "Decline" | client | offer `sent` | `offers.status=declined`, reason comment; exception `change_requested` **not** set; `waiting_on=agency`; outbox `ops_client_action` |
| `sampling` → `sampling` | Sample marked `shipped` / `received` | agent | tracking for shipped | outbox `client_sample_shipped` (shipped); `client_sample_ready` (received) |
| `sampling` → `offer_accepted` | Client "Approve sample" | client | sample `received` | `samples.status=approved`, `approved_by/at`; outbox `ops_client_action`, `client_milestone_changed` |
| `sampling` → `sampling` | Client "Reject sample" | client | sample `received`; reason ≥ 10 chars | `samples.status=rejected`; `exception=sample_rejected`; outbox `ops_client_action` |
| `sampling` (rejected) → `sampling` | "New sample" | agent | — | new samples row `-2`; exception cleared |
| `sampling` (rejected) → `negotiating` \| `shortlisted` | "Re-source" | agent | — | exception cleared; offer stays `accepted` but is superseded — agent must send a new offer before order confirm |
| `offer_accepted` → `order_confirmed` | "Confirm order" (F-22) | agent | all bundled lines `offer_accepted`; PI number entered or auto (`PI-{order_ref}`) | `orders` row `state=order_confirmed`, `confirmed_at`; `order_lines`; `payments` deposit/fee/balance created (`pending`); `purchase_orders` per distinct supplier (`draft`); `products.visibility` untouched; outbox `client_order_confirmed` |
| `order_confirmed` → `awaiting_deposit` | **System**: PI document published (kind `pi`, visibility `client`) | system | leak check passed | outbox `client_payment_due` (deposit + fee) |
| `awaiting_deposit` → `awaiting_artwork` | **System**: deposit **and** fee payments marked `paid` | system | at least one order line has `artwork_required=true` | same milestone, so no milestone email; outbox `client_artwork_requested` |
| `awaiting_artwork` → `awaiting_artwork` | Client uploads artwork | client | file is PDF/AI/PNG/JPG ≤ 25 MB | `artworks.status=submitted`; `waiting_on=agency`; outbox `ops_client_action` |
| `awaiting_artwork` → `awaiting_artwork` | Agent "Request changes" | agent | note ≥ 5 chars | `artworks.status=changes_requested`; outbox `client_artwork_changes` |
| `awaiting_artwork` → `in_production` | Agent "Approve artwork" (last unapproved line) **and** "Start production" with ex-works ETA | agent | every order line has `artworks.status=approved` **or** `artwork_required=false`; `purchase_orders.exworks_eta` set on every PO; `po.status` → `in_production` | outbox `client_milestone_changed` (with ETA) |
| `awaiting_deposit` → `in_production` | "Start production" | agent | payments paid; every line `artwork_required=false` | skip artwork state |
| `in_production` → `in_production` | Edit `exworks_eta` | agent | — | `activity eta_changed`; outbox `client_eta_changed` |
| `in_production` → `qc_inspection` | "Schedule inspection" | agent | `inspections.scheduled_for` set | outbox `client_milestone_changed` |
| `qc_inspection` → `awaiting_balance` | **System**: inspection `result=pass` recorded | agent (records) → system | report document uploaded (may remain internal) | `payments` balance `due_on = today + 3 working days` (editable); outbox `client_qc_result` (pass) + `client_payment_due` (balance) |
| `qc_inspection` → `in_production` | **System**: inspection `result ∈ {fail, rework}` | system | — | `exception=qc_failed`; PO `status=in_production`; outbox `client_qc_result` (fail — wording "rework in progress, no action needed") |
| `in_production` (qc_failed) → `qc_inspection` | "Schedule re-inspection" | agent | — | exception cleared |
| `awaiting_balance` → `forwarder_booked` | Agent "Record forwarder" (forwarder + booking_ref + cargo_ready) | agent | balance payment `paid` **or** admin override checkbox "ship before balance" with reason | `shipments` row; `suppliers.disclosed_to_org_ids += org` **if** `shipment.forwarder_party=client`; outbox `client_milestone_changed` |
| `forwarder_booked` → `shipped_exworks` | "Mark shipped ex-works" | agent | `shipments.exworks_shipped_at` | — |
| `shipped_exworks` → `departed_origin` | "Mark departed" (mode, container/AWB, ETD, ETA port) | agent | `etd`, `eta_port`, `mode` | outbox `client_eta_changed` if ETA differs from previous |
| `departed_origin` → `eu_port_customs` | "Arrived at port" | agent | `arrived_port_at` | `customs_status=in_progress` |
| `eu_port_customs` → `delivered` | "Mark delivered" | agent | `delivered_at` | outbox `client_delivery_confirm` |
| `departed_origin` → `delivered` | "Mark delivered" (air, courier) | agent | `delivered_at` | allowed skip |
| `delivered` → `completed` | Client "Confirm delivery" **or** agent "Close" | client / agent | — | `supplier_performance` update (orders_count+1, on_time = delivered_at ≤ eta_port, last_order_at); outbox `client_milestone_changed`; Reorder button already shown from `delivered` |

**Forbidden**: any transition not in this table returns error `E_ILLEGAL_TRANSITION {from,to}`; the UI never shows the button. Admin has an "Override state" menu (with mandatory reason, writes `state_overridden` event) — the only path that bypasses the table; it still runs `milestoneFor`.

### 3.5 Exceptions (`line_exception`, nullable on `request_lines` and `orders`)

| `line_exception` | Set by | Cleared by | Effect on `waiting_on` | Client sees |
|---|---|---|---|---|
| `needs_input` | agent "Ask the client" (posts client-visible question) | agent "Resolve" after answer (or automatically when client replies via Ask) | client | Badge "We need your input" + the question on the dashboard card |
| `change_requested` | client "Ask for changes" on offer, or client "Request a change" on a frozen line | agent "Resolve change request" (choose: keep state / reopen to `negotiating` / reopen to `rfq_out` / re-freeze spec) | agency | Badge "Change requested — we're on it" |
| `sample_rejected` | system on sample reject | agent "New sample" / "Re-source" | agency | Badge "Sample rejected — new sample coming" |
| `quote_expired` | worker when `offers.valid_until < now` and status `sent` (offer → `expired`) | agent sends new offer version | agency | Badge "Price expired — new price coming" |
| `qc_failed` | system on inspection fail/rework | agent schedules re-inspection | agency | Badge "Rework in progress" |
| `on_hold` | agent/admin with reason | agent/admin "Resume" | none (stale timer paused) | Badge "On hold" + reason (client-visible text field, leak-checked) |
| `cancelled` | client (before `order_confirmed`) or agent/admin (any time, reason) | never (terminal) | none | Badge "Cancelled"; line moves to Delivered tab under "Closed" |

`cancelled` lines/orders keep their `state` and `milestone` for history. A cancelled line is excluded from every dashboard count.

### 3.6 Other enums

| Enum | Values | Notes |
|---|---|---|
| `org_type` | `agency` · `client` · `partner` | |
| `role` | `admin` · `agent` · `client_owner` · `client_member` | v1 UI creates only the first three |
| `commercial_mode` | `principal` · `agency_passthrough` · `agency_direct` | D-10 |
| `pricing_display` | `all_in` · `factory_plus_fee` | D-11 |
| `request_source` | `portal` · `import` · `agent_on_behalf` | D-04 |
| `request_status` | `draft` · `submitted` · `active` · `closed` | header roll-up: `active` once any line ≥ `in_review`; `closed` when all lines `completed` or `cancelled` |
| `line_state` | see 3.2 | 24 values |
| `milestone` | see 3.3 | 9 values |
| `line_exception` | see 3.5 | 7 values |
| `participation_status` | `contacted` · `quoted` · `shortlisted` · `negotiating` · `selected` · `backup` · `dropped` · `cannot_make` | Exactly one `selected` per line at a time; at most one `backup` |
| `offer_status` | `draft` · `sent` · `accepted` · `changes_requested` · `declined` · `expired` | |
| `sample_status` | `ordered` · `shipped` · `received` · `approved` · `rejected` | stored as `samples.status`; blueprint's `verdict` = `approved\|rejected` derived |
| `sample_paid_by` | `client` · `agency` · `factory` | |
| `payment_kind` | `deposit` · `fee` · `balance` · `sample` | D-12 |
| `payment_status` | `pending` · `paid` · `waived` | `paid_at`, `reference`, `recorded_by` filled on `paid` |
| `payee` | `agency` · `factory` | `agency_passthrough` ⇒ all payees `agency` |
| `artwork_status` | `submitted` · `changes_requested` · `approved` | blueprint says `changes`; use `changes_requested` for consistency with offers |
| `po_status` | `draft` · `issued` · `in_production` · `completed` · `cancelled` | |
| `inspection_result` | `pass` · `fail` · `rework` | nullable until inspected |
| `shipment_mode` | `sea` · `air` · `rail` | attribute, not state (D-05) |
| `forwarder_party` | `client` · `agency` · `supplier` | new; drives `disclosed_to_org_ids` |
| `customs_status` | `not_started` · `in_progress` · `cleared` · `held` | |
| `product_visibility` | `private` · `catalog` · `proposed` | `proposed` unused in v1 |
| `image_kind` | `client_reference` · `supplier_facing` · `clean` | only `clean` serialises to clients |
| `supplier_type_verdict` | `manufacturer` · `trading` · `hybrid` · `unknown` · `unchecked` | |
| `verdict_source` | `baidu` · `qcc` · `alibaba_profile` · `site_visit` · `sheet_import` · `other` | |
| `supplier_grade` | `A` · `B` · `C` · `D` · `E` | upper-case single letters |
| `contact_channel` | `alibaba` · `1688` · `wechat` · `email` · `global_sources` · `web` · `whatsapp` · `phone` | TS identifier for `1688` is `p1688`; the stored string is `1688` |
| `document_kind` | `pi` · `invoice` · `qc_report` · `bill_of_lading` · `packing_list` · `certificate` · `artwork` · `dieline` · `reference_image` · `production_photo` · `sample_photo` · `price_list` · `catalogue` · `factory_range_pdf` · `comparison` · `rfq` · `quote_file` · `other` | D-22 list + working kinds |
| `document_visibility` | `client` · `internal` | |
| `comment_visibility` | `client` · `internal` | |
| `comment_source` | `app` · `whatsapp_log` · `email` | D-08 |
| `comment_kind` | `update` · `question` · `answer` · `note` · `change_request` · `decline_reason` · `reject_reason` | new; `update`/`question`/`answer`/`change_request`/`decline_reason`/`reject_reason` may be client-visible; `note` never |
| `activity_visibility` | `client` · `internal` | |
| `activity_type` | `request_submitted` · `line_created` · `line_updated` · `line_assigned` · `state_changed` · `exception_set` · `exception_cleared` · `spec_frozen` · `cost_model_saved` · `target_confirmed` · `rfq_sent` · `participation_added` · `participation_status_changed` · `quote_logged` · `offer_sent` · `offer_decided` · `sample_created` · `sample_status_changed` · `sample_decided` · `order_confirmed` · `payment_recorded` · `artwork_submitted` · `artwork_decided` · `po_updated` · `inspection_recorded` · `shipment_updated` · `eta_changed` · `document_uploaded` · `document_published` · `document_unpublished` · `leak_check_blocked` · `comment_posted` · `whatsapp_logged` · `product_published` · `range_published` · `user_invited` · `state_overridden` · `delivery_confirmed` · `reorder_created` | Every mutation writes ≥1 |
| `outbox_status` | `pending` · `sent` · `failed` | |
| `notification_channel` | `email` | v1 only |

---

## 4. Feature specs

Each feature: user story · UI regions (wireframe references are to blueprint §08) · fields & validation · behaviours · side effects (activity event / outbox row / milestone) · empty state · acceptance criteria `AC-<feature>-<n>` written Given/When/Then for a browser against the seed of Section 7. "Seed user" passwords are all `Password123!`.

Common validation rules (apply everywhere unless overridden): trim strings; required strings min length 1; money inputs accept `1234.56` or `1,234.56` and store minor units; quantities are positive integers; dates are `YYYY-MM-DD` in the user's timezone; files: images `png|jpg|jpeg|webp` ≤ 15 MB, documents `pdf|xlsx|xls|csv|docx|ai|zip` ≤ 25 MB; every server action re-validates with zod and returns `{ok:false, errors:{field:message}}` rendered inline under the field.

### F-01 Authentication, invites, sessions

**User story.** As an invited user I set my password once and afterwards sign in with email + password; as an admin I create accounts, nobody self-registers (D-02).

**UI regions.** Centered card, brand wordmark, form, one primary button, secondary link ("Forgot password?" / "Back to sign in"). No marketing copy.

**Fields.**

| Screen | Field | Validation |
|---|---|---|
| `/login` | email | required, email format |
| | password | required |
| `/invite/[token]` | name | required, 2–80 chars |
| | password | ≥ 10 chars, ≥ 1 letter, ≥ 1 digit |
| | confirm | equals password |
| `/forgot-password` | email | required |
| `/reset-password/[token]` | password, confirm | as above |
| `/app/settings` | name, current password, new password | change password requires current |

**Behaviours.**
* Wrong credentials → generic "Email or password is incorrect" (no user enumeration). 5 failed attempts per email per 15 min → "Too many attempts, try again in N minutes" (in-memory counter is acceptable locally).
* Session 30 days sliding. Sign out clears it.
* Invite token: single-use, 7 days. Expired → page shows "This invitation has expired — ask your contact to resend it." Resend from `/ops/clients/[orgId]` regenerates the token and writes a new outbox row.
* Deactivated user (`users.deactivated_at`) cannot sign in; existing sessions are revoked on deactivation.
* Role → door redirect after login. `?next=` only honoured if it starts with the user's door.

**Side effects.** `user_invited` activity (org scope), outbox `auth_invite` on invite/resend, `auth_password_reset` on forgot. Login/logout write no activity events.

**Empty state.** n/a.

**Acceptance criteria.**
* AC-AUTH-01 Given the seed, When I sign in as `piotr@example.pl` / `Password123!`, Then I land on `/app` and the nav shows Dashboard, Requests & orders, Catalog.
* AC-AUTH-02 Given the seed, When I sign in as `bogdan@influensia.ro`, Then I land on `/ops`.
* AC-AUTH-03 Given I am signed in as Piotr, When I open `/ops`, Then I receive HTTP 404.
* AC-AUTH-04 Given I am signed in as Bogdan, When I open `/app`, Then I am redirected to `/ops`.
* AC-AUTH-05 Given no session, When I open `/app/orders/ORD-2026-0312`, Then I am redirected to `/login?next=/app/orders/ORD-2026-0312` and after signing in as Piotr I land on that order.
* AC-AUTH-06 Given `/forgot-password`, When I submit `nobody@example.com`, Then the page shows the same success message as for a real address and no outbox row is created.
* AC-AUTH-07 Given Marko invites `newbuyer@example.pl` (F-26), When the worker runs, Then `./var/outbox.log` contains a line with `template":"auth_invite"` and a `/invite/<token>` URL, and opening that URL lets me set a password and lands me on `/app` with an empty dashboard.
* AC-AUTH-08 Given an invite token was used once, When I open it again, Then I see the expired/used message.
* AC-AUTH-09 Given 5 wrong passwords for `piotr@example.pl`, When I try a 6th, Then I see the rate-limit message even with the correct password.

### F-02 App shell, navigation, role routing

**User story.** As any user I always know where I am and can reach every section in one click.

**UI regions.** Left nav (collapsible on < 1024 px to a top bar with a menu button), header with page title + breadcrumb (`Requests & orders / REQ-2026-0312 / Line 01`), user menu (name, role badge for ops only, Settings, Sign out). Ops shell adds global search and a "Viewing as client" banner on preview routes. Theme follows BRAND_INPUT (off-white `#FAFAF7` page, ink `#171717`, sage `#97CF8D` accents, deep green `#4F8A45` interactive, beige hairlines `#E0D9CA`; ops tables radius 6–8 px, client cards 12 px). Dark mode via `next-themes` is optional in v1; light must be complete.

**Behaviours.** Active nav item highlighted; page titles from `messages/en.json`; 404 page per door; error boundary shows "Something went wrong — reference `<sentry-free uuid>`" and logs the stack.

**Acceptance criteria.**
* AC-SHELL-01 Given Piotr on any `/app` page, When I read the page, Then the words "organisation", "organization", "supplier", "factory" (except in the literal label "Factory F-0042" and the milestone label "Finding factory") do not appear in the nav or header.
* AC-SHELL-02 Given a viewport of 390 px, When I open `/app`, Then no horizontal scroll and the nav is behind a menu button.
* AC-SHELL-03 Given Bogdan on `/ops/lines/REQ-2026-0312-01/preview`, Then a banner "Viewing as client — Piotr's team" is shown and no ops panels render.

### F-03 Client dashboard `/app`

**User story.** As a client I open the app and see what is waiting on me, then everything in flight.

**UI regions** (blueprint "Actions first"): (1) **Waiting on you** — cards, one per line/order with `waiting_on=client`, sorted by due date then age; (2) **Active** — lines grouped by milestone in milestone order (`received` … `shipping`), each row: line ref, name, qty, milestone chip, exception badge, ETA if any, "N contacted · M quoted" for `finding_factory`; (3) **Recent updates** — last 5 client-visible comments/events across the org; (4) top-right "New request" button. Delivered/completed lines are not on the dashboard (they are on the list page).

**Card content per action** (from B.2 `waiting_on` reasons):

| reason | Card title | Button → route |
|---|---|---|
| `offer_sent` | "Price ready — {line name}" + "valid until {date}" | Accept price → `/app/offers/[ref]` |
| `sample_received` | "Sample received — {line}" | Approve sample → `/app/samples/[ref]` |
| `deposit_due` | "Deposit {amount} + fee {amount} due {date}" | View invoice → `/app/orders/[ref]#payments` |
| `artwork_due` | "Upload artwork — {line}" / "Artwork changes requested" | Upload artwork → `/app/orders/[ref]#artwork` |
| `balance_due` | "QC passed — balance {amount} due {date}" | View QC report → `/app/orders/[ref]#qc` |
| `delivery_confirm` | "Confirm you received {order ref}" | Confirm delivery → `/app/orders/[ref]` |
| `needs_input` | "We need your input — {line}" + question excerpt | Answer → `/app/lines/[ref]#ask` |

**Behaviours.** Counts in section headers. Clicking a milestone group header filters the list page. Everything is org-scoped.

**Empty state.** Waiting on you: "Nothing waiting on you." Active: illustration-free text "No active requests yet" + "New request" button (blueprint first-login flow).

**Acceptance criteria.**
* AC-DASH-01 Given Piotr, When I open `/app`, Then "Waiting on you" shows exactly one card: "Sample received — Standard sleeves 66×91 mm, 80 µm" with an "Approve sample" button.
* AC-DASH-02 Given KOFF buyer, When I open `/app`, Then "Waiting on you" shows exactly two cards: "Price ready — Work gloves …" (Accept price) and "Confirm you received ORD-2026-0290" (Confirm delivery), and no card for the sheds.
* AC-DASH-03 Given Piotr, Then the Active section shows a group "In production" containing `REQ-2026-0312-01` with "ETA Gdańsk 18 Nov 2026", a group "Finding factory" with lines 03, 05, 11, 14, 20, 26 (each with its "N contacted · M quoted" text per AC-LINE-05 rules) and a group "Sample" with line 02.
* AC-DASH-04 Given Piotr, Then no text on the page matches `/ZZLEAKTEST|Yuantuo|Suti|Yili|依立|Dr\. Card|Boyuan|Fuli|Jinou/`.
* AC-DASH-05 Given `newbuyer@example.pl` after accepting the invite, When I open `/app`, Then both sections show their empty states and the "New request" button is visible.
* AC-DASH-06 Given KOFF buyer accepts the gloves offer (F-08), When I return to `/app`, Then the "Price ready" card is gone.

### F-04 New request `/app/requests/new` (and `/ops/requests/new`)

**User story.** As a client I paste links or drop photos, type a quantity per line and send — the same effort as a WhatsApp message (D-04).

**UI regions** (blueprint wireframe "New request"): (1) big textarea "Paste links, one per line — or drop photos" with drag-and-drop zone; (2) parsed lines table: thumbnail/favicon, source (domain or "photo"), editable name (prefilled from URL slug: hyphens → spaces, product-ish tokens; for photos the filename), **Quantity** (required), optional "Note for this line"; (3) "Anything we should know? (optional)" request note; (4) optional advanced fields per line behind "More": target delivery date, destination country (default org country), incoterm wanted (default org default), reorder interval (`none|monthly|quarterly|yearly`), 12-month volume; (5) "Import xlsx" secondary tab; (6) buttons "Save draft" and "Send request".

**Fields & validation.**

| Field | Rule |
|---|---|
| line source | at least one of: URL (http/https, ≤ 2048 chars) or ≥1 image | 
| line name | required at send (prefilled), 2–200 chars |
| qty_first | integer ≥ 1 |
| line note (customisation) | ≤ 2000 chars |
| request note | ≤ 4000 chars |
| images | ≤ 10 per line, image types, re-encoded on upload, stored as `documents kind=reference_image visibility=client` on the line (never sent to suppliers; agents upload separate `supplier_facing` product images) |
| max lines | 50 per request (xlsx may bring more → error "split into two requests") |

URL parsing: split textarea on newlines/whitespace; strip tracking params (`utm_*`, `srsltid`, `fbclid`, `ck`, `ckvia`); duplicates collapsed; `share.google`, `vm.tiktok.com`, `facebook.com/share`, bare `alibaba.com?from=share` links are accepted but flagged `not_durable=true` (shown as a small "link may expire" hint; agents see the flag).

**xlsx import (stub).** Accept `.xlsx`; read the first sheet with SheetJS; find header row containing at least `name` or `product`, plus optional `link|url`, `qty|quantity`, `note`; create lines from the rows. If no header matches → "We couldn't read this file. Paste the links instead, or send the file with a note and we'll do it." with a button that attaches the file to the request as `document kind=other, visibility=client` and creates a single line named after the file.

**Behaviours.**
* "Send request" creates `requests` (`source=portal` or `agent_on_behalf`, `status=submitted`, `submitted_at`) and lines in `state=submitted`, `milestone=received`, `client_links[]`, `is_repeat=false`.
* "Save draft" creates `requests.status=draft`, lines `draft`; visible only to the client under Drafts; editable/deletable; no notifications.
* Confirmation page shows the REQ reference and "We'll confirm the spec and come back with a price. You'll get an email at each step."
* Ops version adds: org picker (required), "Source" fixed to `agent_on_behalf`, optional "received via WhatsApp on {date}" note that becomes a `whatsapp_log` comment.

**Side effects.** `request_submitted` (client-visible), `line_created` per line (client-visible); outbox `client_request_received` to the creator (not for agent-on-behalf unless checkbox "notify client"), `ops_new_request` to all agents and admins.

**Empty state.** Textarea placeholder text as in the wireframe: "Allegro, eMAG, Alibaba, TikTok, a photo from your phone".

**Acceptance criteria.**
* AC-NEW-01 Given Piotr on `/app/requests/new`, When I paste three Allegro URLs (one with `?srsltid=…`), Then three rows appear with names derived from the slugs and the tracking param is not stored (check `/app/requests/[ref]` shows the clean URL).
* AC-NEW-02 Given rows without quantities, When I click Send, Then each empty quantity shows "Enter a quantity" and nothing is created.
* AC-NEW-03 Given two valid rows, When I click Send, Then I see a confirmation with a ref `REQ-2026-0326` (next after the seed), `/ops/queue` lists two new lines as Unassigned for Bogdan, and the outbox has one `client_request_received` (to piotr@example.pl) and three `ops_new_request` rows (marko, bogdan, cristina).
* AC-NEW-04 Given I drop a JPG with EXIF GPS data, When the request is sent, Then the stored file has no EXIF (verify via `exiftool` or the `files.exif_stripped=true` flag shown on the ops line page).
* AC-NEW-05 Given the xlsx `docs/fixtures/order312_sample.xlsx` (seed script writes it, columns Name/Link/Qty), When I import it, Then 8 lines are prefilled with the correct quantities.
* AC-NEW-06 Given an xlsx without recognisable headers, When I import it, Then I see the fallback message and can attach it, producing one line named after the file with the document listed under Documents.
* AC-NEW-07 Given "Save draft", Then the request appears under Requests & orders › Drafts, is not in `/ops/queue`, and no outbox rows exist for it.
* AC-NEW-08 Given Bogdan on `/ops/requests/new` choosing "KOFF", When I send one line, Then the request has `source=agent_on_behalf`, appears in KOFF buyer's `/app` under Received, and no `client_request_received` email is queued unless "notify client" was ticked.

### F-05 Requests & orders list `/app/requests`

**User story.** As a client I find any line or order by name, ref or status.

**UI regions.** Tabs: **Active** (lines not delivered/completed/cancelled, plus orders not completed) · **Waiting on you** · **Delivered** (orders `delivered`/`completed`, lines `cancelled` under a "Closed" sub-heading) · **Drafts**. Table columns: Ref · Name · Qty · Milestone (chip) · Status detail (client sub-label / exception) · ETA · Updated. Search box filters by ref/name. Sort by Updated desc.

**Behaviours.** Row click → line page (or order page when the line has an order). Orders with multiple lines appear once per line with the order ref in the Ref column (`ORD-2026-0312 · line 01`).

**Empty state.** Per tab: "No active requests" / "Nothing waiting on you" / "No delivered orders yet" / "No drafts".

**Acceptance criteria.**
* AC-LIST-01 Given Piotr, When I open Active, Then I see 8 rows for REQ-2026-0312 lines, line 01 showing `ORD-2026-0312` and milestone "In production".
* AC-LIST-02 Given KOFF buyer, When I open Delivered, Then I see `ORD-2026-0290 · Boltless steel shelving …` with milestone "Delivered".
* AC-LIST-03 Given KOFF buyer, When I type "gloves" in search, Then only the gloves line remains.
* AC-LIST-04 Given Piotr, When I open Drafts, Then the tab is empty; Given KOFF buyer, Then Drafts shows the camping chair request.

### F-06 Request page (client) `/app/requests/[reqRef]`

**User story.** As a client I see one request with all its lines and can still edit it while nothing is frozen.

**UI regions.** Header (ref, created, source badge "Sent via WhatsApp" for agent-on-behalf, request note); lines table (Line · Name · Qty · Milestone · Status detail · open); tabs below: Updates (request-level + all lines' client-visible updates), Documents (request-level client-visible docs), History (client-visible events), **Ask about this request** box.

**Fields (edit mode, only while every line ≤ `in_review`).** Same as F-04; lines can be added/removed; a line in `spec_frozen`+ shows a lock icon and "Request a change" instead.

**Behaviours.** Edit saves `line_updated` events (client-visible, payload diff). "Request a change" on a frozen line opens a modal (text ≥ 10 chars) → comment `kind=change_request, visibility=client` + `exception=change_requested` + outbox `ops_client_action`. Ask box → comment `kind=question`, entity = request, outbox `ops_client_question` to assigned agents of the lines (or all agents if none).

**Acceptance criteria.**
* AC-REQ-01 Given KOFF buyer opens the camping-chair draft, When I change qty to 500 and Send, Then the line is `submitted` and appears in `/ops/queue`.
* AC-REQ-02 Given Piotr opens REQ-2026-0312, Then line 26 (spec frozen) shows a lock and "Request a change"; When I submit "Please make it 8-pocket", Then `/ops/lines/REQ-2026-0312-26?tab=timeline` shows the change request and the exception badge "Change requested".
* AC-REQ-03 Given Piotr, When I ask "When will line 03 be priced?", Then the question appears under Updates with my name and the outbox has an `ops_client_question` row to `bogdan@influensia.ro`.

### F-07 Line page (client) `/app/lines/[lineRef]`

**User story.** As a client I open one line and everything about it is on one page (D-07).

**UI regions** (blueprint order-page wireframe): (1) header: ref · name · milestone chip "{Milestone} · {n} of 9"; (2) 9-step stepper; (3) **Waiting on you** card if any (same content as dashboard); (4) facts grid: Quantity · Price (from accepted/sent offer: `$0.062 / pc` and `+ fee` when `factory_plus_fee`) · ETA (ex-works or port when known) · Your reference (client_sku); (5) primary button for the ▲ action; the "N contacted · M quoted" text is rendered from `sourcing_progress.reached/priced`; (6) tabs **Updates** (client-visible comments + milestone events, newest first, as in the wireframe "22 Sep · Quality check passed — …") · **Documents** (client-visible docs: name, kind label, date, download) · **History** (all client-visible activity, compact) · **Ask about this order** (textarea + send); (7) side panels: "Your previous orders of this product" (D-19: orders of the org with the same `product_id`, `state ≥ delivered`), "More from this factory" link when a published range exists for the line's selected supplier and this org; (8) offer summary card (accepted option) and sample card when they exist; (9) "Order" card linking to the order page once confirmed.

**Behaviours.** Ask → comment `question` on the line, outbox `ops_client_question`; if `exception=needs_input`, the same send clears the exception (agent is notified). Documents download via `/api/app/documents/[id]/download`. Photos in Updates open in a lightbox.

**Empty states.** Updates: "No updates yet — you'll see every step here." Documents: "No documents yet." Previous orders: hidden when empty.

**Acceptance criteria.**
* AC-LINE-01 Given Piotr opens `/app/lines/REQ-2026-0312-01`, Then the stepper shows step 6 "In production" active with steps 1–5 done, facts show Quantity 100 000 pcs, Price `$0.062 / pc + fee`, ETA Gdańsk 18 Nov 2026, and the Order card links to `/app/orders/ORD-2026-0312`.
* AC-LINE-02 Given the same page, Then Updates lists, newest first, exactly the ten entries of table 7.12 with those dates and texts.
* AC-LINE-03 Given the same page, Then Documents lists exactly: `allegro-sleeves-ref.jpg` (Reference image), `PI-ORD-2026-0312.pdf` (Proforma invoice), `Artwork-sleeves-v1.pdf` (Artwork), `Dieline-sleeve-66x91.pdf` (Dieline), `Sample-photo-1.jpg`, `Sample-photo-2.jpg` — and **not** `Yuantuo-quote-2026-09-15.xlsx`, `ZZLEAKTEST-quote.xlsx`, `Best-prices-sleeves.xlsx`, `PO-2026-0312-01.pdf`, `RFQ-0312-v1.pdf`.
* AC-LINE-04 Given Piotr opens `/app/lines/REQ-2026-0312-26`, Then the stepper shows "Finding factory" (step 2) with sub-label and no price in facts.
* AC-LINE-05 Given Piotr opens `/app/lines/REQ-2026-0312-11`, Then the status detail reads "3 contacted · 2 quoted" (participations on line 11: Yuantuo quoted, Suti quoted, Boyuan contacted).
* AC-LINE-06 Given KOFF buyer opens `/app/lines/REQ-2026-0290-01` (shelving, delivered), Then "Your previous orders of this product" is hidden (it is the only order) and the Order card links to `ORD-2026-0290`; Given KOFF buyer opens the catalog product PRD-0001 instead, Then the previous-orders panel shows ORD-2026-0290.
* AC-LINE-07 Given Piotr on line 01, When I send "Can you share production photos?" in Ask, Then it appears in Updates immediately and the outbox has `ops_client_question` to bogdan.
* AC-LINE-08 Given the response body of `GET /api/app/lines/REQ-2026-0312-01`, Then the JSON keys (recursively) contain none matching the DENYLIST regex of 5.3.
* AC-LINE-09 Given Piotr opens `/app/lines/REQ-2026-0301-01` (KOFF's gloves line), Then HTTP 404.

### F-08 Offer page (client) `/app/offers/[offerRef]`

**User story.** As a client I compare up to three options and accept one, ask for changes, or decline (D-06, discovery §06).

**UI regions.** Header: line name · "Offer v{n}" · valid until (red if < 3 days) · incoterm + port ("FOB Shenzhen"); option cards A/B/C side by side: price ladder table (qty → unit price; `+ fee {amount}` line when `factory_plus_fee`), MOQ, lead time (days), deviations in plain words, sample cost + who pays, payment terms (client-facing text), "sample before order" yes/no; per card "Accept option {A}" button; below: "Ask for changes" (textarea) and "Decline" (reason select: too expensive / lead time / spec / no longer needed / other + text).

**Fields.** Accept: option label (required). Ask for changes: text ≥ 10 chars. Decline: reason (enum) + optional text.

**Behaviours.** Only `status=sent` offers show buttons; `accepted` shows the accepted option highlighted and "Accepted on {date}"; `changes_requested`/`declined`/`expired` show the status and "We'll send a new price". Accept with `sample_required=true` → line `sampling` + sample `ordered`; otherwise → `offer_accepted`. Click-to-accept shows a confirm dialog: "Accepting creates a binding order request at these prices once we confirm it." Old offer versions are reachable from the line page History.

**Side effects.** `offer_decided` (client-visible), state change (3.4), outbox `ops_client_action` (assigned agent), `client_milestone_changed` when milestone changes.

**Acceptance criteria.**
* AC-OFFER-01 Given KOFF buyer opens `/app/offers/OFR-2026-0301-01-v1`, Then one option A shows `10 000 pairs → $0.26 / pair`, MOQ 10 000, lead 25 days, "FOB Ningbo", valid until 10 Oct 2026, and the page contains no text matching `/Tongfu|Linyi/`.
* AC-OFFER-02 When I click "Accept option A" and confirm, Then the line state is `offer_accepted`, milestone "Order confirmed", the dashboard card is gone, `/ops/lines/REQ-2026-0301-01?tab=offer` shows "Accepted A on {today}", and the outbox has `ops_client_action` to bogdan and `client_milestone_changed` to buyer@koff.example.
* AC-OFFER-03 Given Piotr opens `/app/offers/OFR-2026-0312-01-v1` (accepted), Then option A is highlighted "Accepted on 8 Sep 2026", option B is dimmed, and no buttons are shown.
* AC-OFFER-04 Given a fresh offer sent by Bogdan on line REQ-2026-0312-03 (F-18), When Piotr clicks "Ask for changes" with "Need 120 µm", Then the offer status is `changes_requested`, the line shows badge "Change requested", and Bogdan sees the text on the Timeline tab.
* AC-OFFER-05 Given the same fresh offer, When Piotr declines with reason "too expensive", Then the offer is `declined`, the line stays in "Price ready" with waiting-on = agency, and `/ops` lists it under "Waiting on us".
* AC-OFFER-06 Given the worker runs with the clock at 2026-10-11, Then OFR-2026-0301-01-v1 (if still `sent`) becomes `expired`, the line gets `quote_expired`, and the client page shows "Price expired — new price coming".

### F-09 Sample approve / reject `/app/samples/[sampleRef]`

**User story.** As a client I approve or reject the sample in the app, with photos (D-17).

**UI regions.** Header (line name, sample ref); status timeline ordered → shipped (courier + tracking link) → received; photos gallery (agent-uploaded `sample_photo` docs, client-visible); sample cost + who pays; buttons "Approve" · "Reject" (reason ≥ 10 chars, optional photos ≤ 5).

**Behaviours.** Buttons only when `status=received`. Approve → `approved`, line → `offer_accepted`. Reject → `rejected`, exception `sample_rejected`, photos stored as `sample_photo` docs uploaded by the client (`visibility=client`).

**Side effects.** `sample_decided` (client-visible), outbox `ops_client_action`, milestone email on approve.

**Acceptance criteria.**
* AC-SMP-01 Given Piotr opens `/app/samples/SMP-2026-0312-02-1`, Then status is "Received 26 Sep 2026", courier "DHL" with tracking `JD014600012345678901`, cost `$45 (paid by you)`, and Approve/Reject are enabled.
* AC-SMP-02 When I Approve, Then line 02 shows milestone "Order confirmed" with sub-label "Preparing your order confirmation", the dashboard card is gone, and `/ops/lines/REQ-2026-0312-02?tab=offer` shows "Confirm order" enabled.
* AC-SMP-03 (Reset seed) When I Reject with reason "Film too thin at edges" and one photo, Then the sample is `rejected`, the line badge reads "Sample rejected — new sample coming", the photo is listed under Documents on the line, and Bogdan's Timeline shows the reason.
* AC-SMP-04 Given Piotr opens `/app/samples/SMP-2026-0312-01-1` (approved), Then two photos are shown and no buttons.

### F-10 Order page (client) `/app/orders/[orderRef]`

**User story.** As a client I see the money, the ETA, the QC result, the shipping documents and what I owe — without asking on WhatsApp.

**UI regions** (blueprint wireframe right side): (1) header `ORD-2026-0312 · Card sleeves 66×91` · milestone chip `Quality check · 7 of 9`; (2) stepper; (3) Waiting-on-you card; (4) facts: Quantity · Price (`$0.054 / pc + fee` in `factory_plus_fee`; `$0.062 / pc` all-in otherwise) · ETA (ex-works while producing, port ETA once departed, delivered date at the end) · Incoterm/port · PI number; (5) **Money** section `#payments`: table kind · amount · due · status (Paid {date} / Due) · "View invoice" links to the PI/invoice document; (6) **Artwork** `#artwork`: per line: status, dieline download, upload/revise button, agent note; (7) **Quality check** `#qc`: scheduled/inspected date, result chip, "View QC report" if published; (8) **Shipping**: mode, ETD, ETA port, tracking (container/AWB), customs status, B/L + packing list downloads; (9) tabs Updates · Documents · History · Ask about this order (as in F-07, entity = order); (10) buttons: "Confirm delivery" (when `delivered`), "Reorder" (when `delivered`/`completed`); (11) "More from this factory" link (F-25); (12) lines table when > 1 line.

**Fields.** Artwork upload: file (pdf/ai/png/jpg ≤ 25 MB), note ≤ 500. Confirm delivery: optional "any issues?" text. Ask: text.

**Behaviours.** Money amounts from `payments`; "Paid" shows date only, never the reference. Documents list = `documents.visibility=client` for the order **and** its lines (union). Confirm delivery → `completed`. Reorder → F-12.

**Empty states.** Artwork: "No artwork needed for this order" when `artwork_required=false` on all lines. QC: "Inspection not scheduled yet". Shipping: "Not shipped yet".

**Acceptance criteria.**
* AC-ORD-01 Given Piotr opens `/app/orders/ORD-2026-0312`, Then: stepper at "In production" (6 of 9); Money shows Deposit $1,860.00 Paid 22 Sep 2026, Fee $540.00 Paid 22 Sep 2026, Balance $4,340.00 Due on QC pass; Artwork "Approved 23 Sep 2026" with `Dieline-sleeve-66x91.pdf` downloadable; QC "Scheduled 22 Oct 2026"; Shipping "Not shipped yet" with "Planned ETA Gdańsk 18 Nov 2026".
* AC-ORD-02 Given the same page, Then the page text does not contain `PO-2026`, `Yuantuo`, `ZZLEAKTEST`, `T/T`, `Daryl`, or any `+86` number, and no download link points to a document with `visibility=internal` (verify by requesting `/api/app/documents/<internal doc id>/download` → 404).
* AC-ORD-03 Given Bogdan records inspection `pass` on ORD-2026-0312 (F-22), When Piotr reloads, Then the stepper is at "Quality check" (7 of 9), a Waiting-on-you card "QC passed — balance $4,340.00 due {date}" appears, and "View QC report" downloads `QC-report-ORD-2026-0312.pdf` only after Bogdan published it.
* AC-ORD-04 Given KOFF buyer opens `/app/orders/ORD-2026-0290`, Then Shipping shows Sea, ETD 14 Jul 2026, ETA Gdańsk 26 Aug 2026, delivered 28 Aug 2026, documents `BL-ORD-2026-0290.pdf` and `Packing-list-ORD-2026-0290.pdf`, and both "Confirm delivery" and "Reorder" buttons are visible.
* AC-ORD-05 When KOFF buyer clicks "Confirm delivery", Then the order is `completed`, milestone "Delivered" step 9 done, the dashboard card disappears, `/ops/suppliers/SUP-0001` shows orders_count 1 and last order 28 Aug 2026, and outbox has `client_milestone_changed`.
* AC-ORD-06 Given an order in `awaiting_artwork` (create via F-22 from KOFF gloves after AC-OFFER-02 → confirm → publish PI → mark deposit+fee paid), When KOFF buyer uploads `artwork.pdf`, Then artwork status "Submitted — under review", the ops Artwork tab shows the file, and outbox has `ops_client_action`.
* AC-ORD-07 Given Piotr asks a question on the order, Then it appears in Updates and `ops_client_question` is queued to bogdan.

### F-11 Catalog `/app/catalog`, `/app/catalog/[prdRef]`

**User story.** As a client I browse previously sourced products with a reference price and request an offer in one click (D-16).

**UI regions.** Grid/list of cards: clean image (or placeholder), name, category, reference price `$8.90 / set` with small print `at 1 000 sets · FOB Qingdao · spec v2 · valid until 31 Dec 2026`; "Request offer" button. Detail page: images (clean only), description, spec fields of `reference_spec_version`, reference price block, "Your previous orders of this product", "Request offer" (qty input, defaults to reference_moq, note).

**Behaviours.** Reference price is always all-in (D-11) regardless of `pricing_display`. Request offer → creates a request (`source=portal`, note "From catalog PRD-0001") with one line pre-linked: `product_id`, `name`, `spec_version=reference_spec_version`, `qty_first`, state `submitted`, flag `from_catalog=true`; the agent's line page shows "Catalog request — reference price $8.90; confirm or re-quote" (Problem 2 in discovery: agent confirmation before offer). Stale reference (`reference_valid_until < today`) shows "price to be confirmed" instead of the price.

**Empty state.** "Our catalog is being prepared. Send a request and we'll source it."

**Acceptance criteria.**
* AC-CAT-01 Given Piotr opens `/app/catalog`, Then 4 products are listed (shelving $8.90/set, gloves $0.26/pair, icicle lights $9.90/set, card sleeves $0.062/pc) each with MOQ, incoterm+port, spec version, valid-until.
* AC-CAT-02 Given KOFF buyer opens PRD-0001, Then "Your previous orders of this product" lists ORD-2026-0290 ($7.52/set, 1 000 sets, delivered 28 Aug 2026); Given Piotr opens the same product, Then that panel is absent.
* AC-CAT-03 When Piotr clicks "Request offer" on PRD-0001 with qty 500, Then a new request `REQ-2026-0327` (or next) exists with one line named "Boltless steel shelving 5-tier 180×90×40 black", `spec_version=2`, and `/ops/queue` shows it with a "Catalog" badge.
* AC-CAT-04 Given the clock at 2027-01-05, Then PRD-0001 shows "price to be confirmed" instead of $8.90.
* AC-CAT-05 Given `GET /api/app/catalog`, Then no item exposes `owner_org_id`, and images returned are only `kind=clean`.

### F-12 Reorder (D-18)

**User story.** As a client I reorder a delivered order with one click and, if the price still holds, skip straight to an offer.

**Behaviours.** "Reorder" on an order `delivered`/`completed` opens a modal: per line qty (default previous qty) → "Create request". Creates a request (`source=portal`, `is_repeat=true` on every line, `product_id` and `spec_version` copied, `client_sku` copied, note "Reorder of ORD-…"). For each line: if the previous `selected_participation_id` has a quote with `valid_until ≥ today`, the line skips the sourcing lane: it is created directly in `state=negotiating` (milestone "Finding factory", client sub-label "Repeat order — price being confirmed"), with the participation copied (`status=selected`) and a **draft** offer pre-built from that quote using the last accepted option (prices copied, `valid_until = min(quote.valid_until, today+14)`); the agent reviews and sends it (the offer is **not** auto-sent — a human sends it), which moves the line to `offer_ready`. Otherwise the line is created `submitted` with the participation pre-created (`status=contacted`) so the board is pre-filled. Badge "Repeat" on both doors. The line's assigned agent = the old order's line agent.

**Side effects.** `reorder_created` (client-visible on the new line, internal payload links the old order), outbox `ops_new_request` (subject "Repeat order").

**Acceptance criteria.**
* AC-REO-01 Given KOFF buyer clicks Reorder on ORD-2026-0290 with qty 1 000, Then a new request appears with one line badged "Repeat", milestone "Finding factory" with sub-label "Repeat order — price being confirmed", and the line is not listed in `/ops/queue` (it is already assigned to Bogdan and past `in_review`). (Ecosino's shelving quote is valid to 31 Oct 2026 in the seed.)
* AC-REO-02 Then `/ops/lines/<new>?tab=offer` shows a draft offer with option A `$8.90 / set @ 1 000` prefilled and Bogdan can send it without touching the sourcing board.
* AC-REO-03 Given the same with the clock at 2026-11-15 (quote expired), Then the line is `submitted` with Ecosino pre-added as `contacted` on the board and no draft offer.

### F-13 Ops dashboard `/ops`

**User story.** As an agent I open the workspace and see what is stale, what waits on us, what waits on the client and what nobody owns (blueprint "Agent flows › Ops dashboard").

**UI regions.** Four columns/boards (TanStack Table each), counts in headers, "Mine / All" toggle (default Mine for agents, All for admin):
1. **Stale** — lines/orders with `stale=true` (B.3): ref · name · client · state · days since last change · agent · [Open].
2. **Waiting on us** — `waiting_on=agency`, not stale, sorted oldest first.
3. **Waiting on client** — `waiting_on=client`: ref · name · client · reason (offer sent / sample received / deposit due / artwork due / balance due / confirm delivery / needs input) · since.
4. **Unassigned** — lines `submitted` with no agent: [Claim] button inline.
Below: **Today's client actions** — client-authored events in the last 24 h (offer decisions, sample decisions, artwork uploads, questions, confirmations).

**Behaviours.** Claim = assign to me + `in_review`. Rows link to the line/order tab that owns the next action (e.g. stale `negotiating` → sourcing tab; `awaiting_deposit` → order Payments tab). `on_hold` and `cancelled` never appear.

**Empty state per column.** "Nothing stale — good." / "Nothing waiting on us." / "Nothing waiting on clients." / "Queue is empty."

**Acceptance criteria.**
* AC-OPS-01 Given Bogdan on `/ops` with "All", Then Stale lists exactly: `REQ-2026-0312-14` (rfq_out, last change 2026-09-12), `REQ-2026-0318-01` (Christmas tree, quotes_in, last change 2026-09-16), `REQ-2026-0312-26` (spec_frozen, last change 2026-09-17). (Seed clock: 2026-09-28; 5 working days back = 2026-09-21.)
* AC-OPS-02 Then Waiting on client lists: KOFF gloves (offer sent), Piotr line 02 (sample received), ORD-2026-0290 (confirm delivery).
* AC-OPS-03 Then Unassigned lists `REQ-2026-0325-01` (LED floodlight, KOFF) with a Claim button; When Bogdan clicks Claim, Then the row disappears, the line is `in_review` assigned to Bogdan, and `/app` for KOFF buyer shows the agent name on the line page.
* AC-OPS-04 Given "Mine" for Cristina, Then Stale shows only `REQ-2026-0318-01` (assigned to Cristina).
* AC-OPS-05 Given Bogdan sets `REQ-2026-0312-14` to `on_hold` with reason "waiting for client volume", Then it leaves Stale and shows nowhere on the dashboard.

### F-14 Request queue `/ops/queue`, requests list `/ops/requests`

**User story.** As an agent I see incoming lines, claim or assign them, and find any request.

**UI regions.** Queue: table of lines in `submitted`/`in_review` — ref · client · name · qty · links (icons, not-durable flag) · images count · source badge (portal / import / WhatsApp / catalog / repeat) · submitted · agent · [Claim] / [Assign ▾]. Requests list: ref · client · lines · states roll-up (chips with counts) · agent(s) · updated · stale count; filters client / state / agent / stale; "New request on behalf".

**Behaviours.** Assign requires choosing an agent; assign on a `submitted` line moves it to `in_review`. Bulk select → Assign.

**Acceptance criteria.**
* AC-QUEUE-01 Given Cristina on `/ops/queue`, Then `REQ-2026-0325-01` shows source "Portal", 1 link, agent "—".
* AC-QUEUE-02 When Cristina assigns it to Bogdan, Then agent shows Bogdan, state `in_review`, and the line's timeline has `line_assigned` (internal) and `state_changed` (client-visible, "In review").
* AC-QUEUE-03 Given `/ops/requests` filter client=Piotr's team, Then one request REQ-2026-0312 with 8 lines and state chips exactly `in_production 1 · sampling 1 · negotiating 1 · quotes_in 3 · rfq_out 1 · spec_frozen 1`.

### F-15 Line — Spec & freeze `/ops/lines/[lineRef]?tab=spec`

**User story.** As an agent I complete the spec from the client's paste-and-go input and freeze it as version N (discovery "spec lock").

**UI regions.** Left: client input (links with open-in-new-tab + not-durable flag, client reference images with "client reference — never send to suppliers" label, qty, note, client_sku, target delivery, destination, incoterm wanted, forecast). Right: spec form (product link/create, category, spec fields), supplier-facing images (upload; kind `supplier_facing`), completeness checklist, "Freeze spec v{n}" button, list of frozen versions (diff view read-only).

**Fields.** `products.name` (required), `category` (select: seeded list — packaging, fitness, garden, lighting, safety, seasonal, furniture, tools, other), `hs_code` (6–10 digits, optional), spec fields (jsonb — a key/value editor with typed rows: text / number+unit / boolean / enum; templates per category may be added later), `materials`, `customisation`, `unit` (pcs/set/pair/bag/m — required, drives compare), `artwork_required` (bool, default false), `sample_required` default true. Completeness gate for freeze: name, category, unit, ≥ 3 spec fields, ≥ 1 image of any kind **or** ≥ 1 link, qty ≥ 1. Missing items listed inline; button disabled until green.

**Behaviours.** Freeze → `product_specs` row (`version = previous+1`, `fields` snapshot, `frozen_at/by`), line `spec_version`, state `spec_frozen` (if from `in_review`; re-freeze from later states keeps the state and posts a client-visible update "Spec updated to v{n}"). Creates the product if the line has none (`visibility=private`, `owner_org_id = org`). Client edit lock takes effect immediately.

**Side effects.** `spec_frozen` (client-visible with version), milestone email.

**Acceptance criteria.**
* AC-SPEC-01 Given Bogdan opens `REQ-2026-0325-01?tab=spec`, Then the Freeze button is disabled and the checklist shows the missing items (category, unit, spec fields).
* AC-SPEC-02 When Bogdan fills category=lighting, unit=pcs, fields power=150 W, lumens=16500, ip=IP65 and clicks Freeze, Then state is `spec_frozen`, `product_specs` v1 exists, KOFF buyer's line page shows "Finding factory" and the spec summary, and the client edit controls are gone from `/app/requests/REQ-2026-0325`.
* AC-SPEC-03 Given `REQ-2026-0312-01`, Then spec v1 (frozen 2026-09-03) shows fields: size 66×91 mm, thickness 100 µm single wall, material PP virgin, pack 100/bag, PVC-free.
* AC-SPEC-04 Given a client reference image on a line, Then it is labelled "client reference" and is not selectable as `clean` for the catalog.

### F-16 Line — Cost & target price `/ops/lines/[lineRef]?tab=cost`

**User story.** As an agent I record the production cost model and confirm the target price before negotiating (Bogdan's "cost + 20%").

**UI regions.** Cost model form; uplift; computed target; "Confirm target" with name/date; pricing-rule hint ("category packaging: uplift 20 %, margin 15 %"); history of confirmations.

**Fields** (`request_lines.cost_model` jsonb): `material_floor_minor`, `process_cost_minor`, `packaging_minor`, `overhead_pct` (0–100), `est_prod_cost_minor` (required > 0; default = (material+process+packaging)×(1+overhead)), `method` (text, e.g. "mass × resin price"), `notes`. `uplift_pct` default from `pricing_rules` for the product category else 20. `target_price_minor = round(est_prod_cost × (1+uplift/100))` to 4 decimals of the unit currency. `target_confirmed_by/at`.

**Behaviours.** First save moves `spec_frozen → cost_target_price`. Target and cost never serialise to clients (denylist). Sourcing board header shows "Cost floor / Target" from here.

**Acceptance criteria.**
* AC-COST-01 Given `REQ-2026-0312-01?tab=cost`, Then est. production cost `$0.031`, uplift 20 %, target `$0.037`, confirmed by Bogdan 2026-09-04.
* AC-COST-02 Given `REQ-2026-0325-01` after AC-SPEC-02, When Bogdan saves est cost $9.50 with uplift 20, Then target `$11.40`, state `cost_target_price`, milestone still "Finding factory", and no client email is queued.
* AC-COST-03 Given Marko edits pricing rule `lighting` uplift to 25 on `/ops/settings/pricing-rules`, When a new line in lighting opens the cost tab, Then the default uplift is 25; existing lines keep their stored value.

### F-17 Line — Sourcing board `/ops/lines/[lineRef]?tab=sourcing`

**User story.** As an agent I run the supplier funnel for one line the way the Card sleeves tab does, but with status, structured quotes and a computed comparison (D-13; wireframe "Sourcing board").

**UI regions** (wireframe): header strip `REQ-2026-0312-01 · Card sleeves 66×91 100 µm · Negotiating` + `Cost floor $0.031 · Target $0.037 /pc · Client: Piotr · Finding factory`; **board table** columns: SUPPLIER (legal name + CN name, ref) · TYPE · GRADE · CONTACT · CHANNEL · STATUS (select) · PRICE @ MOQ (latest quote top break) · TERMS (incoterm+port · lead · payment) · USD/UNIT (normalised at line qty) · LAST (days since `last_contact_at`, ⚠ if > 7) · flags · actions (Log quote · Note · Set status); **compare strip** (B.4): "Best clean {price} ({supplier}) · Lowest quoted {price} ({supplier}, excluded: {reason}) · spread {x}× · {m} quotes of {n} contacted · {s} stale"; buttons **+ Supplier** (search existing by name/CN name/contact; or inline create with legal name + channel + contact) · **Log quote** · **Shortlist** (multi-select + reason) · **Build offer** (→ offer tab with selected participations); expandable row → quote versions with price breaks, deviations, files, notes, negotiation log.

**Fields — participation:** `supplier_id` (required), `contact_id` (optional), `status`, `reason` (required for `shortlisted`, `dropped`, `cannot_make`, `backup`), `notes` (free text — the sheet's "Other"), `first_contact_at` (default now), `last_contact_at` (bumped on any edit/quote/note; editable).

**Fields — quote:** `currency` (USD/CNY/EUR), `unit` (must equal line unit, else flag `unit_mismatch`; a "per bag of 100" quote is entered as unit `bag` with `pack_qty=100` and the system converts to per-piece), `incoterm` (EXW/FOB/CIF/DDP/DAP) + `incoterm_uncertain` bool, `port`, `moq`, `lead_days` (or range min–max), `valid_until`, `payment_terms` (text), `deviations` (text), `unit_weight_g`, `carton` (text), `source_file` (upload → document `quote_file`, internal), `received_at`, **price breaks**: ≥1 row `{min_qty, unit_price_minor}` ascending; `normalised_usd_minor` computed per break with `fx_rates` (latest ≤ received_at; shown with rate and date); `version` auto-increments per participation.

**Behaviours.**
* First quote on a line: `rfq_out → quotes_in` (system).
* Status `selected` → sets `request_lines.selected_participation_id` (only one; choosing another demotes the previous to `backup` with a prompt); `backup` → `backup_participation_id`.
* `cannot_make`/`dropped` rows collapse to the bottom, greyed.
* "Log quote" from a file: upload stores the file; **extraction is manual** in v1 (form pre-filled empty; a note says "extraction automation is v1.1").
* Compare strip recomputes on every change (B.4). Hover on "excluded" shows the flags.
* "Previous orders of this product" panel (ops variant, D-19): all orgs' orders of this `product_id` with client name, price, supplier, date.
* Notes on the participation accept `@`-free plain text; every save bumps `last_contact_at` unless the "don't bump" checkbox is ticked.

**Side effects.** `participation_added`, `participation_status_changed`, `quote_logged` (all internal). Client-visible counts "N contacted · M quoted" update immediately (`contacted` = participations with status ≠ `cannot_make`; `quoted` = participations with ≥1 quote and status ∉ {`cannot_make`}).

**Empty state.** "No suppliers yet. Add from the database or create one inline." + hint listing the client's links for reference.

**Acceptance criteria.**
* AC-BOARD-01 Given `REQ-2026-0312-01?tab=sourcing`, Then 9 rows: Yuantuo (manufacturer · B · Daryl Yang · email · **selected** · 0.0539 @ 100k · FOB Shenzhen · 30 d · T/T · 0.0539), Suti (trading · D · Tim Wang · Alibaba · dropped · 0.032 @ 3k bags → 0.0320/pc · FOB Ningbo · 50 % dep. · flag expired), Yili 依立 (unchecked · — · 1688 · quoted · 0.0348/pc · EXW · flags incoterm/unchecked), Dr. Card (manufacturer · WeChat · quoted · 0.0745), Quote D (unchecked · — · email · **backup** · 0.076 @ 100k · FOB Shenzhen · 40 d), Boyuan (contacted), Fuli (contacted · LAST 15 d ⚠), Jinou (cannot_make), ZZLEAKTEST (manufacturer · C · quoted · 0.0500).
* AC-BOARD-02 Then the compare strip reads: "Best clean $0.0539 (Yuantuo) · Lowest quoted $0.0320 (Suti, excluded: dropped, expired) · spread 2.4× · 6 quotes of 8 contacted · 2 stale". (Quotes: Yuantuo, Suti, Yili, Dr. Card, Quote D, ZZLEAKTEST = 6; contacted = 9 rows − Jinou = 8; stale = Fuli and Boyuan (last contact > 7 d).)
* AC-BOARD-03 When Bogdan logs a new quote for Boyuan: USD, FOB Shenzhen, MOQ 50 000, breaks 50 000 → 0.049, 100 000 → 0.046, valid 2026-10-31, Then Boyuan's status becomes `quoted`, USD/UNIT shows 0.0460 (at line qty 100 000), the strip says "7 quotes of 8 contacted · 1 stale", and Piotr's line page reads "8 contacted · 7 quoted".
* AC-BOARD-04 When Bogdan logs a CNY quote (¥0.24/pc), Then the normalised column shows `$0.0359` with tooltip "6.6933 @ 2026-09-21".
* AC-BOARD-05 When Bogdan sets Suti to `shortlisted` without a reason, Then validation "Reason required"; with a reason it is saved and an internal event is written.
* AC-BOARD-06 Given `REQ-2026-0325-01` in `cost_target_price`, When Bogdan adds supplier "Nantong Stylish Lighting" (existing) and clicks "Mark RFQ sent", Then state `rfq_out`, participation `contacted`, `rfqs` row with `recipients_count=1`, and KOFF buyer's line shows "1 contacted".
* AC-BOARD-07 When Bogdan logs the first quote on that line, Then state `quotes_in` automatically.
* AC-BOARD-08 Given `+ Supplier` search "yuan", Then results include "Dongguan Yuantuo Packaging Products Co., Ltd." and "Huizhou Boyuan Plastic Products" (name contains "yuan").
* AC-BOARD-09 Given the ops "Previous orders of this product" panel on `REQ-2026-0290-01`'s product (PRD-0001), Then ORD-2026-0290 with client KOFF, supplier Ecosino, $7.52 is listed; the same product opened by a client never shows the supplier (AC-CAT-02).

### F-18 Line — Offer builder `/ops/lines/[lineRef]?tab=offer`

**User story.** As an agent I turn the shortlisted quotes into an anonymised offer with up to three options, preview it as the client, and send it (discovery §06 Quote → Offer).

**UI regions.** Left: source quotes (checkbox per participation with a quote; max 3); right: options A/B/C cards generated from the checked quotes: **label**, participation (ops-only, shown as supplier name with a lock icon), MOQ, lead_days, price ladder editor (rows `{min_qty, unit_price_minor}`; prefilled = normalised quote break × (1 + margin_pct from pricing rule) rounded per rule; editable), `fee_minor` (flat per order; prefilled from pricing rule `fee_pct` × ladder total at qty_first, editable; shown only when org `pricing_display=factory_plus_fee`), `factory_price_minor` (ops-only; = normalised quote price at qty), `deviations_plain` (required text ≥ 3 chars, e.g. "none at spec thickness"), `sample_cost_minor` + `sample_paid_by`, `sample_required` (bool, default from line), `payment_terms_client` (text; default from org: "30 % deposit + fee on order, 70 % after QC pass"), `incoterm` + `port` (default from quote; incoterm must be FOB unless admin), `valid_until` (default today + 14). Offer-level: version (auto), note to client (optional). Buttons: **Preview as client** (renders the client offer page from the client DTO in a drawer) · **Send offer** · **Save draft**. Below: sent offers with status/decisions, and **Confirm order** (when an offer is accepted; see F-22).

**Behaviours.**
* Send: validation + **leak check** on every text field (deviations, note, payment terms, port is allowed) → block with the matched string and field if any hit; then `offers.status=sent`, `sent_at`, line → `offer_ready` (from `quotes_in`/`shortlisted`/`negotiating`/`offer_ready`), `selected_participation_id` = option A's participation unless already set, previous sent offer of the line → `expired` if still `sent`.
* Pricing display: in `all_in` the ladder is the client price and `fee_minor` must be 0; in `factory_plus_fee` the ladder is the pass-through price and `fee_minor` ≥ 0 is shown separately to the client.
* An offer's options are frozen after send (new version to change).
* Repeat/catalog lines: the builder shows "Reference price $8.90 @ 1 000" as a hint.

**Side effects.** `offer_sent` (client-visible: "Price ready — offer v{n}"), outbox `client_offer_ready`, milestone email suppressed (offer email covers it).

**Acceptance criteria.**
* AC-OFB-01 Given `REQ-2026-0312-01?tab=offer`, Then OFR-2026-0312-01-v1 is listed as Accepted (A) on 8 Sep 2026 with option A = Yuantuo (lock icon), `$0.062 @ 100 000`, fee `$540.00`, and option B = Quote D `$0.085 @ 100 000`.
* AC-OFB-02 Given `REQ-2026-0312-03` (negotiating), When Bogdan checks Yuantuo's quote and Suti's quote, Then two option cards A (0.052 → prefilled ladder `100 000 → $0.0598` using packaging margin 15 %) and B appear, editable.
* AC-OFB-03 When Bogdan types "Quoted by Yiwu Suti Crafts" into B's deviations and clicks Send, Then the send is blocked with "Leak check: supplier name 'Yiwu Suti Crafts' in Option B › deviations" and nothing changes.
* AC-OFB-04 When the deviation is replaced with "80/100 µm film, verify on sample" and Send is clicked, Then the offer is `sent`, line 03 is `offer_ready`, Piotr's dashboard shows "Price ready — Japanese size 62×89 mm, 100 µm", and the outbox has `client_offer_ready` to piotr@example.pl with the offer URL.
* AC-OFB-05 Given Preview as client on that offer, Then the drawer shows options "A" and "B" without supplier names and the markup `data-dto="ClientOfferDto"`.
* AC-OFB-06 Given org KOFF (`factory_plus_fee`) vs a test org set to `all_in`, Then the fee field is hidden for the `all_in` org and the send fails if `fee_minor > 0`.

### F-19 Line — Timeline, updates, internal notes, Log WhatsApp `/ops/lines/[lineRef]?tab=timeline`

**User story.** As an agent I see everything that happened on the line and keep the record complete even when a conversation happened on WhatsApp (D-08).

**UI regions.** Composer with mode tabs: **Client update** (visibility client, kind `update`, optional photos → `production_photo`/`sample_photo` docs published together, leak-checked) · **Internal note** (visibility internal, kind `note`) · **Log WhatsApp** (visibility internal, source `whatsapp_log`, fields: counterparty (client / supplier name free text / other), message text, screenshot upload, occurred_at) · **Ask the client** (visibility client, kind `question`, sets `needs_input`). Feed: activity events + comments merged by time, filter chips All / Client-visible / Internal / WhatsApp / State changes; each item shows visibility badge; client questions have an inline "Reply" (client-visible `answer`, clears `needs_input` if set) and "Resolve". Exception controls: Set exception (needs_input via Ask; on_hold with reason; cancelled with reason), Clear exception, "Resolve change request" (radio: keep state / reopen negotiating / reopen RFQ / re-freeze spec).

**Behaviours.** Client update → outbox `client_new_update`. WhatsApp logs never notify anyone. Internal notes never serialise to clients. Leak check runs on client updates and on the on-hold reason.

**Side effects.** `comment_posted` (visibility per comment), `whatsapp_logged` (internal), `exception_set/cleared` (client-visible for `needs_input`, `on_hold`, `cancelled`; internal otherwise).

**Acceptance criteria.**
* AC-TL-01 Given `REQ-2026-0312-01?tab=timeline`, Then the feed includes the WhatsApp log "Bogdan ↔ Daryl (Yuantuo), 2026-09-14: confirmed 0.0539 FOB SZ for 100k" with the WhatsApp badge, the internal note "Suti registered 2026-03, 100k capital — do not use", and the client updates from AC-LINE-02.
* AC-TL-02 When Bogdan posts a client update "Production photos from the line" with one JPG, Then Piotr's line page Updates shows it with the photo, the photo document is `visibility=client kind=production_photo`, and outbox has `client_new_update`.
* AC-TL-03 When Bogdan posts a client update containing "as Yuantuo confirmed", Then the post is blocked by the leak check naming the match.
* AC-TL-04 When Bogdan uses "Ask the client" with "Which pocket colour?" on line 26, Then Piotr's dashboard shows a "We need your input" card; When Piotr answers via Ask, Then the exception clears and Bogdan's feed shows the answer.
* AC-TL-05 When Bogdan logs a WhatsApp exchange with a screenshot, Then it shows in the internal feed with the screenshot and nothing appears on any `/app` page or in the outbox.

### F-20 Samples (ops) `/ops/lines/[lineRef]/samples`

**User story.** As an agent I record the sample, its cost and tracking, and mark it shipped/received so the client can decide in the app.

**Fields.** `participation_id` (default selected; ops-only), `cost_minor` + currency, `paid_by`, `courier`, `tracking`, `status` transitions ordered → shipped (tracking required) → received (`received_at`), photos (docs `sample_photo`, published on upload with leak check on filename), `deviations_vs_spec` (internal text), agent note to client (optional client-visible update).

**Behaviours.** "New sample" from the offer tab or here; marks line `sampling` if it was `offer_accepted`/`offer_ready` (agent-initiated sample). "Skip sample" → `offer_accepted`. Sample payment: if `paid_by=client`, a `payments` row kind `sample` is created on the **line** (order_id null, `request_line_id` set) — see Appendix A.

**Side effects.** `sample_created`, `sample_status_changed` (client-visible), outbox `client_sample_shipped`, `client_sample_ready`.

**Acceptance criteria.**
* AC-SMPO-01 Given line 02's sample, Then status Received, cost $45 paid by client, courier DHL, 0 photos yet; When Bogdan uploads `sample-02.jpg`, Then Piotr's sample page shows it.
* AC-SMPO-02 Given line 03 after AC-OFB-04 and Piotr accepting with sample, When Bogdan marks shipped with tracking, Then outbox has `client_sample_shipped` with the tracking string; When marked received, Then Piotr's dashboard shows "Sample received".
* AC-SMPO-03 When Bogdan clicks "Skip sample" on line 03 while `sampling` with no sample received, Then the line is `offer_accepted` and the stepper for Piotr shows step 4 as skipped.

### F-21 Suppliers `/ops/suppliers`, `/ops/suppliers/[supRef]`

**User story.** As an agent I keep one record per factory with contacts, verdict, grade and price lists (discovery §07 "Suppliers", blueprint sheet-migration rules).

**UI regions.** List with search (legal/CN name, contact, handle), filters verdict/grade/channel/city, columns as in 2.3. Page: profile card (ref, legal_name, cn_name, type_verdict + verdict_source + checked_at, grade, USCC, registered_at, capital, city/province/country, ports[], website, notes, `disclosed_to_org_ids` rendered as client names with a red badge), contacts table (name, channel, handle, phone, is_primary, add/edit), price lists & catalogues (upload, valid_until, currency, notes — internal documents), participations across lines (line ref, client, status, latest quote, last contact), performance card, factory ranges built from this supplier.

**Fields.** `legal_name` required, unique on normalised name (lowercase, punctuation stripped, `co ltd` variants collapsed) — duplicate → inline "Looks like SUP-0007 Dongguan Yuantuo…" with link; `cn_name` optional; `type_verdict` default `unchecked`; `grade` optional; `uscc` 18 chars alnum optional; `ports[]` from a fixed list (Shenzhen, Ningbo, Shanghai, Qingdao, Xiamen, Guangzhou, Tianjin, Yiwu, other); contact: `name` or `handle` required, `channel` required, `phone` free text.

**Behaviours.** Deleting is soft and blocked while any participation is `selected`. `disclosed_to_org_ids` is written only by the system (shipment with client forwarder, or admin manual with reason).

**Acceptance criteria.**
* AC-SUP-01 Given `/ops/suppliers`, Then 17 suppliers are listed including `SUP-0017 ZZLEAKTEST Co., Ltd.` with grade C, verdict manufacturer, city Dongguan.
* AC-SUP-02 Given `/ops/suppliers/SUP-0007`, Then contacts: Daryl Yang (email, daryl@yuantuo.example) and Daryl (wechat, `daryl_yt`), participations on lines 0312-01/02/03/05/11/14/20 with statuses, and range FR-0001 "Factory F-0042" linked.
* AC-SUP-03 When Cristina creates "Dongguan Yuantuo Packaging Co Ltd", Then the duplicate warning names SUP-0007 and creation is blocked until the name is changed or "create anyway" (admin only) is used.
* AC-SUP-04 Given `SUP-0001` Ecosino after AC-ORD-05, Then performance shows orders_count 1, on_time_rate 100 %, last_order_at 2026-08-28.
* AC-SUP-05 Given Bogdan records a shipment on ORD-2026-0312 with `forwarder_party=client`, Then SUP-0007's page shows "Disclosed to: Piotr's team" and the activity event explains why.

### F-22 Orders (ops) `/ops/orders`, `/ops/orders/[orderRef]`

**User story.** As an agent I confirm an order from accepted offers and run it through production, QC, shipment and delivery with every step on the timeline and, where mapped, an email to the client (blueprint "Agent flows › Order").

**Tabs and fields.**

| Tab | Content | Actions / fields |
|---|---|---|
| Overview | Header (ref, client, mode, display, incoterm/port, PI number, state, exception, milestone, waiting on, stale), lines table (line ref, product, qty, unit price, fee, supplier (ops), PO), stepper (ops labels), next-action hints | State buttons per 3.4; Override state (admin); Set on hold / cancel |
| Payments | Rows kind · pct · amount · currency · payee · due_on · status · paid_at · reference · recorded_by | "Mark paid" (paid_at default today, reference required ≥ 3 chars), "Edit due date", "Add payment" (kind, amount), "Waive" (admin) |
| Artwork | Per order line: artwork files (client uploads, versions), dieline upload (agent → document `dieline`, publish to client), status, notes | Approve · Request changes (note) · Upload dieline · Toggle `artwork_required` |
| Purchase orders | One card per supplier: po_ref, supplier (name, contact), factory_total, currency, terms, exworks_eta, status, PO document (internal) | Edit · Issue · Set ETA (triggers `eta_changed`) · Mark completed |
| Inspection | Rows: scheduled_for, inspector, inspected_at, aql, sample_size, result, defects note, report document, visible_to_client | Schedule · Record result (uploads report) · Publish report (leak check) |
| Shipment | forwarder, forwarder_party, booking_ref, mode, container_or_awb, cargo_ready, exworks_shipped_at, etd, eta_port, port_of_discharge, arrived_port_at, customs_status, delivered_at, B/L + packing list documents | Record forwarder · Mark shipped ex-works · Mark departed · Arrived at port · Customs status · Mark delivered |
| Documents | F-23 | |
| Timeline | as F-19 (entity = order) | |

**Confirm order (from `/ops/requests/[reqRef]` or the line offer tab).** Modal: checklist of the request's lines in `offer_accepted` (default all checked), incoterm/port (from the offers; must match across lines else split), `commercial_mode` and `pricing_display` (default from org, overridable D-10), PI number (default `PI-{order_ref}`), deposit pct (default org 30), fee (sum of option fees, editable), "artwork required" per line (default from spec). Creates: `orders` (state `order_confirmed`, `total_minor` = Σ qty × unit_price + fees), `order_lines` (`unit_price_minor` from the accepted option's ladder at qty, `fee_minor`, `participation_id`), `payments` (`deposit` pct of goods, `fee` flat, `balance` remainder; payee `agency` for `agency_passthrough`/`principal`, `factory` for `agency_direct` except fee), `purchase_orders` per distinct supplier (`draft`, `factory_total_minor` = Σ qty × `factory_price_minor`), mirrors state to lines. Then the agent uploads the PI document and publishes it → `awaiting_deposit`.

**Acceptance criteria.**
* AC-OO-01 Given `/ops/orders/ORD-2026-0312` Overview, Then state `in_production`, milestone In production, waiting on agency, not stale (last change 2026-09-23), one line, PO `PO-2026-0312-01` to Yuantuo $5,390.00, exworks ETA 25 Oct 2026.
* AC-OO-02 Given Payments, Then deposit $1,860.00 paid 2026-09-22 ref `WIRE-0922-A`, fee $540.00 paid 2026-09-22 ref `WIRE-0922-A`, balance $4,340.00 pending, due_on empty ("on QC pass").
* AC-OO-03 When Bogdan schedules inspection for 2026-10-22 (already seeded) and then records result `pass` with report `QC-report-ORD-2026-0312.pdf`, Then state `awaiting_balance`, balance due_on = today + 3 working days, outbox `client_qc_result` + `client_payment_due`, and Piotr's page matches AC-ORD-03.
* AC-OO-04 When Bogdan records result `fail`, Then state `in_production` with exception `qc_failed`, PO status `in_production`, and Piotr sees "Rework in progress" with no balance due.
* AC-OO-05 Given balance pending, When Bogdan tries "Record forwarder", Then the action is blocked with "Balance not paid" unless Marko ticks the override with a reason.
* AC-OO-06 Given KOFF gloves after AC-OFFER-02, When Bogdan confirms the order (deposit 30 %, fee $150), Then `ORD-2026-0301` exists with total $2,750.00 (10 000 × $0.26 + $150), payments deposit $780.00 / fee $150.00 / balance $1,820.00, PO to Linyi Tongfu $2,050.00, state `order_confirmed`, and KOFF buyer's line page shows step 5 "Order confirmed".
* AC-OO-07 When Bogdan uploads `PI-ORD-2026-0301.pdf` and publishes it, Then state `awaiting_deposit`, KOFF dashboard shows "Deposit $780.00 + fee $150.00 due {due_on}", outbox `client_payment_due`.
* AC-OO-08 When Bogdan marks deposit and fee paid, Then state `awaiting_artwork` (gloves line has `artwork_required=true` in seed spec) and outbox `client_artwork_requested`; When KOFF uploads artwork and Bogdan approves it and clicks "Start production" with ETA 2026-11-05, Then state `in_production` and outbox `client_milestone_changed` containing "5 Nov 2026".
* AC-OO-09 When Bogdan changes the PO ETA to 2026-11-12, Then `eta_changed` event and outbox `client_eta_changed`; KOFF's line page shows the new ETA.
* AC-OO-10 Given ORD-2026-0290, Then all tabs are read-only-complete: 3 payments paid, inspection pass 2026-07-08 with published report, shipment sea MSKU… delivered 2026-08-28, and the "Close" button is available while `delivered`.

### F-23 Documents: upload, visibility, publish, leak check (D-22, mechanisms 5–6)

**User story.** As an agent I upload documents internal-by-default and publish the ones the client should see; the platform refuses to publish anything that names a factory.

**UI regions.** Documents tab on line and order (ops): table name · kind · visibility · uploaded by/at · published by/at · size · [Download] [Publish]/[Unpublish] [Replace] [Delete]; upload dropzone with kind select; publish confirm dialog shows the leak-check result (green "No supplier identifiers found" or red list of matches with context).

**Behaviours.**
* Upload: stored under `…/internal/…`, `documents.visibility=internal`, `kind` required. Client uploads (`reference_image`, `artwork`, `sample_photo` by client) are stored under `…/client/…` with `visibility=client` immediately (they are the client's own files) — leak check still runs on the filename only.
* Publish: runs `leakCheck(filename + text layer)` (B.5); PDF text extracted with `pdf-parse`; xlsx/docx text extracted from XML; images: filename only. On pass: object copied to `…/client/…` key, `visibility=client`, `published_at/by`, event `document_published` (client-visible "New document: {kind label}"), outbox `client_document_published` **except** for kinds whose publish is already covered by a state email (`pi` → `client_payment_due`, `qc_report` → `client_qc_result`). On fail: no change, event `leak_check_blocked` (internal, payload matches), red dialog.
* Unpublish: `visibility=internal`, client copy deleted, event `document_unpublished` (internal).
* Kinds that inherently name the factory (`quote_file`, `price_list`, `catalogue`, `comparison`, `rfq`) **cannot** be published — the button is absent and the server rejects (`E_KIND_NOT_PUBLISHABLE`).
* Client download endpoint resolves only `visibility=client` docs in the caller's org and signs/streams from the `client` prefix only.
* Documents tabs (ops and client) on an order show the union of the order's documents and its lines' and samples' documents; the client line page shows the union of the line, its samples and its order. Each document is attached to exactly one entity.

**Acceptance criteria.**
* AC-DOC-01 Given ORD-2026-0312 Documents (ops), Then rows: `PI-ORD-2026-0312.pdf` pi client · `Dieline-sleeve-66x91.pdf` dieline client · `Artwork-sleeves-v1.pdf` artwork client · `PO-2026-0312-01.pdf` other internal · `Yuantuo-quote-2026-09-15.xlsx` quote_file internal (no Publish button) · `ZZLEAKTEST-quote.xlsx` quote_file internal · `Best-prices-sleeves.xlsx` comparison internal.
* AC-DOC-02 When Bogdan uploads `docs/fixtures/leaky-report.pdf` (seed writes it; text layer contains "Dongguan Yuantuo Packaging Products Co., Ltd." and "+86 138 0000 0042") as `qc_report` and clicks Publish, Then the dialog lists both matches and the document stays internal, and the timeline has `leak_check_blocked`.
* AC-DOC-03 When Bogdan uploads `docs/fixtures/clean-report.pdf` as `qc_report` and publishes, Then Piotr can download it from the order page and the file is served from a `…/client/…` key.
* AC-DOC-04 When a client requests `/api/app/documents/<id of PO-2026-0312-01.pdf>/download`, Then 404.
* AC-DOC-05 When Bogdan uploads a file named `ZZLEAKTEST price list.pdf` as `certificate` and publishes, Then blocked on the filename.
* AC-DOC-06 When Bogdan unpublishes `Dieline-sleeve-66x91.pdf`, Then it disappears from Piotr's Documents and the download URL returns 404.

### F-24 Products / catalog admin `/ops/products`, `/ops/products/[prdRef]`

**User story.** As an admin I decide which sourced products go to the catalog and at what reference price; as an agent I keep product specs and images tidy (D-16, discovery Decisions "Catalog resale").

**UI regions.** List: ref · name · category · visibility · reference price · lines · orders · updated. Page: name/category/description/hs_code; spec versions (read-only after freeze); images by kind with "Mark as clean" (agent crops/uploads a clean version; the supplier original stays `supplier_facing`); reference price block (`reference_price_minor`, currency USD, `reference_moq`, `reference_incoterm`, `reference_port`, `reference_spec_version`, `reference_valid_until`); visibility toggle `private`/`catalog` (admin; requires reference price complete and ≥1 clean image or an explicit "publish without image" tick); history: lines and orders by client (ops-only, D-19).

**Behaviours.** Publish runs leak check on name/description; writes `published_at`, event `product_published` (internal). Unpublish → `private`. Reference price stale (`valid_until < today`) shows a warning chip in the list.

**Acceptance criteria.**
* AC-PRD-01 Given `/ops/products`, Then 15 products; 4 with visibility `catalog`.
* AC-PRD-02 Given Bogdan (agent) on PRD-0005 (sleeves 80 µm, private), Then the visibility toggle is disabled with tooltip "Admin only".
* AC-PRD-03 Given Marko on PRD-0005, When he sets reference price $0.055/pc @100 000 FOB Shenzhen spec v1 valid 2026-12-31 and publishes, Then Piotr's catalog shows 5 products and the product's description contains no supplier text (leak check ran).
* AC-PRD-04 Given PRD-0004 page, Then "Orders by client" lists ORD-2026-0312 (Piotr's team, Yuantuo, $0.062) — and this panel is absent from every `/app` page.

### F-25 Factory range `/ops/factory-ranges/*`, `/app/orders/[ref]/range` (D-15)

**User story.** As an admin I publish the sanitised range of the selected factory to one client as "Factory F-nnnn"; as a client I pick items and get quick quotes.

**UI regions (ops).** New: supplier (search), client org, upload sanitised PDF (kind `factory_range_pdf`), items editor (name, product link optional, clean image upload, MOQ, price_minor USD, unit, `made_here` yes/no/unknown, note). Page: label (assigned on publish), items, PDF preview, leak-check result (PDF text + every item name/note), Publish (admin) / Unpublish, "Shown to: {client}".

**UI regions (client).** "More from this factory" on the line/order page (visible when a published range exists for `selected_participation.supplier_id` × org): label "Factory F-0042 — the factory making your {product}", items grid with clean image, name, MOQ, indicative price ("from $x / unit, to be confirmed"), quantity input, "Request these items" → creates a request with one line per selected item, `state=negotiating` (skips RFQ), participation pre-created `selected` for that supplier, badge "From factory range". The PDF is downloadable (client copy).

**Behaviours.** Label from `sequences('FACTORY_LABEL')` at first publish, never changed; DTO = `{label, items[]}` + pdf document id. The range is visible only to `factory_ranges.org_id` and only from lines/orders whose selected supplier matches.

**Side effects.** `range_published` (client-visible "More from this factory is available"), outbox `client_new_update` with that text.

**Acceptance criteria.**
* AC-RNG-01 Given `/ops/factory-ranges/FR-0001`, Then label "Factory F-0042", supplier Yuantuo (ops), client Piotr's team, 12 items, published 2026-09-21.
* AC-RNG-02 Given Piotr on `/app/orders/ORD-2026-0312`, Then the link "More from this factory" opens `/app/orders/ORD-2026-0312/range` showing "Factory F-0042" and 12 items with MOQ and price, and no text matching `/Yuantuo|Dongguan|SUP-|FR-0001/`.
* AC-RNG-03 When Piotr selects "Deck box 100+" qty 3 000 and "Toploader 55pt" qty 10 000 and requests, Then a new request with 2 lines in `negotiating` exists, each with Yuantuo `selected` on the ops board and badge "From factory range"; Piotr's dashboard shows them under Finding factory.
* AC-RNG-04 Given KOFF buyer opens `/app/orders/ORD-2026-0312/range`, Then 404.
* AC-RNG-05 Given Cristina creates a new range for Ecosino × KOFF and uploads `docs/fixtures/leaky-range.pdf` (text contains "Qingdao Ecosino"), When Marko clicks Publish, Then blocked with the match; with `docs/fixtures/clean-range.pdf` it publishes with label "Factory F-0043".

### F-26 Clients admin `/ops/clients/*`

**User story.** As an admin I create client accounts and settings; the client never sees the word organisation (D-02, D-03).

**UI regions.** List; page with Settings card (`name`, `country`, `vat_id`, `commercial_mode`, `pricing_display`, `default_incoterm`, `deposit_pct`, `currency_display` USD fixed, `timezone`), Users card (name, email, role, last seen, status, [Resend invite] [Deactivate]), "Invite user" (email, name, role fixed `client_owner`), Requests and Orders lists, "Products ordered" list.

**Behaviours.** "New client" = create org + first invite in one form. Invite writes `users` (no password), `memberships`, invite token, outbox `auth_invite`. Changing `commercial_mode`/`pricing_display` affects new offers/orders only.

**Acceptance criteria.**
* AC-CLI-01 Given `/ops/clients`, Then "KOFF" (PL, agency_passthrough, factory_plus_fee, 1 user, 7 active lines, 1 order) and "Piotr's team" (PL, agency_passthrough, factory_plus_fee, 1 user, 8 active lines, 1 order).
* AC-CLI-02 When Marko invites `newbuyer@example.pl` on KOFF, Then outbox `auth_invite`, the user row shows "Invited", and AC-AUTH-07 applies.
* AC-CLI-03 When Bogdan (agent) opens `/ops/clients/<KOFF>`, Then the settings are read-only and "Invite user" is hidden.
* AC-CLI-04 When Marko creates client "Pevex" with `pevex@example.hr`, Then an org "Pevex" exists with defaults from 1.3 and `/ops/clients` lists it with 0 lines.

### F-27 Notifications outbox viewer `/ops/outbox`

**User story.** As an admin I see every email the platform would have sent, retry failures, and run the worker on demand (local mode).

**UI regions.** Table: created · template · recipient · subject (rendered) · status · attempts · sent_at · [Preview] (renders the React Email template with the payload in a drawer) · [Retry]. Filters: status, template, recipient. Buttons: "Run worker now" (admin), "Trigger daily digest" (admin). Banner: "Local mode — emails are written to ./var/outbox.log, not sent."

**Behaviours.** Templates render only from client DTOs (T-06); preview markup carries `data-template`. Retry sets `pending`, `send_after=now`. Idempotency: `idempotency_key = template:entity:event-hash`; duplicate inserts are ignored.

**Acceptance criteria.**
* AC-OUT-01 Given the seed, Then the outbox lists ≥ 40 rows all `sent` (seed-generated), and `./var/outbox.log` exists with the same count of lines.
* AC-OUT-02 After AC-NEW-03, Then 4 new rows are `pending`; When "Run worker now" is clicked, Then they are `sent`, the console printed 4 `[outbox]` lines, and the log grew by 4 lines.
* AC-OUT-03 When "Trigger daily digest" is clicked, Then one `ops_daily_digest` row per agent/admin (3) exists whose preview lists the stale items from AC-OPS-01 and the waiting-on-us items.
* AC-OUT-04 Given Preview of a `client_offer_ready` row, Then the rendered HTML contains the offer URL and no supplier name.

### F-28 Cross-cutting: activity timeline, stale flag, history panels, working-day clock

* **Activity on every entity.** Every server action that writes to `requests`, `request_lines`, `products`, `product_specs`, `supplier_participations`, `quotes`, `offers`, `samples`, `orders`, `payments`, `artworks`, `purchase_orders`, `inspections`, `shipments`, `documents`, `comments`, `factory_ranges`, `organizations` (invite) writes ≥1 `activity_events` row in the same transaction, with `visibility` chosen per 3.6 and a `payload` that is itself a **client DTO** when `visibility=client` (so the timeline never leaks by payload). Unit test: a lint-like test walks `src/server/**/actions/*.ts` and fails on any exported action that does not call `recordActivity` (allowlist: auth, search, read-only).
* **Ops timeline component** shows internal + client events; **client History** shows only `visibility=client`.
* **Stale** (B.3) is computed by the worker every tick and stored as `request_lines.stale_since` / `orders.stale_since` (nullable) so lists can filter; the dashboard reads the column. The daily digest lists stale items.
* **History panels** (D-19): client → `ClientPreviousOrdersDto[]` (order ref, qty, unit price shown per pricing_display, delivered date); ops → adds client name, supplier, factory price.
* **Clock injection.** All services take `now()` from `src/server/shared/clock.ts`; `SEED_CLOCK=2026-09-28T09:00:00Z` for seeding; Playwright can set `X-Test-Clock` header in local mode only (`NODE_ENV!=='production'`) to drive expiry/stale scenarios (AC-OFFER-06, AC-CAT-04, AC-REO-03).

**Acceptance criteria.**
* AC-X-01 Given any mutation in F-04…F-27, Then the corresponding entity's ops Timeline shows a new event within the same page load.
* AC-X-02 Given Piotr's History tab on line 01, Then every event's payload keys pass the denylist regex (AC-LINE-08).
* AC-X-03 Given `X-Test-Clock: 2026-10-06T08:00:00Z`, When the worker runs, Then ORD-2026-0312 (last state change 2026-09-23, `in_production`) is flagged stale and appears on `/ops` Stale.

### F-29 Anonymity — see Section 5 (requirements and tests are there).

### F-30 xlsx import — see F-04 (stub scope).

## 5. Anonymity requirements (testable)

The requirement is absolute (D-14): a client must never be able to learn which factory makes their product from anything the platform shows, sends or serves. Enforcement is by construction (blueprint §07 mechanisms 1–9), verified by the tests below. Every item here is a **blocking** CI check.

### 5.1 Tables that must never be read by client code paths

`src/server/client/**` has no import path to these schemas/tables, and no `/app` page or `/api/app` route may return any column from them, directly or via a join:

| Schema | Table |
|---|---|
| supplier | `suppliers` |
| supplier | `supplier_contacts` |
| supplier | `supplier_price_lists` |
| supplier | `supplier_catalogues` |
| supplier | `supplier_performance` |
| supplier | `supplier_participations` |
| supplier | `quotes` |
| supplier | `quote_price_breaks` |
| supplier | `purchase_orders` |
| app | `rfqs` |
| app | `pricing_rules` |
| app | `fx_rates` |
| app | `api_keys` |
| app | `notification_outbox` |
| app | `inspections` (raw) — only the projection `{scheduled_for, inspected_at, result, report_document_id if visible_to_client}` may be exposed |

### 5.2 Columns that must never appear in any client DTO (on otherwise client-visible tables)

| Table | Forbidden columns |
|---|---|
| `organizations` | everything except `default_incoterm`, `pricing_display`, `commercial_mode` (used for wording), `timezone`, `country`; the `name` may be shown only as "your company" context in emails |
| `users` / `memberships` | other orgs' users; agent emails (agent **display name** is allowed) |
| `request_lines` | `cost_model`, `uplift_pct`, `target_price_minor`, `target_confirmed_by`, `selected_participation_id`, `backup_participation_id`, `assigned_agent_id` (expose `agent_name` instead), `stale_since` |
| `products` | `owner_org_id`, `hs_code` is allowed; `visibility` allowed |
| `product_images` | any row with `kind ≠ clean` |
| `offers` | nothing extra, but only `status ∈ {sent, accepted, changes_requested, declined, expired}` are readable (never `draft`) |
| `offer_options` | `participation_id`, `factory_price_minor`, `margin_rule_id`, `internal_note` |
| `samples` | `participation_id`, `deviations_vs_spec` |
| `orders` | `stale_since`; `total_minor` is allowed |
| `order_lines` | `participation_id`, `po_id`, `factory_unit_price_minor` |
| `payments` | `reference` (client sees only paid/pending + date), `recorded_by` |
| `artworks` | `internal_note` |
| `shipments` | `forwarder_contact`, `booking_ref`, `factory_pickup_address`, `forwarder_party` when `supplier`; allowed: forwarder name only when `forwarder_party=client`, mode, container_or_awb, etd, eta_port, port_of_discharge, customs_status, delivered_at |
| `factory_ranges` | `supplier_id`, `pdf_source_file_id`; allowed: `label`, published `pdf_file_id`, items (`name`, `clean_image`, `moq`, `price_minor`, `currency`, `unit`, `made_here`) |
| `documents` | any row with `visibility=internal`; `storage_key`; internal-only kinds (`quote_file`, `price_list`, `catalogue`, `comparison`, `rfq`) regardless of visibility |
| `comments` | any row with `visibility=internal` or `source=whatsapp_log`; `author_email` |
| `activity_events` | any row with `visibility=internal`; `actor_id` (expose `actor_name`) |

### 5.3 Build-time and unit tests

| Test | What it does | Pass condition |
|---|---|---|
| `eslint` `no-restricted-imports` | `src/server/client/**` and `src/app/(client)/**` cannot import `@/db/schema/supplier`, `@/server/ops/**` | lint clean |
| `dto-denylist.test.ts` | Walks every zod schema exported from `src/server/client/dto/*.ts` (recursively, including arrays/objects/unions), collects keys | no key matches **DENYLIST** = `/supplier\|factory_id\|participation\|contact\|wechat\|alibaba\|1688\|uscc\|quote\|po_\|factory_price\|margin\|target_price\|cost_model\|uplift\|internal\|storage_key\|booking/i`. Consequences for naming: `factory_label` and `factory_range` are allowed; the client counts "N contacted · M quoted" are carried as `sourcing_progress: {reached, priced}` (the words contacted/quoted only appear in the rendered label); the payments `reference` column is simply never included; `pi_number`, `eta_port`, `port` are allowed (`po_` requires the underscore) |
| `dto-strict.test.ts` | Every client DTO schema is built with `.strict()` (no passthrough), and every client query maps rows through `Dto.parse()` | grep + runtime check on seed data: parsing every client DTO for every seeded entity succeeds and strips nothing (i.e., no unexpected key was present in the input either — test uses `.strict()` on the pre-parse object) |
| `state-machine.test.ts` | Every state has exactly one milestone; every transition in 3.4 is allowed; a sample of illegal transitions throws `E_ILLEGAL_TRANSITION` | green |
| `leak-check.test.ts` | Fixtures with each pattern class (name, CN name, suffix, URL, WeChat, +86, contact handle, USCC) | each detected; clean fixture passes |
| `activity-coverage.test.ts` | F-28 action coverage | green |
| `messages.test.ts` | No `app.*` string contains organisation/organization/supplier/factory (except allowlisted keys `app.range.label`, `app.milestone.finding_factory`) | green |

### 5.4 Anonymity crawl (Playwright, `e2e/anonymity.spec.ts`)

**Canary.** The seed creates supplier `SUP-0017 ZZLEAKTEST Co., Ltd.` with: `cn_name=ZZ泄漏测试有限公司`, `uscc=91440300ZZLEAKTEST0`, city Dongguan, contact `Leak Tester` channel `wechat` handle `zzleaktest_wx` phone `+86 138 0000 0042`, second contact channel `alibaba` handle `https://zzleaktest.en.alibaba.com`, notes "ZZLEAKTEST canary — never publish"; a participation `quoted` on `REQ-2026-0312-01` with a quote ($0.0500 @ 100 000, FOB Shenzhen, `incoterm_uncertain=true`, valid 2026-09-20, source file `ZZLEAKTEST-quote.xlsx`); an internal comment on the line mentioning "ZZLEAKTEST asked for 50 % deposit"; an internal document on ORD-2026-0312 named `ZZLEAKTEST-quote.xlsx`; an internal activity event payload containing the name; and a `supplier_price_lists` row. Additionally the canary is a `dropped` participation on `REQ-2026-0290-01` (the delivered order's line) so the delivered/catalog paths are covered.

**Forbidden strings** (case-insensitive, also URL-encoded and HTML-entity-encoded): `ZZLEAKTEST`, `ZZ泄漏测试`, `zzleaktest_wx`, `13800000042`, `+86 138 0000 0042`, `91440300ZZLEAKTEST0`, `zzleaktest.en.alibaba.com`, `SUP-0017`, plus every other seeded supplier `legal_name`, `cn_name`, contact handle and phone (the test reads them from the DB at runtime), plus generic patterns `alibaba.com`, `1688.com`, `PO-2026`, `T/T`.

**Procedure.**
1. Sign in as `piotr@example.pl`, then as `buyer@koff.example`; for each:
2. Visit every `/app` URL from 2.2 instantiated for every seeded entity of that org (dashboard, list tabs, every request, every line, every offer, every sample, every order, every order `/range`, catalog, every catalog product, settings), plus every `/api/app` route in 2.4 for the same refs, plus every client document download link found on those pages.
3. For each response: assert HTTP 200 (or 404 for other-org refs, which are also tried: Piotr must get 404 for every KOFF ref and vice versa), assert `document.documentElement.outerHTML` and the raw response body contain none of the forbidden strings, and assert every `<a href>`/`<img src>` on the page, when fetched, also contains none.
4. Additionally: fetch every `data-dto` JSON island embedded in the pages and run the denylist regex on its keys.
5. Sign in as `bogdan@influensia.ro` and open `/ops/lines/REQ-2026-0312-01?tab=sourcing` and assert `ZZLEAKTEST` **is** present — proves the canary exists and the test is not vacuous.

**Pass condition.** Zero occurrences across all pages/responses for both client users; step 5 finds the canary. The test is tagged `@critical` and cannot be skipped (`test.skip` under this tag fails the suite).

### 5.5 "Factory F-0042" label behaviour

* Generated from `sequences('FACTORY_LABEL')` at first publish; stored on `factory_ranges.label`; never editable; never reused; not correlated with `SUP-` refs (seed sets the sequence so that Yuantuo `SUP-0007` gets `F-0042`, demonstrating the decoupling).
* Shown to the client as "Factory F-0042" in: the range page header, the "More from this factory" link, the badge on lines created from the range ("From Factory F-0042"), and the milestone sub-label on those lines. Never shown together with any supplier attribute other than the sanitised items and the sanitised PDF.
* If a second range for the same supplier is published to another client org, it gets a **different** label (e.g. F-0043); labels are per (supplier × org) so clients cannot correlate across companies.
* The label never appears on `/ops` pages as the primary identifier (ops shows supplier name + "published as Factory F-0042").

### 5.6 Files and images

* Client download endpoint resolves keys under `…/client/…` only; a document whose `storage_key` is under `…/internal/…` is 404 for clients even if `visibility` were somehow `client` (defence in depth; a unit test asserts both checks).
* Images: on upload, `sharp` re-encodes to JPEG/PNG/WebP, strips metadata; `files.exif_stripped=true` is required for any image served to clients (query filter).
* Only `product_images.kind=clean` and `documents` of client kinds are serialised; supplier originals keep `kind=supplier_facing`.

---

## 6. Notification events

Local mode: every event inserts a `notification_outbox` row (`channel=email`, `template`, `payload` = client DTO or ops DTO, `idempotency_key`); the worker renders the React Email template, appends a JSON line `{ts, template, to, subject, entity_ref, url}` to `./var/outbox.log`, logs `[outbox] …` to the console, and marks the row `sent`. Nothing is transmitted. Action-needed emails cannot be muted (D-09); v1 has no mute settings at all.

Recipients: **client** = all active users of the entity's org; **agent** = `assigned_agent_id` of the line (or all agents + admins if unassigned); **ops-all** = all agents + admins.

| # | Event (trigger) | Recipient | Template | Subject | Fires when |
|---|---|---|---|---|---|
| N-01 | User invited / invite resent | the invitee | `auth_invite` | "You've been invited to Influensia" | F-26 invite, resend |
| N-02 | Password reset requested | the user | `auth_password_reset` | "Reset your password" | F-01 |
| N-03 | Request submitted | client (creator) | `client_request_received` | "We received your request {REQ}" | 3.4 draft→submitted (portal); agent-on-behalf only when ticked |
| N-04 | Request submitted | ops-all | `ops_new_request` | "New request {REQ} from {client} ({n} lines)" | same; also reorder and factory-range requests (subject prefixed "Repeat order" / "Range request") |
| N-05 | Milestone changed (any line/order whose `milestoneFor(state)` changed) | client | `client_milestone_changed` | "{name}: {milestone label}" | every transition where milestone differs, **except** when a more specific client template fires in the same transaction (N-06, N-08, N-10, N-12, N-14) |
| N-06 | Offer sent | client | `client_offer_ready` | "Price ready — {name}" | 3.4 → `offer_ready` |
| N-07 | Sample shipped | client | `client_sample_shipped` | "Your sample is on its way — {name}" | sample `shipped` |
| N-08 | Sample received (awaiting decision) | client | `client_sample_ready` | "Sample received — please approve or reject" | sample `received` |
| N-09 | Order confirmed | client | `client_order_confirmed` | "Order confirmed — {ORD}" | order created |
| N-10 | Payment due (PI published / balance invoice on QC pass) | client | `client_payment_due` | "Payment due — {kind} {amount} for {ORD}" | `order_confirmed→awaiting_deposit`; `qc_inspection→awaiting_balance` |
| N-11 | Artwork requested / changes requested / approved | client | `client_artwork_requested` · `client_artwork_changes` · `client_artwork_approved` | "Artwork needed for {ORD}" / "Artwork changes requested" / "Artwork approved" | `→awaiting_artwork`; agent decisions |
| N-12 | QC result | client | `client_qc_result` | "Quality check passed — {ORD}" / "Quality check: rework in progress" | inspection recorded |
| N-13 | ETA changed | client | `client_eta_changed` | "ETA update — {ORD}: {new ETA}" | `exworks_eta` or `eta_port` changes after first set |
| N-14 | Delivered (awaiting confirmation) | client | `client_delivery_confirm` | "Delivered — please confirm {ORD}" | → `delivered` |
| N-15 | Client-visible update posted by agent | client | `client_new_update` | "Update on {name}" | F-19 client update; F-25 range published |
| N-16 | Document published (kinds not covered by N-10/N-12) | client | `client_document_published` | "New document: {kind} for {ref}" | F-23 publish |
| N-17 | Agent asked the client (`needs_input`) | client | `client_input_needed` | "We need your input — {name}" | F-19 Ask the client |
| N-18 | Offer expired | client | `client_offer_expired` | "Price expired — we'll send a new one" | worker |
| N-19 | Client action taken (offer accept/changes/decline, sample approve/reject, artwork upload, delivery confirmed, change request, cancellation) | agent | `ops_client_action` | "{client}: {action} on {ref}" | each client decision |
| N-20 | Client question (Ask box) | agent | `ops_client_question` | "Question from {client} on {ref}" | F-06/F-07/F-10 Ask |
| N-21 | Daily digest | each agent/admin | `ops_daily_digest` | "Daily digest — {n} stale, {m} waiting on us, {k} unassigned" | 07:00 Europe/Zagreb (worker) or manual trigger; lists per section with links; "Mine" for agents, "All" for admins |
| N-22 | Leak check blocked a publish | the acting agent + admins | `ops_leak_blocked` | "Publish blocked on {ref}: supplier identifier found" | F-23/F-18/F-19/F-25 block |

Template rules: client templates take **only** client DTOs (type-enforced: their props are typed as `Client*Dto`); every client email contains one deep link to the relevant `/app` page and the line "Reply by using 'Ask about this order' in the app." Ops templates link to `/ops`.

---

## 7. Seed dataset

`pnpm db:reset` produces exactly this. The seed runs through the **domain services** (same functions the UI calls) with `SEED_CLOCK` advanced step by step, so activity events and outbox rows are generated naturally; afterwards outbox rows are marked `sent` (sent_at = created_at) and `./var/outbox.log` is written. Placeholder files are generated by the seed (one-page PDF with the filename as text; 800×600 JPG/PNG with the filename as text). All money USD unless stated. "Clock" values below are the timestamps to use (09:00 UTC on that date unless a time is given). Seed "today" = **2026-09-28**.

### 7.1 Organisations

| Key | name | type | country | commercial_mode | pricing_display | default_incoterm | deposit_pct | timezone |
|---|---|---|---|---|---|---|---|---|
| AGENCY | Influensia | agency | RO | — | — | FOB | — | Europe/Zagreb |
| KOFF | KOFF | client | PL | agency_passthrough | factory_plus_fee | FOB | 30 | Europe/Warsaw |
| PIOTR | Piotr's team | client | PL | agency_passthrough | factory_plus_fee | FOB | 30 | Europe/Warsaw |

### 7.2 Users (password for all: `Password123!`)

| email | name | org | role |
|---|---|---|---|
| marko@influensia.ro | Marko | AGENCY | admin |
| bogdan@influensia.ro | Bogdan | AGENCY | agent |
| cristina@influensia.ro | Cristina | AGENCY | agent |
| piotr@example.pl | Piotr | PIOTR | client_owner |
| buyer@koff.example | Anna (KOFF) | KOFF | client_owner |

### 7.3 Pricing rules and FX

| category | uplift_pct | margin_pct | fee_pct | rounding |
|---|---|---|---|---|
| packaging | 20 | 15 | 10 | 4 dp |
| fitness | 20 | 18 | 10 | 2 dp |
| garden | 20 | 15 | 8 | 2 dp |
| lighting | 20 | 18 | 10 | 2 dp |
| safety | 20 | 20 | 10 | 3 dp |
| seasonal | 20 | 15 | 8 | 2 dp |
| default | 20 | 15 | 10 | 2 dp |

`fx_rates`: `2026-09-21 USD/CNY 6.6933 source=tradingeconomics`; `2026-06-15 USD/CNY 7.1800`; `2026-09-21 USD/EUR 0.9200`.

Sequences after seed: `REQ 2026 → 0326`, `ORD` derived, `PRD → 0016`, `SUP → 0018`, `FACTORY_LABEL → 43`, `FR → 0002`.

### 7.4 Suppliers (`supplier` schema)

| ref | legal_name | cn_name | type_verdict (source) | grade | city | registered / capital | ports | contacts (name · channel · handle · phone) | notes |
|---|---|---|---|---|---|---|---|---|---|
| SUP-0001 | Qingdao Ecosino Industry Co., Ltd. | 青岛亿科盛诺实业有限公司 | manufacturer (baidu) | B | Qingdao | 2012 / 5 M CNY | Qingdao | Benson Zhao · alibaba · ecosino-benson · — | Payment 50/50 or 30/70 +$0.1/set. `disclosed_to_org_ids=[KOFF]` (client forwarder on ORD-2026-0290) |
| SUP-0002 | Qingdao Xinyi Metal Products Co., Ltd. | — | manufacturer (baidu) | C | Qingdao | — | Qingdao | David Yang · alibaba · — | — |
| SUP-0003 | Linyi Tongfu Safety Products Co., Ltd. | 临沂通福劳保用品有限公司 | manufacturer (baidu) | B | Linyi | 2015 / 2 M CNY | Qingdao, Ningbo | Tongfu Wang · alibaba · tongfu-wang | — |
| SUP-0004 | Nantong Stylish Lighting Co., Ltd. | — | manufacturer (alibaba_profile) | B | Nantong | — | Shanghai, Ningbo | Sarah Ji · alibaba · sarah-ji | — |
| SUP-0005 | Yiwu Mali Tree Co., Ltd. | 义乌马里圣诞树有限公司 | manufacturer (baidu) | C | Yiwu | — | Ningbo | Sam Sun · alibaba · sam-sun | 962 tips version |
| SUP-0006 | Dongyang Xinhong Crafts Factory | 东阳鑫宏工艺品厂 | unchecked (sheet_import) | — | Dongyang | — | Ningbo | — · 1688 · xinhong1688 | Chinese-only |
| SUP-0007 | Dongguan Yuantuo Packaging Products Co., Ltd. | 东莞市源拓包装制品有限公司 | manufacturer (baidu) | B | Dongguan | 2011 / 3 M CNY | Shenzhen | Daryl Yang · email · daryl@yuantuo.example ; Daryl · wechat · daryl_yt | Declares g/100 weights 58/51/100 |
| SUP-0008 | Yiwu Suti Crafts Co., Ltd. | 义乌市苏媞工艺品有限公司 | trading (baidu) | D | Yiwu | 2026-03 / 100 k CNY | Ningbo | Tim Wang · alibaba · tim-suti | 6-month-old trader; double-wall micron suspicion |
| SUP-0009 | Yili (依立) — verify legal name | 依立 | unchecked (sheet_import) | — | — | — | — | — · 1688 · yili1688 | Quote B; quotes per bag of 100 |
| SUP-0010 | Guangdong Dr. Card Culture Co., Ltd. | 广东卡博士文化有限公司 | manufacturer (baidu) | C | Guangzhou | — | Shenzhen, Guangzhou | Cathy · wechat · drcard_cathy | Same group as Guangdong Kepu |
| SUP-0011 | Unidentified — Quote D (verify) | — | unchecked (other) | — | — | — | — | — · email · quoted@anon.example | Anonymous xlsx, MOQ 100 000, 10/10 SKUs |
| SUP-0012 | Huizhou Boyuan Plastic Products | 惠州博源塑胶制品 | manufacturer (baidu) | — | Huizhou | — | Shenzhen | John · wechat · boyuan_john ; John · 1688 · boyuan1688 | — |
| SUP-0013 | Wenzhou Fuli Packaging Co., Ltd. | 温州富利包装有限公司 | manufacturer (baidu) | — | Wenzhou | — | Ningbo | Yulia Yang · alibaba · yulia-fuli | — |
| SUP-0014 | Zhongshan Jinou Hardware Products Co., Ltd. | 中山金瓯五金制品有限公司 | manufacturer (baidu) | — | Zhongshan | — | Shenzhen | 李小姐 (A金瓯卡具) · wechat · — · 13318425160 ; — · 1688 · jinou1688 | Metal only |
| SUP-0015 | Shandong Zhongjian Steel Structure Co., Ltd. | — | manufacturer (baidu) | — | Jinan | — | Qingdao | Lily · alibaba · zhongjian-lily | — |
| SUP-0016 | Taizhou Sunshine Garden Products Co., Ltd. | — | unchecked (sheet_import) | — | Taizhou | — | Ningbo | Vicky Zhong · alibaba · vicky-zhong | resin sheds |
| SUP-0017 | **ZZLEAKTEST Co., Ltd.** | ZZ泄漏测试有限公司 | manufacturer (other) | C | Dongguan | 2020 / 1 M CNY | Shenzhen | Leak Tester · wechat · zzleaktest_wx · +86 138 0000 0042 ; Leak Tester · alibaba · https://zzleaktest.en.alibaba.com | uscc `91440300ZZLEAKTEST0`; "ZZLEAKTEST canary — never publish"; one `supplier_price_lists` row (`ZZLEAKTEST-pricelist-2026.pdf`, internal) |

`supplier_performance`: SUP-0001 `orders_count=0` until AC-ORD-05 runs (seed leaves the delivered order unconfirmed); all others 0.

### 7.5 Products

| ref | name | category | unit | visibility | reference price (all-in) | ref MOQ | incoterm/port | spec v | valid until | specs |
|---|---|---|---|---|---|---|---|---|---|---|
| PRD-0001 | Boltless steel shelving 5-tier 180×90×40 black | garden | set | catalog | $8.90 | 1 000 | FOB Qingdao | 2 | 2026-12-31 | v1 (2026-06-05): 180×90×40 cm, 5 MDF shelves, 175 kg/shelf, powder-coated black; v2 (2026-06-10): + 875 kg total, carton 2/set |
| PRD-0002 | Work gloves red latex crinkle, size 10 | safety | pair | catalog | $0.26 | 10 000 | FOB Ningbo | 1 | 2026-12-31 | 13 g polyester liner, red crinkle latex palm, size 10, EN 388 2121X |
| PRD-0003 | Icicle lights 500 LED 24 m | lighting | set | catalog | $9.90 | 1 000 | FOB Ningbo | 1 | 2026-12-31 | 500 LED warm white, 24 m, IP44, EU plug, 8 modes |
| PRD-0004 | Card sleeves 66×91 mm 100 µm | packaging | pcs | catalog | $0.062 | 100 000 | FOB Shenzhen | 1 | 2026-12-31 | 66×91 mm, 100 µm single wall, PP virgin, PVC-free, 100/bag |
| PRD-0005 | Standard sleeves 66×91 mm 80 µm | packaging | pcs | private | — | | | 1 | | as PRD-0004 with 80 µm |
| PRD-0006 | Japanese size sleeves 62×89 mm 100 µm | packaging | pcs | private | — | | | 1 | | 62×89 mm, 100 µm |
| PRD-0007 | Team bag 66×91 mm | packaging | pcs | private | — | | | 1 | | 66×91 mm, 50 µm, clear, resealable |
| PRD-0008 | Toploader 35pt 76.2×103.2 mm | packaging | pcs | private | — | | | 1 | | panel ≥ 0.305 mm, PVC-free (PET) |
| PRD-0009 | Toploader 130pt | packaging | pcs | private | — | | | 1 | | PET, 130pt |
| PRD-0010 | Magnetic one-touch holder 35pt | packaging | pcs | private | — | | | 1 | | pull ≥ 1.5 kg, UV-protected |
| PRD-0011 | Album/binder 9-pocket, 360 pockets | packaging | pcs | private | — | | | 1 | | 20 PP pages side-load, zip |
| PRD-0012 | Metal apex garden shed 201×181×190 | garden | set | private | — | | | 1 | | galvanised 0.25 mm, apex roof |
| PRD-0013 | Resin garden shed 130×192×198 | garden | set | private | — | | | 1 | | PP resin, Keter-type |
| PRD-0014 | Large metal store 460×312×194 | garden | set | private | — | | | 1 | | galvanised, double door |
| PRD-0015 | Christmas tree 180 cm 507 tips PVC | seasonal | pcs | private | — | | | 1 | | 180 cm, 507 tips, PVC, metal stand |

Images: PRD-0001…0004 each have one `clean` image (placeholder) and one `supplier_facing` image. Client reference images are `documents kind=reference_image` on the line (e.g. `allegro-sleeves-ref.jpg` on 0312-01), not `product_images`; an agent may promote one to `product_images kind=client_reference`. The camping chair and the LED floodlight have **no** product (created on freeze).

### 7.6 Requests and lines

| request | org | source | client_ref | submitted | note |
|---|---|---|---|---|---|
| REQ-2026-0290 | KOFF | import | SHELVING-0290 | 2026-06-01 | "5-tier boltless, black, MDF shelves" |
| REQ-2026-0301 | KOFF | portal | — | 2026-09-10 | "Red latex gloves like the Allegro link, size 10" |
| REQ-2026-0305 | KOFF | portal | — | 2026-09-12 | — |
| REQ-2026-0312 | PIOTR | import | ORDER-2026-#312 | 2026-09-01 | "Photos are form reference, not branding. FOB USD per single piece." — documents: `Order-312-list.xlsx` (kind other, client) |
| REQ-2026-0318 | KOFF | agent_on_behalf (Cristina) | — | 2026-09-14 | WhatsApp log "Bogdan: Springos lookalike, 180 cm" |
| REQ-2026-0321 | KOFF | import | SHEDS-3210 | 2026-09-18 | "3 models, see Allegro links" |
| REQ-2026-0322 | KOFF | portal | — | draft (created 2026-09-26) | — |
| REQ-2026-0325 | KOFF | portal | — | 2026-09-27 | "Bogdan: ASAP, at least a top 10 of this type" |

Lines (`state` / `last_state_change_at` / agent / qty / links):

| line | product | name | qty | unit | state | last change | agent | client_sku | links / images | extra |
|---|---|---|---|---|---|---|---|---|---|---|
| REQ-2026-0290-01 | PRD-0001 | Boltless steel shelving 5-tier 180×90×40 black | 1 000 | set | `delivered` (mirrored from ORD-2026-0290) | 2026-08-28 | Bogdan | — | allegro.pl/oferta/regal-metalowy-180x90x40 | spec_version 2; selected SUP-0001; backup SUP-0002; `artwork_required=false` |
| REQ-2026-0301-01 | PRD-0002 | Work gloves red latex crinkle, size 10 | 10 000 | pair | `offer_ready` | 2026-09-26 | Bogdan | — | allegro.pl/oferta/rekawiczki-rekawice-robocze-r10-latex-10-par-wytrzymale-porowate-red-lateks-12539547048 | spec v1 frozen 2026-09-12; cost 0.17 target 0.204 confirmed; selected SUP-0003; `artwork_required=true` (printed cuff) |
| REQ-2026-0305-01 | PRD-0003 | Icicle lights 500 LED 24 m | 1 000 | set | `negotiating` | 2026-09-24 | Bogdan | — | allegro.pl/oferta/sople-500-led-24m | spec v1 2026-09-13; cost 7.10 target 8.52 |
| REQ-2026-0312-01 | PRD-0004 | Standard sleeves 66×91 mm, 100 µm, PP, 100/bag | 100 000 | pcs | `in_production` (mirrored) | 2026-09-23 | Bogdan | KOFF-312-01 | image `allegro-sleeves-ref.jpg` | spec v1 2026-09-03; cost_model est 0.031 (material 0.004, process 0.020, packaging 0.004, overhead 10 %), uplift 20, target 0.037 confirmed Bogdan 2026-09-04; selected SUP-0007, backup SUP-0011; `artwork_required=true`; `sample_required=true` |
| REQ-2026-0312-02 | PRD-0005 | Standard sleeves 66×91 mm, 80 µm | 100 000 | pcs | `sampling` | 2026-09-19 | Bogdan | KOFF-312-02 | — | spec v1 2026-09-03; target 0.032; selected SUP-0007 |
| REQ-2026-0312-03 | PRD-0006 | Japanese size 62×89 mm, 100 µm | 50 000 | pcs | `negotiating` | 2026-09-22 | Bogdan | KOFF-312-03 | — | spec v1 2026-09-03; target 0.036 |
| REQ-2026-0312-05 | PRD-0007 | Team bag 66×91 | 50 000 | pcs | `quotes_in` | 2026-09-23 | Bogdan | KOFF-312-05 | — | spec v1; target 0.009 |
| REQ-2026-0312-11 | PRD-0008 | Toploader 35pt 76.2×103.2 mm, PVC-free | 20 000 | pcs | `quotes_in` | 2026-09-24 | Bogdan | KOFF-312-11 | — | spec v1; target 0.13 |
| REQ-2026-0312-14 | PRD-0009 | Toploader 130pt | 5 000 | pcs | `rfq_out` | 2026-09-12 | Bogdan | KOFF-312-14 | — | spec v1; target 0.30 — **stale** |
| REQ-2026-0312-20 | PRD-0010 | Magnetic one-touch holder 35pt (pull ≥ 1.5 kg) | 5 000 | pcs | `quotes_in` | 2026-09-23 | Bogdan | KOFF-312-20 | — | spec v1; target 1.90 |
| REQ-2026-0312-26 | PRD-0011 | Album/binder 9-pocket, 360 pockets, PP pages | 2 000 | pcs | `spec_frozen` | 2026-09-17 | Bogdan | KOFF-312-26 | — | spec v1 2026-09-17 — **stale** |
| REQ-2026-0318-01 | PRD-0015 | Christmas tree 180 cm 507 tips PVC | 2 000 | pcs | `quotes_in` | 2026-09-16 | Cristina | — | allegro.pl/oferta/choinka-sztuczna-180cm-springos | spec v1 2026-09-15 — **stale** |
| REQ-2026-0321-01 | PRD-0012 | Metal apex shed 201×181×190 | 200 | set | `quotes_in` | 2026-09-25 | Marko | SHEDS-3210-01 | allegro.pl/oferta/domek-ogrodowy-narzedziowy-metalowy-na-narzedzia-vector-7x6-201x190cm-garaz-18438914106 | spec v1 2026-09-19 |
| REQ-2026-0321-02 | PRD-0013 | Resin shed 130×192×198 | 200 | set | `quotes_in` | 2026-09-25 | Marko | SHEDS-3210-02 | allegro.pl/oferta/domek-ogrodowy-narzedziowy-keter-manor-4x6s-schowek-na-narzedzia-192x130cm-12826867592 | spec v1 |
| REQ-2026-0321-03 | PRD-0014 | Large metal store 460×312×194 | 50 | set | `quotes_in` | 2026-09-25 | Marko | SHEDS-3210-03 | allegro.pl/oferta/domek-narzedziowy-metalowy-garderis-312-460-194-cm-13-2-m2-18789627689 | spec v1 |
| REQ-2026-0322-01 | — | ULFUR ultralight camping chair 4-leg hub | 500 | pcs | `draft` | 2026-09-26 | — | — | allegro.pl/oferta/krzeslo-turystyczne-ulfur-ultralight ; alibaba.com/product-detail/ultralight-camping-chair_1601234567890.html | — |
| REQ-2026-0325-01 | — | LED floodlight on tripod SmartLED 150 W 16500 lm IP65 | 300 | pcs | `submitted` | 2026-09-27 | **unassigned** | — | allegro.pl/produkt/lampa-na-stojaku-smartled-150w-16500-lm-ip65-bialy-neutralny-214f71dc-85af-4abb-a679-953740ee42fc | — |

### 7.7 Participations and quotes

Format: supplier · status (reason) · first/last contact · quote(s): `currency unit incoterm port · breaks · MOQ · lead · valid · terms · deviations · flags`. Normalised USD/pc uses FX 6.6933.

**REQ-2026-0290-01 (shelving)**
* SUP-0001 Ecosino · `selected` · 2026-06-03 / 2026-06-14 · v1: USD set FOB Qingdao · 500→7.90, 1000→7.52 · MOQ 500 · 35 d · valid **2026-10-31** (re-confirmed 2026-09-10, so reorder skips sourcing) · "50/50 or 30/70 +$0.1/set" · —
* SUP-0002 Xinyi · `dropped` ("no MDF shelf option") · 2026-06-03 / 2026-06-09 · v1: USD set FOB Qingdao · 1000→7.90 · MOQ 1000 · 30 d · valid 2026-07-31
* SUP-0017 ZZLEAKTEST · `dropped` ("canary") · 2026-06-03 / 2026-06-04 · no quote

**REQ-2026-0301-01 (gloves)**
* SUP-0003 Tongfu · `selected` · 2026-09-13 / 2026-09-25 · v1: USD pair EXW Linyi · 10000→0.205 · MOQ 10 000 · 25 d · valid 2026-10-31 · "30/70 T/T" · flags: none (EXW noted, offer converts to FOB Ningbo)

**REQ-2026-0305-01 (icicle lights)**
* SUP-0004 Stylish · `negotiating` · 2026-09-14 / 2026-09-24 · v1 (2026-09-17): USD set FOB Ningbo · 500→9.33, 1000→8.90, 3000→8.70 · MOQ 500 · 30 d · valid 2026-10-15; v2 (2026-09-24): 1000→8.40 · same terms

**REQ-2026-0312-01 (sleeves 100 µm)** — 9 rows
* SUP-0007 Yuantuo · `selected` · 2026-09-05 / 2026-09-26 · v1 (2026-09-15): USD pcs FOB Shenzhen · 100000→0.0539 · MOQ 100 000 · 30 d · valid 2026-09-30 · "T/T 30/70" · dev "none at spec thickness" · weight 58 g/100 · file `Yuantuo-quote-2026-09-15.xlsx`
* SUP-0008 Suti · `dropped` ("6-month-old trader; double-wall micron suspicion") · 2026-09-05 / 2026-09-05 · v1 (2026-09-06): USD bag(pack_qty 100) FOB Ningbo · 3000 bags→3.20 (= 0.032/pc) · MOQ 3 000 bags · 8–10 d · valid 2026-09-08 · "50 % deposit" · flags `expired`, `supplier_trading`, `excluded_status`
* SUP-0009 Yili · `quoted` · 2026-09-06 / 2026-09-16 · v1: USD bag(100) EXW — · 3000 bags→3.48 (= 0.0348/pc) · MOQ 300 000 pcs · — · valid 2026-10-15 · dev "states 80/100 µm film" · `incoterm_uncertain=true` · flags `incoterm_uncertain`, `supplier_unchecked`
* SUP-0010 Dr. Card · `quoted` · 2026-09-06 / 2026-09-20 · v1: USD pack(100) FOB Shenzhen · 1000 packs→7.45 (= 0.0745/pc) · MOQ 1 000 packs · 40–45 d · valid 2026-10-20 · flags none
* SUP-0011 Quote D · `backup` ("safe 10/10 fallback, 2.5×") · 2026-09-07 / 2026-09-14 · v1: USD pcs FOB Shenzhen · 100000→0.076 · MOQ 100 000 · 40 d · valid 2026-10-31 · file `QuoteD-anon.xlsx` · flags `supplier_unchecked`
* SUP-0012 Boyuan · `contacted` · 2026-09-05 / 2026-09-18 · no quote (stale: 10 d)
* SUP-0013 Fuli · `contacted` · 2026-09-13 / 2026-09-13 · no quote (stale: 15 d ⚠)
* SUP-0014 Jinou · `cannot_make` ("metal only") · 2026-09-05 / 2026-09-05
* SUP-0017 ZZLEAKTEST · `quoted` · 2026-09-08 / 2026-09-12 · v1: USD pcs FOB Shenzhen (`incoterm_uncertain=true`) · 100000→0.0500 · MOQ 100 000 · 30 d · valid **2026-09-20** · file `ZZLEAKTEST-quote.xlsx` · flags `expired`, `incoterm_uncertain`

**REQ-2026-0312-02 (80 µm)**: SUP-0007 `selected` (v1 2026-09-15: 100000→0.045, valid 2026-09-30, weight 51 g/100) · SUP-0008 `dropped` (v1: 0.028 expired) · SUP-0009 `quoted` (0.030/pc, EXW uncertain)
**REQ-2026-0312-03 (Japanese)**: SUP-0007 `negotiating` (v1: 50000→0.052, valid 2026-09-30) · SUP-0008 `dropped` (v1: 0.033 expired)
**REQ-2026-0312-05 (team bag)**: SUP-0007 `quoted` (v1: 50000→0.0083 · dev "declared 50 µm — deviation vs spec" · weight 20 g/100)
**REQ-2026-0312-11 (toploader 35pt)**: SUP-0007 `quoted` (v1: 20000→0.15) · SUP-0008 `quoted` (v1: 0.14, expired) · SUP-0012 `contacted` (2026-09-18) → "3 contacted · 2 quoted"
**REQ-2026-0312-14 (toploader 130pt)**: SUP-0007 `contacted` (2026-09-12) · SUP-0012 `contacted` (2026-09-12) → "2 contacted · 0 quoted"; `rfqs` row sent 2026-09-12 recipients 2
**REQ-2026-0312-20 (magnetic holder)**: SUP-0007 `quoted` (v1: 5000→2.10 · 35 d)
**REQ-2026-0312-26 (binder)**: none
**REQ-2026-0318-01 (tree)**: SUP-0005 Mali `quoted` (v1 2026-09-16: USD pcs FOB Ningbo · 2000→59.99 · MOQ 500 · 45 d · valid 2026-10-31 · dev "962 tips, not 507") · SUP-0006 Xinhong `quoted` (v1 2026-09-16: **CNY** pcs EXW Dongyang · 2000→254.00 (→ $37.95) · MOQ 1 000 · 40 d · valid 2026-10-31 · flags `supplier_unchecked`)
**REQ-2026-0321-01 (metal apex shed)**: SUP-0015 Zhongjian `cannot_make` ("makes plastic sheds only") · SUP-0001 Ecosino `quoted` (v1 2026-09-25: USD set FOB Qingdao · 200→183.00 · MOQ 100 · 45 d · valid 2026-11-15 · "50/50 or 30/70 +$0.1/set"; SEED_CONTEXT's "$8.30" belongs to the shelving tab — do **not** use it here)
**REQ-2026-0321-02 (resin shed)**: SUP-0016 Sunshine `quoted` (v1 2026-09-25: USD set FOB Ningbo · 200→96.00 · MOQ 100 · 40 d · valid 2026-11-15 · flags `supplier_unchecked`)
**REQ-2026-0321-03 (large store)**: SUP-0001 Ecosino `contacted` (2026-09-25)
**REQ-2026-0325-01**: none

### 7.8 Offers

| ref | line | status | sent / decided | valid_until | incoterm/port | options |
|---|---|---|---|---|---|---|
| OFR-2026-0290-01-v1 | 0290-01 | accepted (A) | 2026-06-14 / 2026-06-15 | 2026-06-30 | FOB Qingdao | A: SUP-0001 · ladder 500→8.20, 1000→7.52 · MOQ 500 · 35 d · fee $300 · factory 6.90 · dev "none" · terms "30 % deposit + fee on order, 70 % after QC pass" · sample_required=false |
| OFR-2026-0301-01-v1 | 0301-01 | **sent** | 2026-09-26 / — | 2026-10-10 | FOB Ningbo | A: SUP-0003 · 10000→0.26 · MOQ 10 000 · 25 d · fee $150 · factory 0.205 · dev "none; EN 388 2121X on request" · sample_required=false |
| OFR-2026-0312-01-v1 | 0312-01 | accepted (A) | 2026-09-08 / 2026-09-08 | 2026-09-22 | FOB Shenzhen | A: SUP-0007 · 100000→0.062 · MOQ 100 000 · 30 d · fee $540 · factory 0.0539 · dev "none at spec thickness" · sample $45 paid by client · sample_required=true ; B: SUP-0011 · 100000→0.085 · MOQ 100 000 · 40 d · fee $540 · factory 0.076 · dev "supplier declares 10/10 SKUs; thickness to verify on sample" |
| OFR-2026-0312-02-v1 | 0312-02 | accepted (A) | 2026-09-18 / 2026-09-19 | 2026-10-02 | FOB Shenzhen | A: SUP-0007 · 100000→0.052 · MOQ 100 000 · 30 d · fee $450 · factory 0.045 · dev "none" · sample $45 client · sample_required=true |

### 7.9 Samples

| ref | line | status | ordered / shipped / received / decided | courier · tracking | cost · paid_by | photos (docs, client) |
|---|---|---|---|---|---|---|
| SMP-2026-0312-01-1 | 0312-01 | approved | 2026-09-10 / 2026-09-15 / 2026-09-18 / 2026-09-19 (Piotr) | DHL · JD014600012345678890 | $45 · client (payment kind `sample` paid 2026-09-11 ref `WIRE-0911`) | `Sample-photo-1.jpg`, `Sample-photo-2.jpg` |
| SMP-2026-0312-02-1 | 0312-02 | **received** | 2026-09-20 / 2026-09-23 / 2026-09-26 / — | DHL · JD014600012345678901 | $45 · client (paid 2026-09-21 ref `WIRE-0921`) | none |

### 7.10 Orders

**ORD-2026-0290** (KOFF, request 0290, offer OFR-2026-0290-01-v1) · commercial_mode agency_passthrough · pricing_display factory_plus_fee · FOB Qingdao · PI `PI-ORD-2026-0290` · confirmed 2026-06-15 · state **`delivered`** (delivered_at 2026-08-28; client has not confirmed) · total $7,820.00.

| Child | Values |
|---|---|
| order_lines | 01: PRD-0001 v2 · 1 000 set · unit 7.52 · fee 300 · SUP-0001 · PO-2026-0290-01 |
| payments | deposit 30 % $2,256.00 agency due 2026-06-20 **paid** 2026-06-20 `WIRE-0620` · fee $300.00 paid 2026-06-20 `WIRE-0620` · balance 70 % $5,264.00 due 2026-07-13 paid 2026-07-09 `WIRE-0709` |
| artworks | none (`artwork_required=false`) |
| purchase_orders | PO-2026-0290-01 · SUP-0001 · $6,900.00 · "30/70 T/T" · exworks_eta 2026-07-10 · status `completed` |
| inspections | scheduled 2026-07-08 · inspector "Bogdan" · inspected 2026-07-08 · AQL 2.5 · sample 125 · **pass** · 0 critical 3 minor · report `QC-report-ORD-2026-0290.pdf` · `visible_to_client=true` |
| shipments | forwarder "Rohlig Suus (client)" · `forwarder_party=client` · booking `RS-2026-07-4471` · sea · `MSKU4471021` · cargo_ready 2026-07-10 · exworks_shipped 2026-07-11 · ETD 2026-07-14 · port Gdańsk · ETA 2026-08-26 · arrived 2026-08-26 · customs `cleared` 2026-08-27 · delivered 2026-08-28 |
| state history | order_confirmed 06-15 → awaiting_deposit 06-15 → in_production 06-20 (artwork not required) → qc_inspection 07-06 → awaiting_balance 07-08 → forwarder_booked 07-10 → shipped_exworks 07-11 → departed_origin 07-14 → eu_port_customs 08-26 → delivered 08-28 |

**ORD-2026-0312** (PIOTR, request 0312, offer OFR-2026-0312-01-v1) · agency_passthrough · factory_plus_fee · FOB Shenzhen · PI `PI-ORD-2026-0312` · confirmed 2026-09-20 · state **`in_production`** (since 2026-09-23) · total $6,740.00.

| Child | Values |
|---|---|
| order_lines | 01: PRD-0004 v1 · 100 000 pcs · unit 0.062 · fee 540 · SUP-0007 · PO-2026-0312-01 · `artwork_required=true` |
| payments | deposit 30 % $1,860.00 agency due 2026-09-25 **paid** 2026-09-22 `WIRE-0922-A` · fee $540.00 paid 2026-09-22 `WIRE-0922-A` · balance 70 % $4,340.00 **pending**, due_on null ("on QC pass") |
| artworks | line 01: `Artwork-sleeves-v1.pdf` (client upload 2026-09-22) · dieline `Dieline-sleeve-66x91.pdf` (published 2026-09-20) · status **approved** 2026-09-23 by Bogdan |
| purchase_orders | PO-2026-0312-01 · SUP-0007 · $5,390.00 · "T/T 30/70" · exworks_eta **2026-10-25** · status `in_production` · doc `PO-2026-0312-01.pdf` (internal) |
| inspections | one row: scheduled_for **2026-10-22** · inspector "Cristina" · result null · `visible_to_client=false` |
| shipments | one draft row: mode sea · port Gdańsk · `eta_port` **2026-11-18** (planned) · everything else null |
| state history | order_confirmed 09-20 → awaiting_deposit 09-20 (PI published) → awaiting_artwork 09-22 (payments) → in_production 09-23 |

### 7.11 Factory range

FR-0001 · label **Factory F-0042** · supplier SUP-0007 · org PIOTR · PDF `Factory-F-0042-range.pdf` (client copy) · approved/published by Marko 2026-09-21 · items (name · MOQ · price USD · unit · made_here):
Standard sleeves 66×91 100 µm · 100 000 · 0.058 · pcs · yes — Standard sleeves 66×91 80 µm · 100 000 · 0.049 · yes — Standard sleeves 66×91 60 µm · 100 000 · 0.041 · yes — Japanese 62×89 100 µm · 50 000 · 0.056 · yes — Team bag 66×91 · 50 000 · 0.0095 · yes — Toploader 35pt · 20 000 · 0.16 · yes — Toploader 55pt · 20 000 · 0.19 · yes — Toploader 100pt · 10 000 · 0.28 · yes — Toploader 130pt · 5 000 · 0.34 · yes — Magnetic holder 35pt · 5 000 · 2.25 · unknown — Deck box 100+ · 3 000 · 0.95 · no (sourced by them) — Binder 9-pocket 360 · 2 000 · 6.80 · unknown. **12 items.**

### 7.12 Client-visible feed for REQ-2026-0312-01 / ORD-2026-0312 (newest first — AC-LINE-02 asserts this list verbatim)

| Date | Text | Source |
|---|---|---|
| 23 Sep 2026 | In production — ex-works ETA 25 Oct 2026 | state_changed |
| 23 Sep 2026 | Deposit and fee received, artwork approved — production starts | client update (Bogdan) |
| 20 Sep 2026 | Order confirmed — invoice PI-ORD-2026-0312 issued | state_changed |
| 19 Sep 2026 | Sample approved | sample_decided (Piotr) |
| 15 Sep 2026 | Sample shipped — DHL JD014600012345678890 | sample_status_changed |
| 8 Sep 2026 | Offer accepted (Option A) | offer_decided (Piotr) |
| 8 Sep 2026 | Price ready — offer v1 | offer_sent |
| 3 Sep 2026 | Spec confirmed: 66×91 mm, 100 µm single wall, PP virgin, 100/bag — Finding factory | spec_frozen |
| 2 Sep 2026 | In review — your contact is Bogdan | state_changed |
| 1 Sep 2026 | Received | request_submitted |

### 7.13 Comments (beyond 7.12)

| Entity | visibility · kind · source | author · date | body |
|---|---|---|---|
| 0312-01 | internal · note · app | Bogdan · 2026-09-06 | "Suti registered 2026-03, 100k capital — do not use" |
| 0312-01 | internal · note · whatsapp_log | Bogdan · 2026-09-14 | counterparty "Daryl (Yuantuo)" — "confirmed 0.0539 FOB SZ for 100k, T/T 30/70, 30 days" + screenshot `wa-yuantuo-0914.png` |
| 0312-01 | internal · note · app | Bogdan · 2026-09-12 | "ZZLEAKTEST asked for 50 % deposit — parked" |
| 0312-01 | client · question · app | Piotr · 2026-09-24 | "Can we get the balance invoice in EUR next time?" |
| 0312-01 | client · answer · app | Bogdan · 2026-09-24 | "USD for now; EUR display is coming." |
| 0312-05 | client · update · app | Bogdan · 2026-09-23 | "One factory quoted 50 µm instead of spec — we are asking for the right thickness" |
| 0318-01 | internal · note · whatsapp_log | Cristina · 2026-09-14 | counterparty "client (KOFF)" — "Bogdan: Springos lookalike, 180 cm, PVC ok" |
| 0301-01 | client · update · app | Bogdan · 2026-09-26 | "Price ready — includes EN 388 marking on the cuff" |
| ORD-2026-0290 | client · update · app | Bogdan · 2026-08-28 | "Delivered to your warehouse — please confirm in the app" |
| REQ-2026-0325 | internal · note · app | Marko · 2026-09-27 | "Bogdan says ASAP; top 10 of this type" |

### 7.14 Documents

| Entity | filename | kind | visibility | uploaded by · date |
|---|---|---|---|---|
| REQ-2026-0312 | Order-312-list.xlsx | other | client | Piotr · 09-01 |
| 0312-01 | allegro-sleeves-ref.jpg | reference_image | client | Piotr · 09-01 |
| 0312-01 | Yuantuo-quote-2026-09-15.xlsx | quote_file | internal | Bogdan · 09-15 |
| 0312-01 | QuoteD-anon.xlsx | quote_file | internal | Bogdan · 09-14 |
| 0312-01 | ZZLEAKTEST-quote.xlsx | quote_file | internal | Bogdan · 09-12 |
| 0312-01 | Best-prices-sleeves.xlsx | comparison | internal | Marko · 09-21 |
| 0312-01 | RFQ-0312-v1.pdf | rfq | internal | Bogdan · 09-05 |
| 0312-01 | wa-yuantuo-0914.png | other | internal | Bogdan · 09-14 |
| SMP-2026-0312-01-1 | Sample-photo-1.jpg, Sample-photo-2.jpg | sample_photo | client | Bogdan · 09-18 |
| ORD-2026-0312 | PI-ORD-2026-0312.pdf | pi | client (published 09-20) | Bogdan |
| ORD-2026-0312 | Dieline-sleeve-66x91.pdf | dieline | client (published 09-20) | Bogdan |
| ORD-2026-0312 | Artwork-sleeves-v1.pdf | artwork | client | Piotr · 09-22 |
| ORD-2026-0312 | PO-2026-0312-01.pdf | other | internal | Bogdan · 09-21 |
| ORD-2026-0312 | ZZLEAKTEST-quote.xlsx (second copy attached to the order) | quote_file | internal | Bogdan · 09-21 |
| ORD-2026-0290 | PI-ORD-2026-0290.pdf · Invoice-ORD-2026-0290-balance.pdf · QC-report-ORD-2026-0290.pdf · BL-ORD-2026-0290.pdf · Packing-list-ORD-2026-0290.pdf | pi · invoice · qc_report · bill_of_lading · packing_list | client | Bogdan |
| ORD-2026-0290 | PO-2026-0290-01.pdf · Ecosino-quote-2026-06.xlsx | other · quote_file | internal | Bogdan |
| FR-0001 | Factory-F-0042-range.pdf | factory_range_pdf | client | Marko · 09-21 |
| SUP-0017 | ZZLEAKTEST-pricelist-2026.pdf | price_list | internal | Bogdan |
| SUP-0007 | Yuantuo-pricelist-2026.pdf | price_list | internal | Bogdan |
| SUP-0001 | Ecosino-catalogue-2026.pdf | catalogue | internal | Bogdan |

Fixtures written to `docs/fixtures/` (not in the DB): `order312_sample.xlsx` (8 rows Name/Link/Qty), `leaky-report.pdf`, `clean-report.pdf`, `leaky-range.pdf`, `clean-range.pdf`, `artwork.pdf`, `sample-02.jpg`, `exif-gps.jpg`.

### 7.15 Outbox after seed

≥ 40 rows, all `sent`, generated by the services during seeding (invites ×5, request received ×6, new request ×8 per agent/admin recipient set, milestone changes, offer ready ×4, sample shipped ×2, sample ready ×2, order confirmed ×2, payment due ×3, artwork ×3, QC result ×1, delivery confirm ×1, new update ×4, client actions ×6, questions ×1). `./var/outbox.log` mirrors them. The seed prints the final count.

### 7.16 Consistency checks the seed asserts before exiting

* Dashboard counts match AC-DASH-01/02 and AC-OPS-01/02/03.
* Compare strip for 0312-01 equals AC-BOARD-02.
* Every client DTO parses for every seeded entity (5.3 `dto-strict`).
* `ZZLEAKTEST` occurs in ≥ 6 internal places (supplier, contact, participation, quote file, comment, order document, activity payload, price list) and in 0 client-visible rows (comments/documents/activity with `visibility=client`).

---

## 8. Non-goals for v1 (explicit)

Not built, not stubbed unless stated; UI must not hint at them:

1. In-app chat / messaging threads (D-08) — only Updates, Ask, and Log WhatsApp.
2. "Proposed by us" section and the Scout pipeline (`product_visibility=proposed` unused).
3. Landed-cost estimates, TARIC/AD-duty lookups on offers.
4. WhatsApp Business (or any non-email) notifications; email **sending** itself in local mode.
5. Organisation / user management UI for clients (no "Company & users" page); multi-user client orgs beyond what admin invites.
6. Payment processing (Stripe etc.); invoices are documents, payments are recorded.
7. Supplier-facing anything (portal, emails, RFQ sending). "Generate RFQ" produces no file; "Mark RFQ sent" records the fact.
8. Quote extraction from files, cost-model drafting by Claude, poller, `/api/v1` automation endpoints, API keys UI.
9. Polish or any non-English UI; EUR/PLN display (USD only).
10. Public catalog; catalog "order now" (only "Request offer").
11. Google Sheet import script (the seed replaces it for the local build); the migration mapping in blueprint §09 stays the spec for v1 hosted week 4.
12. Postgres `app_client` role (v1.1 hardening).
13. Per-agent client scoping; partner tier (`partner_org_id` stays null).
14. Forecast-accuracy scoring, two-price (trial/committed) offers — forecast fields are captured only.
15. Reference-price auto-acceptance; every catalog request passes an agent.
16. Dark mode polish, mobile-native anything, offline.
17. Full-text search beyond ref/name/contact `ILIKE`.
18. Deleting orders; hard deletes of anything.

---

## 9. Build order and definition of done

### 9.1 Build order (each step leaves the app runnable with seeded data for that step)

| Step | Build | Seed available after this step | Proves |
|---|---|---|---|
| 1 | Repo, Next.js 16 + TS + Tailwind 4 + shadcn, docker-compose Postgres, Drizzle schema **complete** (all 36 tables + Appendix A columns, both schemas), migrations, `clock.ts`, `StorageAdapter` (local), `messages/en.json` skeleton, ESLint import boundary | 7.1–7.3 (orgs, users, rules, FX) | `pnpm db:reset && pnpm dev` boots |
| 2 | Better Auth (email+password, invites, reset), `authorize(ctx)`, scoped repositories (`server/client`, `server/ops`, `server/shared`), two shells, role routing, 404/redirect rules, settings page | — | AC-AUTH-*, AC-SHELL-* |
| 3 | `activity_events` + `recordActivity`, `notification_outbox` + local worker + `/ops/outbox`, React Email templates skeleton (all 22), daily digest | — | AC-OUT-01 (partial) |
| 4 | State machine module (`transition()`, `milestoneFor`, `waitingOn`, `stale`), exceptions, unit tests | — | `state-machine.test.ts` |
| 5 | Suppliers + contacts + price lists (F-21), products + specs + images (F-24 without publish) | 7.4, 7.5 | AC-SUP-01/02/03 |
| 6 | Intake: `/app/requests/new`, `/ops/requests/new`, xlsx stub, requests/lines lists, queue, claim/assign (F-04, F-05, F-06, F-14) | 7.6 (all requests, lines in ≤ `in_review`) | AC-NEW-*, AC-QUEUE-* |
| 7 | Spec & freeze, cost & target, pricing rules page (F-15, F-16) | lines to `spec_frozen`/`cost_target_price` | AC-SPEC-*, AC-COST-* |
| 8 | Sourcing board: participations, quotes, breaks, FX normalisation, compare, RFQ mark (F-17) | 7.7 | AC-BOARD-* |
| 9 | Client DTO layer + denylist tests + leak check module + documents (F-23) + comments/timeline (F-19) | 7.13, 7.14 (internal docs) | AC-DOC-*, AC-TL-*, 5.3 tests |
| 10 | Offer builder + client offer page (F-18, F-08); client line page, dashboard, list (F-07, F-03, F-05) | 7.8, lines to `offer_ready`/`offer_accepted` | AC-OFB-*, AC-OFFER-*, AC-LINE-*, AC-DASH-* |
| 11 | Samples ops + client (F-20, F-09) | 7.9 | AC-SMP*, AC-SMPO-* |
| 12 | Orders: confirm, payments, artwork, POs, inspection, shipment, client order page (F-22, F-10) | 7.10 (both orders, full histories) | AC-OO-*, AC-ORD-* |
| 13 | Ops dashboard + stale job + digest content (F-13, F-28) | stale_since computed | AC-OPS-*, AC-X-* |
| 14 | Catalog + product publish + reorder (F-11, F-24 publish, F-12) | catalog products | AC-CAT-*, AC-PRD-*, AC-REO-* |
| 15 | Factory range (F-25) | 7.11 | AC-RNG-* |
| 16 | Clients admin + invites end-to-end (F-26) | — | AC-CLI-* |
| 17 | Anonymity crawl + ZZLEAKTEST seed wiring + fixtures; Playwright for intake, offer accept, order flow | 7.4 SUP-0017 everywhere listed in 5.4 | 5.4 green |
| 18 | Polish pass on the three screens (new request, order page, sourcing board) per BRAND_INPUT; empty states; error boundaries; 390 px check | — | AC-SHELL-02 |

### 9.2 Definition of done (local build)

All of the following on a clean checkout, Node 22, Docker running:

1. `pnpm install && docker compose up -d db && pnpm db:reset && pnpm dev` — app at `http://localhost:3000` within 2 minutes, seed exits 0 with the 7.16 checks printed.
2. All five seed users can sign in and land on their door; every route in Section 2 renders for the seeded refs without a server error or a console error (Playwright smoke test visits all of them).
3. `pnpm test` green: state machine, DTO denylist, DTO strict, leak check, messages, activity coverage, compare/normalisation, working-day/stale math.
4. `pnpm test:e2e` green including `@critical` anonymity crawl (5.4) and the three flows: intake (AC-NEW-01…03), offer accept → order confirm → PI → payments → artwork → production → QC → balance → shipment → delivered → confirm (AC-OFFER-02, AC-OO-06…09, AC-ORD-05 path on the gloves order), sample reject/approve (AC-SMP-02/03).
5. Every acceptance criterion in Section 4 passes manually in Chrome (QA checklist = the AC list; QA records pass/fail per AC id).
6. `pnpm lint` and `pnpm typecheck` clean; no `select *`/`...row` spreads in `src/server/client/**` (lint rule).
7. `./var/outbox.log` exists after seed and grows on every notification; no email is transmitted (no network call to any mail provider in local mode — verified by absence of `RESEND_API_KEY` requirement).
8. README section "Local run" (≤ 30 lines) documents the commands above and the seed users.

---

## Appendix A — Data-model deltas vs the blueprint §06

Additions only; nothing removed. All are nullable unless stated.

| Table | Column / change | Why |
|---|---|---|
| `organizations` | `deposit_pct int not null default 30`, `timezone text not null default 'Europe/Warsaw'` | payments; display |
| `users` | `deactivated_at`, `invite_token_hash`, `invite_expires_at`, `password_set_at` | F-01/F-26 |
| `requests` | `client_ref text`, `note text` (= blueprint `notes`) | client's own reference (ORDER-2026-#312, SHEDS-3210) |
| `request_lines` | `exception line_exception`, `exception_reason text`, `client_sku text`, `unit text not null default 'pcs'`, `artwork_required bool default false`, `sample_required bool default true`, `from_catalog bool default false`, `from_range_id`, `stale_since timestamptz`, `links_meta jsonb` (`{url, not_durable}` per link), `line_ref text generated` | F-04/F-15/F-28 |
| `supplier_participations` | `pack_qty` moved to quotes; `stale` derived, not stored | — |
| `quotes` | `pack_qty int` (per-bag quotes), `lead_days_max int`, `flags text[]` (cached B.4 flags) | compare |
| `offers` | `incoterm text`, `port text`, `note_to_client text`, `accepted_option_id`, `decline_reason text`, `changes_text text` | F-08/F-18 |
| `offer_options` | `unit text`, `sample_paid_by sample_paid_by`, `sample_required bool`, `payment_terms_client text`, `internal_note text`; `fee_minor` = **flat per order**; `factory_price_minor` = per unit at line qty | F-18 |
| `samples` | `status sample_status not null`, `ref text`, `shipped_at`, `deviations_vs_spec text`, `reject_reason text` | F-09/F-20 |
| `payments` | `request_line_id` (sample payments before an order exists), `status payment_status not null default 'pending'` | F-20 |
| `artworks` | `version int`, `client_note text`, `internal_note text`, `decided_at`, `decided_by` | F-22 |
| `purchase_orders` | `ref text` (PO-2026-0312-01), `document_id` | F-22 |
| `inspections` | `scheduled_for date`, `defects_note text` | F-22 |
| `shipments` | `forwarder_party forwarder_party`, `port_of_discharge text`, `exworks_shipped_at`, `arrived_port_at`, `forwarder_contact text` | F-22 / 5.2 |
| `factory_ranges` | `ref text` (FR-0001), `label` assigned at publish (nullable until then), `pdf_source_file_id` (raw upload, internal) vs `pdf_file_id` (client copy) | F-25 |
| `factory_range_items` | `unit text`, `note text` | F-25 |
| `documents` | `filename text`, `uploaded_by`, `leak_check_result jsonb` (last run) | F-23 |
| `comments` | `kind comment_kind not null`, `counterparty text` (WhatsApp logs), `occurred_at timestamptz` | F-19 |
| `activity_events` | `actor_name text` (denormalised for client DTOs) | 5.2 |
| `notification_outbox` | `to_email text`, `subject text`, `entity_ref text`, `error text` | F-27 |
| `orders` | `exception line_exception`, `exception_reason`, `stale_since`, `delivered_at`, `completed_at`, `artwork_required` derived from lines | 3.5 |

Enum types to create: every enum in 3.6 as a `pgEnum` with exactly those values.

## Appendix B — Derived-value functions (pure, unit-tested)

**B.1 `milestoneFor(state): milestone`** — the mapping in 3.2. Throws on unknown state.

**B.2 `waitingOn(entity): {party: 'client'|'agency'|'none', reason}`**

```
if exception in (cancelled, on_hold) → none
if exception = needs_input → client / needs_input
switch state:
  draft → none
  offer_ready → offer.status = sent ? client/offer_sent : agency/offer_followup
  sampling → sample.status = received ? client/sample_received : agency/sample_in_progress
  awaiting_deposit → any(deposit, fee) pending ? client/deposit_due : agency/advance_state
  awaiting_artwork → latest artwork per line: none or changes_requested ? client/artwork_due : agency/artwork_review
  awaiting_balance → balance pending ? client/balance_due : agency/advance_state
  delivered → client/delivery_confirm
  completed → none
  default → agency/<state>
```

**B.3 `isStale(entity, now)`** — `waitingOn.party = 'agency'` and `workingDaysBetween(last_state_change_at, now) > 5` (Mon–Fri count, Europe/Zagreb, exclusive of the start day, inclusive of today). Worker writes `stale_since = last_state_change_at + 5 working days` when true, else null. `on_hold`/`cancelled` → never stale. Unassigned `submitted` lines are stale by the same rule (they wait on us).

**B.4 `compare(line)`**
* For each participation with ≥1 quote take the latest version. `unitPrice = break.unit_price_minor / (quote.unit == line.unit ? 1 : quote.pack_qty ?? NaN)`; break chosen = largest `min_qty ≤ line.qty_first`, else the smallest with flag `moq_above_qty`. `usd = unitPrice × fx(currency→USD at received_at)`. Normalised value rounded to 4 dp of USD.
* Flags per quote: `expired` (valid_until < today), `incoterm_uncertain`, `unit_mismatch` (unit differs and no pack_qty), `currency_unknown`, `supplier_unchecked` (verdict ∈ {unchecked, unknown}), `supplier_trading` (verdict = trading), `excluded_status` (participation ∈ {dropped, cannot_make}), `moq_above_qty` (informational), `deviation` (informational).
* `clean` = none of {expired, incoterm_uncertain, unit_mismatch, currency_unknown, supplier_unchecked, supplier_trading, excluded_status}.
* `bestClean` = min usd among clean; `lowestQuoted` = min usd among all with its exclusion flags; `spread = max/min` over all (1 dp, "×"); `quotesCount` = participations with a quote and status ≠ cannot_make; `contactedCount` = participations with status ≠ cannot_make; `staleCount` = participations with status ∈ {contacted, negotiating} and `now − last_contact_at > 7 days`.
* Client counts: `contacted = contactedCount`, `quoted = quotesCount`.

**B.5 `leakCheck(input: {text?: string, filename?: string, pdfText?: string}): {ok, matches[]}`**
Patterns (case-insensitive; text normalised NFKC, whitespace collapsed; also run on URL-decoded and HTML-entity-decoded copies):
1. Every `suppliers.legal_name` and `cn_name` (non-deleted), also with the company suffix stripped (`Co., Ltd`, `Co.,Ltd`, `Co. Ltd`, `Limited`, `Inc`, `有限公司`, `厂`, `Factory` when trailing) and with punctuation removed; minimum 6 characters after stripping.
2. Every `supplier_contacts.handle`, `phone` (digits only, ≥ 8 digits), and `name` when ≥ 4 characters and not a common first name (list of 200 English/Chinese first names is bundled).
3. Every `suppliers.uscc`.
4. Regex: `alibaba\.com`, `1688\.com`, `made-in-china\.com`, `globalsources\.com`, `wechat|weixin|微信`, `whatsapp\.com`, `(\+?86[\s-]?)?1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}` (CN mobile), `\bCo\.?,?\s?Ltd\b`, `有限公司`, `SUP-\d{4}`, `PO-\d{4}-\d{4}`, `FR-\d{4}`.
5. Exempt: the literal `Factory F-\d{4}`, the words "Factory"/"factory" alone, "China", port names.
Returns every match with `{pattern, match, field, index}`. Any match ⇒ `ok=false`. Used by: document publish (filename + pdf/xlsx/docx text), offer send (all text fields), client updates/answers, on-hold reason, product publish (name/description), range publish (items + pdf text), sample photo upload (filename), client-visible activity payloads (test-time only).

**B.6 Money display.** `formatMoney(minor, currency, decimals)` — USD unit prices show 4 dp when < $1 else 2 dp (`$0.0539`, `$8.90`); totals always 2 dp with thousands separators (`$6,740.00`). Client pages show `{price} / {unit}` and, when `factory_plus_fee`, `+ fee` (line/dashboard) or `+ fee {amount}` (offer/order).

## Appendix C — `messages/en.json` key groups

`auth.*`, `nav.app.*`, `nav.ops.*`, `milestone.<value>` (9), `milestone.sub.<state>` (client sub-labels from 3.2), `state.<value>` (24, ops labels), `exception.<value>` (7; client and ops variants `exception.client.<value>`), `participation_status.<value>`, `offer_status.<value>`, `sample_status.<value>`, `payment_kind.<value>`, `document_kind.<value>`, `waiting.<reason>` (dashboard card titles), `email.<template>.subject|body.*`, `app.*` (client pages), `ops.*` (ops pages), `errors.<code>` (`E_ILLEGAL_TRANSITION`, `E_LEAK_CHECK`, `E_KIND_NOT_PUBLISHABLE`, `E_DUPLICATE_SUPPLIER`, `E_VALIDATION`, `E_NOT_FOUND`, `E_FORBIDDEN`). The messages test (5.3) enforces the vocabulary rule on `app.*` and `email.client_*`.

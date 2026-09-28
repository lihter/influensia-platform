# Fix phase — shared rules for the three fix engineers

Inputs: docs/QA_REPORT.md (52 issues, QA-xx), docs/UX_REVIEW.md (top 10 + per-screen list + signature touches), screenshots in docs/qa-shots and docs/ux-shots. Design system: docs/DESIGN.md. Shared APIs: docs/FOUNDATION.md.

## Ownership (three engineers work AT THE SAME TIME)
| Engineer | Owns (edit freely) | Theme |
|---|---|---|
| **FIX-A — logic & anonymity** | `src/server/**`, `src/db/**` (schema only if unavoidable; seed yes), `src/lib/**` (except UI helpers), `src/app/**/actions.ts`, `src/app/api/**`, `src/app/(auth)/**`, `tests/unit/**` | QA S1/S2/S3 logic bugs, leak check, state machine dead ends, seed data cleanup |
| **FIX-B — client portal UX** | `src/components/app/**`, `src/app/(client)/**/page.tsx|layout.tsx` (not actions.ts), client strings | Client-side QA bugs + UX review items for client screens + client signature touches |
| **FIX-C — design system & ops UX** | `src/components/ui/**`, `src/components/shared/**`, `src/components/ops/**`, `src/app/(ops)/**/page.tsx|layout.tsx`, `src/app/globals.css`, shells, `src/lib/labels*` / label map | Section bands, tables, nav, labels map, sheets/dialogs, dates, ops-side QA/UX items + ops signature touches |

If you must change a file you don't own: keep the change minimal and targeted, **Read the file immediately before each Edit** (others may have changed it), and list it in your report. Never reformat or rewrite another owner's file. Coordinate on contracts:
- **Labels:** FIX-C creates/extends ONE label map (e.g. `src/lib/labels.ts`, re-exported) with human labels for every enum shown to users (states, milestones, participation, payment kinds, document kinds, roles, commercial_mode, pricing_display, spec keys, booleans → Yes/No). FIX-B and FIX-A import from it; if a label is missing, add it there (small append, re-read first).
- **Section bands:** FIX-C ships `SectionBand`/`PageBand` variants (white / page / alt) in `src/components/shared` first (within ~30 min) and documents usage at the top of the file; FIX-B applies them on client pages, FIX-C on ops pages.
- **Dates:** EU format `28 Sep 2026` / `dd.mm.yyyy` inputs everywhere via a shared formatter; FIX-C owns the formatter and date input component.

## Running a dev server without colliding
Next refuses two `next dev` in one directory. Each engineer runs from a mirror:
```
rsync -a --delete --exclude node_modules --exclude .next --exclude .data /home/claude/influensia-platform/ /home/claude/fix-X-run/ && ln -sfn /home/claude/influensia-platform/node_modules /home/claude/fix-X-run/node_modules
cd /home/claude/fix-X-run && PGLITE_DIR=./.data/pglite FILES_DIR=./.data/files OUTBOX_LOG=./.data/outbox.log npm run db:seed
BETTER_AUTH_URL=http://localhost:PORT AUTH_RATE_LIMIT=off PGLITE_DIR=./.data/pglite FILES_DIR=./.data/files OUTBOX_LOG=./.data/outbox.log npx next dev -p PORT
```
Ports: FIX-A 3301, FIX-B 3302, FIX-C 3303. Re-run the rsync (without `--delete` on .data) to pick up edits; edit ONLY in /home/claude/influensia-platform, never in the mirror. If Turbopack complains about the symlinked node_modules, `cp -al` or a plain copy of node_modules is fine.

## Gates before reporting
In /home/claude/influensia-platform: `npm run lint && npm run typecheck && npm run test:unit` green. Do NOT run `npm run build` or `npm run test:e2e` (the lead runs them once at the end). Do not commit. Kill your own dev server.
Report: issue IDs fixed, issue IDs deferred (why), files touched outside your ownership, screenshots you inspected.

## Contracts — FIX-B asks (client portal)
- **FIX-A, ClientRequestLineDto** (optional, UI degrades gracefully if absent): `milestoneDates: { milestone: Milestone; at: string }[]` (first reach of each milestone, for dates under stepper steps); `specFields: { key: string; value: string | number | boolean }[]` (frozen spec, for the "What we confirmed" definition list); `offerOutcome: "changes_requested" | "declined" | null` (QA-11).
- **FIX-A, QA-08 actions** (FIX-B wires the UI): `askAboutRequestAction({ requestRef, body })` in `src/app/(client)/app/requests/[reqRef]/actions.ts`; `requestSpecChangeAction({ lineRef, text })` in `src/app/(client)/app/lines/[ref]/actions.ts`. Both `Promise<ActionResult<…>>`. Write the final names here if different.
- **FIX-C, shared/timeline.tsx**: FIX-B does not edit it. Wish: `timeOnly?: boolean` prop (items show `11:00`; day lives in the group header). Collapse-duplicates + "latest 5 + Show all" live in FIX-B's client wrapper `src/components/app/client-timeline.tsx`.
- **FIX-B helpers others may reuse** (src/components/app/client-format.ts): `platformOf(url)` (Allegro/eMAG/Amazon/Alibaba/1688/TikTok/other), `nextStepFor(line)` ("what's next and when").

## Contracts (FIX-C — shipped, import these)
**a) Section bands** — `src/components/shared/section-band.tsx` (usage docs at the top of the file), re-exported from `@/components/shared`.
- `<PageBand tone="white|page|alt|ink" pad="none|sm|md|lg" inner="max-w-[72rem]" as="section|aside|…" id fill>` — full-bleed background painted with a `border-image` outset (CSS classes `.band-white/.band-page/.band-alt/.band-ink` in globals.css): bleeds to the viewport/column edge from inside any padded or max-width container and never causes horizontal scroll. `inner` wraps content in a centred max-width div (client pages: `inner="max-w-[72rem]"`, or leave it off inside the client `<main>` which is already 72rem).
- Meaning: **white** = header + "now"/action zone · **page** = working content · **alt** = secondary/aside (rails, history, "what happens next") · **ink** = one closing CTA band.
- `<PageHeader band …>` renders the header as the white band (pt-5 pb-5, hairline bottom); `sticky` implies `band`. New props: `crumbs={[{href,label},…]}` (breadcrumb above the eyebrow) — also exported `Breadcrumbs`, `EyebrowLink` (a ref inside an eyebrow that links).
- `<BandSection number={1} title="Lines" tone="page|alt" action={…} id="lines">` = numbered H2 section on its own band.
- A page using bands should drop the `<main>` vertical padding it relies on (bands own `py`). FIX-B: remove `py-6 sm:py-8` from the client `<main>` when your pages are converted.

**b) Labels** — `src/lib/labels.ts`: `label(kind, value)` (alias `labelFor`), `labelOptions(kind)` for selects, `specKeyLabel(key)` / `specValueLabel(v)` (booleans → Yes/No), `formatBool`, `humanizeKey` (fallback only), `unitLabel(unit, qty)` ("pairs"), `initials(name)` ("Anna (KOFF)" → "AN"). Kinds: `orgType role commercialMode pricingDisplay requestSource requestStatus state milestone exception participation offerStatus sampleStatus samplePaidBy paymentKind paymentStatus payee artworkStatus poStatus inspectionResult shipmentMode forwarderParty customsStatus productVisibility imageKind supplierVerdict verdictSource supplierGrade channel documentKind visibility commentSource commentKind activityType outboxStatus notificationChannel notificationTemplate entityType productCategory unit incoterm reorderInterval provenance boolean specKey`. State/milestone/participation/offer/sample/payment/document/visibility/role words come from messages/en.json (so chips and the map agree). `label("inspectionResult", null)` → "Not inspected yet". Test: `tests/unit/labels.test.ts` fails if any value of any enum array in src/db/enums.ts lacks a label. Missing label → append to LABELS (re-read first).

**c) Dates** — `src/lib/format-date.ts` (pure, fixed Europe/Zagreb zone, deterministic on server and browser): `fmtDate` "28 Sep 2026", `fmtDateShort` "28 Sep", `fmtDayTime` "28 Sep, 14:05", `fmtTime` "14:05", `fmtDateTime` "28 Sep 2026, 14:05", `dayKey` (yyyy-mm-dd in display zone), `fmtInputDate` "12.10.2026", `parseInputDate("12.10.2026")` → "2026-10-12". Date-only ISO strings are never shifted. **Input:** `src/components/ui/date-input.tsx` `<DateInput value={iso} onChange={(e) => set(e.target.value)} />` — drop-in for `<Input type="date">` (same `value`/`onChange(e.target.value)` contract, ISO in/out), also `onValueChange(iso)`, `name` (hidden ISO input for FormData), `min`/`max`; shows/accepts dd.mm.yyyy (also accepts ISO typed/filled, so e2e `fill("2026-10-31")` keeps working); calendar button opens the native picker.

**Timeline** (`shared/timeline.tsx`, now a client component): `timeOnly` (default **true**: items show `14:05`, day in the group header; on phones the time moves to the author line), `collapse` (default true: identical consecutive titles within 10 min → one item `×N`), `limit={5}` (latest N + "Show all N updates" ghost button). FIX-B can use these directly instead of a wrapper.

**Also changed globally:** `Button` base now has `font-sans normal-case tracking-normal` (buttons never inherit mono/uppercase). Sheet/Dialog overlays: plain `bg-foreground/40`, no blur.

## Contracts (FIX-A — shipped; server side)
**Client DTO additions** (`src/server/client/dto/request.ts` `ClientRequestLineDto`, filled on the line page AND the request page):
- `milestoneLabel: string` — truthful chip label. Equals the milestone label except `offer_accepted` → "Order being prepared" (QA-12). Also on `ClientActiveLineDto` (dashboard) and `ClientListRowDto` (requests list).
- `milestoneDates: { milestone: Milestone; at: string /*ISO*/ }[]` — first reach of each milestone up to the current one ("received" = line created).
- `specFields: { key: string; value: string | number | boolean }[]` — frozen spec, RAW keys (`pvc_free`) and raw values (`true`); humanise with `specKeyLabel` / `specValueLabel` from `src/lib/labels.ts`. `specSummary` stays for fallback (request page now fills it too).
- `offerOutcome: "changes_requested" | "declined" | "expired" | null` — set only while the line is in `offer_ready` and we owe a new price (QA-11). Also on `ClientActiveLineDto` and `ClientListRowDto`. `subLabel` is already truthful for these cases ("We're revising your price" / "Offer declined — we'll be in touch" / "Price expired — new price coming").
- `onHoldReason: string | null` — leak-checked reason while the line/order is on hold (QA-28).
- `canRequestChange: boolean` — spec frozen, no order yet, not cancelled, no open change request → show "Request a change" (QA-08).

**Client actions (QA-08):**
- `requestSpecChangeAction({ lineRef: string; text: string /*10–4000*/ }): Promise<ActionResult<{ lineRef: string; commentId: string }>>` in `src/app/(client)/app/lines/[ref]/actions.ts`. Error `E_NOT_CHANGEABLE` (+ `message`) when the spec isn't frozen yet or an order exists. Side effects: `change_request` comment (client-visible, appears in Updates as "by you"), exception `change_requested` (existing exceptionText "Change requested — we're on it"), `ops_client_action` email.
- `askAboutRequestAction({ requestRef: string; body: string /*2–4000*/ }): Promise<ActionResult<{ requestRef: string; commentId: string }>>` in `src/app/(client)/app/requests/[reqRef]/actions.ts` → `question` comment on the request (shows in the request page Updates), `ops_client_question` to the agents of its lines.

**ActionResult:** failures may now carry `message?: string` (one human sentence for a toast). Zod default messages ("Too small: expected …") are replaced server-side by field-level sentences (`humanIssue` in `src/server/shared/http.ts`); `errors` keys are unchanged (`path.join(".")`). Upload errors (corrupt image, fake PDF, empty file) come back as `E_VALIDATION` with `errors.file`.

**Ops read model (`OpsLine`, src/server/ops/participations.ts):** `offerDefaults: { port: string | null; ports: readonly string[] }` (QA-06: real loading port or null, never an inland city), `sendOfferBlockedReason: string | null` (QA-07: why "Send offer" is disabled), `OpsParticipation.loadingPort`. Offer builder / change-state sheet already use them (minimal edits in `src/components/ops/board/offer-builder.tsx`, `line-header.tsx`).

**More DTO fields:** `ClientActiveLineDto.state` + `.lastChangeAt`, `ClientListRowDto.lastChangeAt` (FIX-B ask, "what's next and when"); `ClientOrderPageDto.artworkDue[].dieline: ClientDocumentDto | null` (QA-18: the dieline is downloadable before the first artwork upload). The client `factoryLabel` is now set only on lines created from a range, and `factoryRange` (the "More from this factory" link) only once the line is on an order (QA-23).
**Seed:** catalog images are generated product cards (no "placeholder/seed" text). Canary quote files are renamed `quote-2026-09-12.xlsx` / `quote-2026-09-12-copy.xlsx`, with the canary text inside (e2e `orders.spec.ts:54-55` updated). Piotr's SKUs are `P312-nn`. The forwarder is "Rohlig Suus". Event times now vary naturally within each day. The seed must be run with `node --import ./node_modules/tsx/dist/loader.mjs src/db/seed.ts` or `npm run db:seed`; `npx` can hang when the machine is busy.
**e2e heads-up for the lead:** `board.spec.ts:171` expects the chip "Order confirmed" after a sample approval. If FIX-B renders `milestoneLabel`, the chip reads "Order being prepared" (QA-12) and the assertion must change.

**Timelines:** every read model (client line / request / order / dashboard, ops line feed, ops order timeline) now collapses repeats server-side (`src/server/shared/timeline.ts`, same visible text within 10 min). The UI `collapse` prop can stay on — it is idempotent.

**More FIX-C shared pieces (optional to use):** `ui/native-select.tsx` (native `<select>` that looks like the shadcn trigger — keeps `selectOption` in e2e working), `shared/filter-toggle.tsx` (on/off filter pill with a visible switch), `CellSub` in data-table (muted second line), `nextStepLabel(reason)` in labels.ts (ops "Next step" wording), CSS utilities `scroll-under-header` / `sticky-under-header` (anchors/rails under the sticky ops header via `--ops-header-h`) and `scroll-shadow-x` (right-edge scroll cue for hand-built wide tables). `FormShell` now lists, marks and focuses missing required fields instead of submitting silently. `WaitingOnYouCard` items: `action` is now optional.

# Influensia Sourcing Platform: design review

Reviewed 2026-09-28 against `docs/DESIGN.md` v1.0, `docs/BRAND_INPUT.md` and the founder's brief. Production build, port 3202, seeded data in `.data/ux`.
Screenshots: `docs/ux-shots/` (126 files). `c-*` = client portal, `o-*` = ops workspace, `-d` = 1440×900, `-m` = 390×844. Everything is a full-page capture except the sheets and dialogs, which show the viewport.

---

## 1. Overall verdict

The product is coherent, calm and clearly not a default shadcn template. The warm off-white, beige hairlines, Figtree/JetBrains Mono pairing, numbered eyebrows, sticky ops headers, the ▲ "your action" system and the leak-check dialog all read as considered and on-brand. It is **not yet at the "what sells" bar Marko set, for three reasons he will see in the first 30 seconds:**

1. **Few background bands.** Almost every screen is white cards on the same #FAFAF7 page. The section-alt bands the brief asked for ("clear section/item divisions with different background colours") appear only in the catalog filter bar, the new-request rail, table toolbars and the ops rails.
2. **Repetition and raw data.** Client pages show the same status 3–4 times and the same action button 2–3 times. Raw values (`pvc_free: true`, `pending`, `no`, `agency passthrough`, `client_owner`, `agent_on_behalf`) and dash-only facts make it look unfinished.
3. **Ops rough edges.** The ⌘K search box does nothing, Factory ranges is missing from the sidebar, wide tables are silently cut off at 1440px, table-header styling is mixed, and some pages have several black primary buttons.

None of these are structural. The system is right; the execution needs one focused polish pass (roughly 2–3 engineer-days for the top 10).

**Scores (today):** client portal **6.5 / 10** · ops workspace **6 / 10**.
**After the top 10 and 2–3 signature touches:** about 8.5 / 8.

> Demo readiness (seed data, not design): before Marko sees it, replace the catalog placeholder images ("PRD-0001 clean · placeholder · influensia seed"), hide `ZZLEAKTEST-*` files, and de-duplicate the seeded timeline events (six "Spec confirmed (v1)" on 3 Sep for REQ-2026-0312). All three read as "unfinished" in a demo.

---

## 2. Top 10 highest-impact improvements

### 1. Divide pages with background bands, not only white cards (the brief's #1 ask)
**Screens:** every client page, especially `c-dashboard-d.png`, `c-line-02-d.png`, `c-order-d.png`; ops line and order pages (`o-line-02.png`, `o-order-0312.png`).
**What's wrong:** Everything sits on one ground (#FAFAF7). Sections are separated only by 24px gaps between identical white cards. The page has no rhythm, so you cannot tell at a glance where the header ends, where the "now" zone is, and where history begins. DESIGN §4.4 defines three grounds; only one is used.
**Fix:** Add a full-bleed band primitive and use a fixed three-band rhythm on every page.
```tsx
// shared/page-band.tsx
export function PageBand({ tone = "page", children, className }: { tone?: "surface" | "page" | "alt"; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn(
      "-mx-4 px-4 sm:-mx-6 sm:px-6 py-8",
      tone === "surface" && "bg-card border-b border-hairline",
      tone === "alt" && "bg-section-alt border-y border-hairline-strong",
      className)}>
      <div className="mx-auto max-w-[72rem]">{children}</div>
    </section>
  );
}
```
The client `<main>` loses its own `py-6 sm:py-8`, and bands own vertical padding. Band order:
- **Client dashboard:** `surface` band = header + Waiting-on-you card → `page` band = "In progress" sheet → `alt` band = "Recent updates" (the timeline card stays white on alt) → ink CTA band.
- **Client line/order page:** `surface` band = header + stepper (drop the stepper's own card border and render it directly on white) → `page` band = Waiting card + facts strip + tabs → `alt` band = "What we confirmed / Your price / Sample" (as a 3-up grid instead of a right rail) → `page` band = Updates.
- **Client offer:** `surface` header band, options on `page`, "What happens after you accept" on `alt`.
- **Ops detail pages:** make the sticky header `bg-card` (currently `bg-background/95`) so chrome = white, content = page, rail = alt. Make the rail band full height: `xl:self-stretch xl:min-h-[calc(100vh-var(--header-h))]` on the `<aside>` (in `o-line-02-scrolled.png` the band stops mid-page). Move `sticky top-…` to an inner `div`.
- **Ops dashboard:** KPI row on a `surface` band. The four tables stay on `page`.

### 2. Say each thing once: one status, one action per screen (client)
**Screens:** `c-line-02-d.png`, `c-line-02-m.png`, `c-order-d.png`, `c-offer-d.png`, `c-sample-d.png`.
**What's wrong:** On the sample-stage line page the status appears four times (mono "Sample · 4 of 9" next to the H1, the chip "▲ Sample 4 of 9", the stepper, and the loose "Sample in progress" line above the tabs). "Approve sample" appears twice above the fold (header and Waiting card). On mobile both sit in the first screen (`c-line-02-m.png`). "Ask about this order" is both a header button and a tab. On the offer page "Accept option A" appears in the card and in the sticky bar.
**Fix:**
- `PageHeader` on client pages: remove `titleSuffix` (the mono "Sample · 4 of 9"). The meta row keeps the MilestoneChip without `showStep`, the FactoryLabel and "Your contact: Bogdan".
- Header actions: render the ▲ action button **only when no Waiting card is on the page**. When the card exists it is the single primary. The header keeps just `Ask about this order` (outline).
- Delete the orphan status paragraph between the facts strip and the tabs (`line-page.tsx`, the `<p>` rendering the milestone sub-label).
- Remove the "Ask about this order" tab. Put the ask composer at the bottom of the Updates tab (see signature #4), with the header button scrolling to it.
- Offer page: remove the in-card `Accept option A` when there is a single option. Keep it in cards only when there are ≥2 options (then it becomes "Select"), and the sticky bar is the only Accept.
- Rename "Ask about this order" to "Ask a question" on request-stage pages (there is no order yet).

### 3. Replace dash-only facts with "what happens next and when"
**Screens:** `c-line-03-d.png`, `c-line-26-d.png`, `c-line-received-d.png`, dashboard rows (`c-koff-dashboard-d.png`, where 7 of 8 rows end in "—").
**What's wrong:** The most prominent block on a request page (the facts strip) shows `PRICE — on its way` and `ETA — after order`. The dashboard's right-hand column is "—" for everything that isn't in production. For a client this is the whole question ("when will I hear back?"), and the UI answers with a dash.
**Fix:**
- Facts strip at request stage: `Quantity · Price expected · Your contact · Your reference`. The "Price expected" value is `~3 Oct` (mono 20/500), with sub-text "usually 5 working days from spec" (= spec-confirmed date + 5 working days; `null` → "within 5 working days"). Once an offer exists: "Price $0.052 /pc". The ETA cell appears only from `order_confirmed` onward.
- Dashboard and list rows: the right column shows the next expected event, not "—": `Price by ~3 Oct` / `Sample ships ~2 Oct` / `ETA Gdańsk 18 Nov`. Style: 12px `text-ink-2`, date mono. When unknown, show nothing and let the column collapse (never a lone dash).
- Remove the lone "—" line that occupies its own row on mobile cards (`c-koff-dashboard-m.png`, every card). That saves 20px per card.

### 4. No raw values or enums on screen; humanise every label
**Screens and exact strings:**
| Where | Shown | Should be |
|---|---|---|
| Client "What we confirmed" (`c-line-02-d.png`) | `pvc_free` / `true` in run-on prose | Definition list: "PVC-free · Yes" |
| Ops spec fields (`o-line-02.png`) | keys `pvc_free`, value `true` | Key label map + `Yes/No` toggle for booleans |
| Client order QC (`c-order-d.png`) | `pending` (mono, lowercase) | "Not inspected yet" (neutral chip) |
| Client offer (`c-offer-d.png`) | `Sample before order no`, `Sample —` | "Sample before order · Not needed". Hide the Sample row when there is no cost |
| Client offer / sample | chip `SENT`, `RECEIVED`, `ACCEPTED` uppercase | Client chip family A, sentence case: "Awaiting your decision", "Received", "Accepted" |
| Ops request rail (`o-request-0312.png`) | `agency passthrough`, `factory plus fee` in mono | "Agency pass-through", "Factory + fee" in Figtree |
| Ops client activity (`o-client-koff.png`) | `Piotr invited (client_owner)` | "Piotr invited as owner" |
| Ops new request (`o-request-new.png`) | helper text "…recorded as agent_on_behalf…" | "Recorded as entered by an agent" |
| Ops confirm order (`o-order-new.png`) | "…add ?req=REQ-2026-0301 to this URL" | Remove. Show a request picker (Combobox of offers accepted) |
| Ops offer builder | `Paid by: client` (native select, lowercase) | "Client" / "Influensia" |
| Ops publish dialog | `other · attached to` | "Document · attached to" |
| Ops stepper sub-label (`o-order-0312.png`) | `in_production` | Keep only if DESIGN insists; otherwise render the StateChip |
| Catalog chips (`c-catalog-d.png`) | `garden 1`, `safety 1` | "Garden 1", "Safety 1" |
| Range items (`c-range-d.png`, `o-range-0001.png`) | `made here`, `unknown`, `sourced by them` | "Made in-house", "Unconfirmed", "Sourced by the factory". Drop the duplicate "sourced by them" text after the chip |
| Catalog product specs | `Load Total`, `Load Per Shelf` (title-cased keys) | "Total load", "Load per shelf" |
| Order shipping forwarder | `Rohlig Suus (client)` | "Rohlig Suus · arranged by you" |
| Client avatar | `A(` for "Anna (KOFF)" | "AN" (fix `initials()`) |

**Fix (mechanics):** one `src/lib/labels.ts` with `labelFor(kind, value)` backed by `messages/en.json` keys for every enum (states, participation, payment, sample, offer, commercial mode, pricing display, roles, doc kinds, range-item provenance). A `humanizeKey()` fallback (`snake_case` → "Sentence case") and `formatBool()` → "Yes/No". Replace the three copies of `initials` with one shared helper:
```ts
export const initials = (name: string) =>
  name.replace(/\(.*?\)/g, "").trim().split(/\s+/).map((p) => p.match(/\p{L}/u)?.[0] ?? "").filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
```
Add a lint test that fails when rendered client HTML matches `/\b[a-z]+_[a-z_]+\b/` outside `<code>`.

### 5. Make the offer page, the client's money moment, feel premium
**Screen:** `c-offer-d.png`, `c-offer-m.png`.
**What's wrong:** A single option card stretches 1104px, so labels sit at x=193 and values at x=1247 (a 1,050px eye jump for every row). There are two Accept buttons. Totals conflict: the card says "at 10,000 pair · $2,750.00" and the bar says "$2,600.00 + $150.00 fee". Deviations reads "• none • EN 388 2121X on request". The status chip "SENT" is internal language. The sticky bar content starts at x=144, outside the 1152px column the page uses (x=168).
**Fix:**
- Layout: `lg:grid-cols-[minmax(0,36rem)_1fr] gap-8`. Left: option card(s) (`rounded-2xl p-6`). Right, on a `bg-section-alt rounded-xl p-6` band: "What happens when you accept" (3 numbered eyebrow steps: deposit invoice → sample/production → QC before balance), the validity countdown, and "Your contact" card. With 2–3 options use `md:grid-cols-3` full width as DESIGN §6.4 says.
- One money block, identical in card and bar: `$0.26 /pair` (mono 24/500), then DetailRows `Goods 10,000 × $0.26 = $2,600.00`, `Service fee $150.00`, rule-ink, `Total $2,750.00` (mono 500). The sticky bar reads "Option A · 10,000 pairs · **$2,750.00** total".
- Deviations: if the only entry is "none", render "Matches your reference" with a `Check` 14px `text-success`. Otherwise render the list without the "none" bullet.
- Header chip: replace `OfferStatusChip` on client with `Valid until 10 Oct · 12 days left` (mono, `text-warning` when < 7 days).
- Sticky bar inner: `mx-auto max-w-[72rem] px-4 sm:px-6` so it aligns with the column. Button order on desktop: `Decline` ghost (left-most, `text-danger`), `Ask for changes` outline, `Accept` action. On mobile: Accept full width on row 1, then Ask and Decline as a 50/50 row 2 (today Decline/Ask sit above Accept).

### 6. Mobile money and facts must never wrap mid-value
**Screens:** `c-order-m.png` (payments table), `c-sample-m.png`, `c-line-02-m.png`, `c-order-delivered-m.png`.
**What's wrong:** On 390px the payments table wraps "22 Sep 2026" onto three lines and "Deposit 30 %" onto two. The facts strip price "$0.062 / pcs + fee" wraps into three lines. The sample tracking number `JD014600012345678901` is clipped at the card edge. Mobile tabs clip "Ask about this" / "Drafts" with no fade cue.
**Fix:**
- Payments on `<sm`: render as sheet rows, not a table. Row: line 1 `Deposit 30 %` (left) + `$1,860.00` mono 500 (right). Line 2: status chip + `22 Sep` mono 12 muted (left), reference (right). Keep the table from `sm:` up.
- `FactsStrip` values: `whitespace-nowrap text-lg sm:text-xl`. Move the unit to the sub-line on mobile ("$0.062" / "per pc + $540 fee"). Tracking and long refs: `break-all` (or `truncate` + copy button).
- Tabs on mobile: `overflow-x-auto` plus a right fade mask `[mask-image:linear-gradient(to_right,black_85%,transparent)]`, as DESIGN §8 already specifies.
- Mobile line page order: show "What we confirmed / Your price / Sample" cards **before** the Updates timeline (today they are 1,500px down).

### 7. Ops tables: one header style, correct alignment, readable two-line rows
**Screens:** `o-dashboard.png`, `o-requests.png`, `o-request-0312.png` (look at its header row), `o-queue.png`, `o-client-koff.png`.
**What's wrong:**
- (7a) Sortable headers render in Title Case ("Ref", "Product / line", "State") while plain headers are UPPERCASE ("LINKS", "STATES", "INPUT", "CHANNELS"). Tailwind preflight sets `button { text-transform: none }`, so the `uppercase` on `<th>` doesn't reach the sort `<button>`.
- Right-aligned numeric headers ("↑↓ Qty", "↑↓ Last", "↑↓ Updated") sit 3–5px higher than the rest (the `flex-row-reverse` inline-flex changes the baseline).
- Two-line cells (ref and product) are crammed into 37px rows. Text touches the row rules (`o-requests.png`, `o-request-0312.png`).
- `/ops/requests` inverts the typography: ref is Figtree bold and the product name is mono. DESIGN §5.4 says the name is Figtree 14/500 and the ref is mono 12 muted.
- Buttons inside mono cells inherit mono ("Claim", "Edit" in pricing rules).
- Source chips ("Portal", "Import", "WhatsApp") use the black outline style that DESIGN reserves for "ball is with the client" states. They read as states.
- "What is waiting" repeats the State chip word-for-word on the dashboard ("NEGOTIATING" / "Negotiating").
**Fix (in `shared/data-table.tsx`):**
```tsx
<th className="… align-middle …">   {/* was align-bottom */}
<button className={cn("inline-flex h-9 items-center gap-1 uppercase tracking-[inherit] font-[inherit]", meta.numeric && "ml-auto")}>
  {meta.numeric && sortIcon}{label}{!meta.numeric && sortIcon}   {/* explicit DOM order; drop flex-row-reverse */}
</button>
```
- Row height: `h-10` for single-line rows; any row with a secondary line gets `h-12` (48px) with `py-1.5` and `leading-tight` on the two lines.
- Requests list: name `text-sm font-medium font-sans` on line 1, `REQ-2026-0312 · 8 lines` mono 12 muted on line 2. Narrow the column to `max-w-[36ch]`.
- `Button` base class: add `font-sans` so buttons never inherit mono.
- Source: plain text with a 14px icon (`Globe` Portal, `FileSpreadsheet` Import, `MessageCircle` WhatsApp), `text-ink-2 text-xs`, no chip.
- Dashboard "Waiting on us": replace "What is waiting" with the actual next action ("Log quote from Yili", "Send offer", "Book inspection"). If that is not available, drop the column.
- Replace the native `<select>` filters (`o-queue.png`, `o-requests.png`, log-quote sheet, spec form) with the shadcn `Select` already used in `+ Client`. There are two select styles on screen today.

### 8. No silently clipped columns at 1440px
**Screens:** `o-suppliers.png` (Orders, Last used, Disclosed hidden), `o-line-0312-03-sourcing.png` ("NOTE" column cut, "$0.0520 @ 50k" wrapped, "23 d" wrapped), `o-client-koff.png` (Agent "Bogda…" cut), `o-order-0312.png` §01 Lines (supplier overflows the card), `o-outbox.png` (last column cut).
**What's wrong:** Tables scroll horizontally inside their container with no cue, so a founder at 1440px thinks the columns don't exist.
**Fix:**
- Container: `relative` plus a right-edge scroll shadow shown only when overflowing: `after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-8 after:bg-gradient-to-l after:from-card after:to-transparent` toggled by a `data-overflow` attribute set from a ResizeObserver.
- First column `sticky left-0 bg-card` (already specced, not applied on these tables).
- Column priorities at ≤1440: Suppliers: merge "City / Province" into the name's second line and render Channels as a 16px icon row inside Contact. That brings Orders, Last used and Disclosed back into view. Sourcing board: merge Terms into the Price @ MOQ cell's second line. `whitespace-nowrap` on every mono cell (`$0.0520 @ 50k`, `23 d`). Excluded/flag chips go to a single trailing `AlertTriangle` 14px with tooltip instead of stacked chips (they currently make rows 3 lines tall).
- Order §01 Lines: `table-fixed`, and give Supplier `w-[14rem] truncate` with `title`.

### 9. Navigation: nothing dead, always know where you are
**Screens:** all ops (`o-*.png` sidebar), `c-range-d.png`, `o-range-0001.png`, `c-line-02-d.png`.
**What's wrong:**
- The sidebar's "Search or jump to… ⌘K" is a `<button>` with no handler (`ops-shell.tsx:45`). `components/ui/command.tsx` exists but is unused. This is the first thing a power user clicks.
- **Factory ranges has no sidebar entry**, so `/ops/factory-ranges*` pages highlight nothing.
- On the client, `/app/ranges/*` highlights no top-nav item (`app-shell.tsx:27` only matches `/app/catalog`).
- Sidebar counts are unlabeled: "Dashboard 3" (stale lines, amber) means nothing without a tooltip.
- Eyebrow refs (`REQ-2026-0312 · PIOTR'S TEAM`) are plain text. You cannot go from a line up to its request, or from an order to its client, except via the rail.
- The sample and offer pages put "← Back to the request line" in the header's action slot, which reads as an action.
**Fix:**
- Implement `CommandDialog` (cmdk) bound to ⌘K and `/`, with groups: Go to (all nav items), Recent (last 8 visited refs from localStorage), Search (server action over REQ/ORD/SUP/PRD refs and names, debounced 150ms). About 2 hours.
- Add `{ href: "/ops/factory-ranges", label: "Factory ranges", icon: Layers }` under Master data, after Products.
- Client nav: `active: pathname.startsWith("/app/catalog") || pathname.startsWith("/app/ranges")`.
- Counts: wrap in `Tooltip` ("3 stale lines"). Move the stale count from Dashboard to Requests, where the stale lines live.
- Make eyebrow segments links: `REQ-2026-0312` → request page, client name → client page (ops). Style: `hover:text-foreground hover:underline decoration-hairline-strong`.
- Back links move above the eyebrow as a breadcrumb (`← Standard sleeves 66×91 mm, 80 µm`, 12px `text-link`), the same device the catalog product page already uses ("← Catalog").

### 10. Timelines: shorter, deduplicated, time-only
**Screens:** `c-order-d.png` (21 entries, about 1,000px), `c-request-0312-d.png`, `c-dashboard-d.png`, `o-order-0312.png` §08.
**What's wrong:** Each item repeats its full date ("26 Sep 2026, 11:00") directly under a "26 SEP" group header. Identical consecutive events stack ("Order confirmed — invoice … issued" twice, "Spec confirmed (v1)" ×6). The client order page shows the whole history by default and pushes everything else off-screen.
**Fix (in `shared/timeline.tsx`):**
- Item time: `variant="time"` → `11:00` (mono 12 muted). The day lives only in the group header.
- Collapse runs of identical `title` within 10 minutes into one item with `×2` mono muted.
- `limit` prop: client pages render the latest 5 plus a `Show all 21 updates` ghost button. Ops keeps full with filter chips.
- Mobile: put the time on the author line ("Bogdan · 11:00") instead of a right column that squeezes titles into 3–4 lines (`c-koff-dashboard-m.png`).

---

## 3. Full issue list per screen

Severity: **major** = Marko will notice or it blocks a task; **minor** = visible inconsistency; **polish** = refinement.

### Global / both doors
| Sev | Issue | Fix |
|---|---|---|
| major | Background banding missing (see Top 1) | `PageBand` |
| major | Raw enums/snake_case (see Top 4) | `labels.ts` |
| minor | Sheet/Dialog overlay uses `backdrop-blur-xs` (`ui/sheet.tsx:40`, `ui/dialog.tsx:42`), which is the glassmorphism DESIGN §9 bans; the page behind becomes an unreadable smear | `bg-foreground/40`, remove `supports-backdrop-filter:backdrop-blur-xs` |
| minor | Native `<input type=date>` renders `mm/dd/yyyy` / `10/12/2026` (log quote, offer builder, mark paid, product valid-until). Ambiguous for EU users (10 Dec or 12 Oct?) | shadcn `Popover` + `Calendar` with display `12 Oct 2026`, or at least `lang="en-GB"` on the input |
| minor | Quantity inputs show `50000`, `100000` ungrouped (new request, offer builder, log quote) | Format on blur with `Intl.NumberFormat('en-US')`, parse on focus |
| minor | Two select styles (native vs shadcn) | shadcn everywhere |
| minor | Uppercase outline chips for client statuses (`SENT`, `RECEIVED`, `ACCEPTED`, `APPROVED · 23 Sep 2026`) break chip family A (client = sentence-case pill) | Client DTO chips → `rounded-full h-6 px-2.5 text-xs font-medium`, sentence case |
| polish | No dark mode toggle (DESIGN §1 says optional for v1; ops users would want it) | `next-themes` `ThemeProvider attribute="class"` + a toggle in the ops user menu. Tokens already exist in DESIGN §2.3 |
| polish | Em dash vs en dash placeholders mixed ("—" vs "–" in the ops order Shipment section) | One `<Empty/>` component rendering `—` in `text-faint` |
| polish | In headless Chromium on Linux, Figtree shows a gap after "t" ("St andard", "WAIT ING", "Magnet ic") in several screenshots | Check on a Mac/Windows browser. If it reproduces, add `font-feature-settings: "kern" 1` and `text-rendering: optimizeLegibility` on `body`, or subset Figtree with kerning kept |

### Login (`c-login-d.png`, `c-login-m.png`)
| Sev | Issue | Fix |
|---|---|---|
| minor | A bare centred card on a flat page; the most "brand" moment is the least branded | Split layout ≥1024: left 45% `bg-inverse` panel with the green wordmark, one line "Source smarter. We handle the factory; you approve the price." and a subtle `radial-gradient(circle at 80% 20%, rgba(151,207,141,.18), transparent 60%)` (the brand's CTA glow, the only permitted glow). Right: the form on `#FAFAF7`. Mobile unchanged |
| polish | Wordmark 32px green-500 floating above the card | Keep inside the dark panel on desktop |

### Client dashboard (`c-dashboard-d.png`, `c-koff-dashboard-d/m.png`)
| Sev | Issue | Fix |
|---|---|---|
| major | Right column "—" on 7 of 8 rows | Top 3 |
| major | Mini progress bar is 96px of 8px dashes with tiny ▲ outlines. Done ▲ steps render as **filled green triangles**, so a finished action looks like a pending one (green = "your action") | Done ▲ → `text-foreground` filled. Current waiting ▲ → green. Future ▲ → outline faint. Increase segment height to `h-1.5`, width 12px, gap 3px |
| minor | Waiting card row: "Price ready — Work gloves red latex crinkle, size 10 **due 10 Oct**" (due date runs into the title); second row repeats `ORD-2026-0290` in title and meta | Due date right-aligned on the eyebrow row as DESIGN §5.2 row 1. Title "Confirm delivery of Boltless steel shelving", meta `ORD-2026-0290 · delivered 28 Aug` |
| minor | "2 things are waiting on you" is 12px muted on the far right; it should be the card heading | Heading H2 "2 things are waiting on you" under the eyebrow |
| minor | Group headers "02 · FINDING FACTORY 6" use the milestone number (02, 04, 06), which looks like gaps in numbering | Drop the number, or show "Step 2 of 9" |
| minor | Dashboard sort order differs from the Requests list (…-03 first vs …-11 first) | Same sort (last update desc) in both |
| polish | H1 "Your orders" when most items are requests | "Your requests & orders", or the greeting "Good afternoon, Piotr" (display 32px as DESIGN allows) |

### Requests & orders list (`c-requests-d.png`, `c-requests-m.png`)
| Sev | Issue | Fix |
|---|---|---|
| minor | Qty column doesn't align across groups (chip widths vary; "100,000 pcs" shifts 28px) | Fixed grid: `grid-cols-[1fr_7rem_9rem_7rem_12rem_1.5rem]`, chip column `justify-end` |
| minor | `/app/orders` silently redirects to the requests list | Fine, but drop the `orders` route from links or make it a filter tab |
| polish | Mobile tabs clip "Drafts" | Fade mask (Top 6) |

### New request (`c-new-request-d.png`, `c-new-request-filled-d/m.png`, `c-new-request-send-d.png`)
| Sev | Issue | Fix |
|---|---|---|
| major | After links are pasted the 165px drop zone stays full size, and the lines (the real content) start below the fold on laptops | Once `rows.length > 0`, collapse the zone to a 56px single-line bar "Paste more links or drop photos" |
| minor | Line icon is a generic chain-link square | Platform favicon or a text badge (`Allegro`, `eMAG`, `Alibaba`), `rounded-sm bg-section-alt h-6 px-1.5 text-2xs font-semibold` |
| minor | Rail contact shows "IT · Influensia team" while the client has an assigned agent (Bogdan) | Show the org's default agent with name + "replies within 24h" |
| minor | Two different "More" links (per line and per form) | Per line: "Details". Form: "Delivery & deadline" |
| minor | Send request isn't in the header (DESIGN §6.2) and sits at the bottom right of a long form | Desktop: sticky footer bar inside the form column (`sticky bottom-0 bg-background/95 border-t py-4`), as on mobile |
| polish | Qty presets missing (WhatsApp-level effort) | Chips under qty: `1k · 5k · 10k · 50k` |

### Client line page (`c-line-02/03/05/11/14/20/26-d.png`, `c-line-received-d.png`, `c-line-0301-d.png`)
| Sev | Issue | Fix |
|---|---|---|
| major | Status ×4, action ×2 (Top 2) | |
| major | "What we confirmed" is key/value run together as prose ("pages 20 PP side-load, closure zip, pockets 360") | DetailRow list: label 12 muted, value 14 |
| major | Facts strip with dashes (Top 3) | |
| minor | Rail "More from this factory" wraps the Factory label ("Factory F- / 0042") | `whitespace-nowrap` on `FactoryLabel`. Rail row: label on line 1, chip on line 2 |
| minor | "What we understood" shows a raw 300-char Allegro URL, truncated (`c-line-received-d.png`) | Favicon + domain + slug-derived title, "Open ↗" |
| minor | "Your price · v1" block: `$0.052 / pcs + $450.00 fee`. Is the fee per pc or per order? | "$0.052 /pc · + $450 service fee per order" |
| minor | "Documents 0" tab shown | Hide zero-count tabs on the client |
| polish | Rail cards are 3 gapped cards (DESIGN bans gapped card stacks for records) | One card with `divide-y` sections, or the `alt` band per Top 1 |

### Client order page (`c-order-d.png`, `c-order-m.png`, `c-order-delivered-d.png`)
| Sev | Issue | Fix |
|---|---|---|
| major | Sections (Money, Artwork, Quality check, Shipping) are unnumbered white cards, unlike the ops order page and DESIGN §6.3/§5.7 | `SectionHeading number="01"` etc. (same component ops uses) |
| major | Payments table is a bordered table inside the Money card (card-on-card). The Artwork row is a bordered box inside a card | Table borderless inside the card (`border-0`, header rule only). Artwork as a sheet row |
| major | Timeline length (Top 10) | |
| minor | QC "pending" (Top 4); Shipping "Not shipped yet" sentence | QC: three facts with chip "Booked · 22 Oct". Shipping: FactsStrip-like 3 cells (Cargo ready / ETD / ETA) |
| minor | "Your contact at Influensia: Bogdan" is 11px at the very bottom | Contact card in the header meta row + in the right column |
| minor | Delivered order: "Next payment — everything is paid" | "Paid in full" with `Check` in `text-success` |
| minor | Client document rows show a green `CLIENT` visibility badge (every client document is client-visible) | Hide `VisibilityBadge` in client DTO views (DESIGN §5.11: client rows show Download only) |
| polish | "More from this factory" floats alone at the bottom in a full-width card | Move to the right column under the contact |

### Offer page (`c-offer-d.png`, `c-offer-m.png`): see Top 5.

### Sample page (`c-sample-d.png`, `c-sample-m.png`)
| Sev | Issue | Fix |
|---|---|---|
| major | Approve/Reject with no guidance: no photos (0), no checklist of what to check against the spec | Add "Check against what we confirmed" (the spec DetailRows) and "What happens after you approve" (deposit invoice). Empty photos state: "We'll add photos when Bogdan checks the sample in our office" |
| minor | Tracking number clipped on mobile | `break-all` |
| minor | Sticky bar buttons at x=1100–1295, outside the 1152 column | Inner container `max-w-[72rem] mx-auto` |
| polish | Three big black check circles take 100px for three dates | Reuse the stepper component (compact), or a 3-cell FactsStrip |

### Catalog (`c-catalog-d.png`, `c-catalog-m.png`) and catalog product (`c-catalog-prd1-d.png`)
| Sev | Issue | Fix |
|---|---|---|
| major (demo) | Placeholder images with seed text | Real product photos, or an icon placeholder (`Package` 24px `text-faint` on `bg-section-alt`) |
| minor | Image frame inside a beige frame inside a card: three nested boxes | Image edge-to-edge in the card top: `aspect-[4/3] w-full object-cover rounded-t-xl`, no inner border |
| minor | Product card 460px tall on mobile (1.5 products per screen) | Mobile: horizontal card (96px thumb left, text right), about 140px tall |
| minor | "ORDERED BEFORE" blue uppercase chip | UtilityBadge `repeat` in sentence case: "Ordered before" |
| polish | "More from your factories" range card crams 4 price rows into 12px text | Show 3 rows at 13px mono, "+9 more" |

### Factory range page (`c-range-d.png`, `c-range-m.png`)
| Sev | Issue | Fix |
|---|---|---|
| major | Copy says "Pick the items you want and a quantity", but there is no quantity input | Show a 96px qty input when a row is checked (prefilled with MOQ) |
| minor | Price column ends at 725px of an 838px card; right third empty | Qty input column on the right |
| minor | Top nav highlights nothing (Top 9) | |
| minor | Mobile rows have large blank space under the name and wrap names over 3 lines | Name full width on line 1, MOQ + price on line 2 |
| polish | "Range PDF 598 B" | Hide byte size for tiny files, or show "PDF" |

### Client settings (`c-settings-d.png`)
| Sev | Issue | Fix |
|---|---|---|
| minor | Switches in ink-grey read as disabled | Checked state `bg-green-600` (interactive green per DESIGN §2.1) |
| polish | "Always on" outline chip beside a switch column | Render a disabled checked switch with the caption |

### Ops dashboard (`o-dashboard.png`)
| Sev | Issue | Fix |
|---|---|---|
| major | No primary action (DESIGN §6.6: "New request on behalf") | Header right: outline `New request on behalf` next to the Mine/All toggle |
| minor | KPI tiles 117px tall for single-digit figures; four tables below each repeat Ref/Product/Client/State/Agent | Tiles `p-4`, figure 28px. Make tiles filter one combined table (tabs) instead of four stacked tables |
| minor | "What is waiting" duplicates State (Top 7) | |
| minor | Header row: sortable vs uppercase mix and baseline shift (Top 7) | |
| polish | "Waiting on client" rows lack "since N d" in amber when > 5 d | Same stale rule as the Last column |

### Ops queue (`o-queue.png`) and requests list (`o-requests.png`)
| Sev | Issue | Fix |
|---|---|---|
| major | Name and ref typography inverted; rows cramped (Top 7) | |
| minor | Title "Request queue" vs sidebar "Queue" vs eyebrow "REQUESTS" | Eyebrow "WORK", title "Queue" |
| minor | `Mine` / `Stale only` look like buttons, with no on state visible | shadcn `Switch` + label, or a `Toggle` with `data-[state=on]:bg-green-50 border-green-600` |
| minor | STATES column: 6 chips wrapping to 3 lines for REQ-2026-0312 | A mini stacked bar (segments coloured by state tone, 120×6px) + "8 lines" and tooltip. Or show the 2 most urgent chips + "+4" |
| polish | Row "⌄" menu button next to Claim with no label | `MoreHorizontal` icon + `aria-label` |

### Ops request detail (`o-request-0312.png`)
| Sev | Issue | Fix |
|---|---|---|
| major | The only header action is "New request on behalf", which belongs to the list, not a request | Actions: `Assign` outline, ⋯ (Add line, Import lines, Close request) |
| minor | Header chip cluster wraps to two lines | Summarise: "8 lines · 1 in production · 1 sample · 6 sourcing"; chips live in the table |
| minor | Rail values in mono for words ("Active", "Import", "Piotr", "agency passthrough") | Mono only for numbers/dates/refs |
| minor | Reference image tiles both labelled "01"; one is a WhatsApp screenshot (`wa-yuantuo-0914.png`) under "client reference" | Index per image. Kind chip (`client_reference` / `supplier_facing` / `clean`) per DESIGN §6.12 |
| polish | Visibility badge "CLIENT" in green on every note is visually loud | Neutral `Eye` icon only for client-visible; keep the `Internal` badge (the exception) |

### Ops line page (`o-line-02.png`, `o-line-11.png`, `o-line-0325.png`, `o-line-0301.png`, tabs `o-line-0312-0x-*.png`)
| Sev | Issue | Fix |
|---|---|---|
| major | Spec tab has no stage primary for a frozen spec at the sample stage (only "Change state"). Sourcing tab shows "Build offer" twice (header + compare bar) | One stage primary in the header. Compare-bar buttons: `+ Supplier`, `Log quote`, `Shortlist` only |
| major | Spec fields edited as free-text key/value inputs (`pvc_free` / `true`) | Keys from a category template with labels; booleans as a checkbox; units as suffixes |
| minor | Eyebrow "ORDER-2026-#312" (client SKU prefix?) is unclear | "Client ref KOFF-312-02" |
| minor | Title "02 · Standard sleeves…" + mono `REQ-2026-0312-02` suffix + eyebrow ref: the ref appears 3× in the header | Keep the eyebrow ref and drop the suffix |
| minor | Chips "SAMPLE" (state) + "▲ Sample" (milestone) side by side say the same word | When state and milestone share a label, show the state chip only |
| minor | Tab row has an orphan mono "Sample"/"Negotiating" at far right | Remove (duplicate of state chip) |
| minor | Spec grid: "HS code (6–10 digits, optional)" wraps, so its input sits 14px lower than Materials | Helper text below the input; label "HS code (optional)" |
| minor | Sourcing tab repeats a context strip (ref, name, state, floor, target, client, milestone, qty) directly under the header that already shows them | Keep only Cost floor · Target · Qty in the compare bar |
| minor | Compare bar: stats and buttons on two rows; "+1" in "expired +1" unexplained | Stats left, buttons right on one row at ≥1280. "+1" → "+1 more flag" with tooltip |
| minor | Cost tab: inputs and a read-only summary repeat the same five values | Drop the summary. Show the computed "Est. production cost" as mono large in a section-alt inset |
| minor | Cost tab: "Confirm target" still shown after "Confirmed by Bogdan on 4 Sep" | Change to ghost "Re-confirm" |
| minor | Offer builder: placeholders like "none at spec thickness" look like entered values | Placeholder `text-faint` + "e.g." prefix |
| minor | "Sent offers" is card-in-card, with "Sent" twice (chip and right text) | Sheet row, one status |
| polish | Rail band ends mid-page (`o-line-02-scrolled.png`) | Top 1 |

### Ops order page (`o-order-0312.png`, `o-order-0312-scrolled.png`, `o-order-0290.png`)
| Sev | Issue | Fix |
|---|---|---|
| major | Three black primaries ("Schedule inspection" in the header and in §05, "Record result" in §05) plus an outline "Schedule inspection" in the Waiting card: 3× the same action | Header = stage primary. Section actions `outline size=sm`. Waiting card shows its sentence, no button |
| major | §03 Artwork: the `CLIENT` badge overlaps the filename ("Dieline-sleeve-66x91.pd" + badge on top) | File tile `grid grid-cols-[auto_1fr_auto]`, name `truncate min-w-0`, badge in its own column |
| minor | Waiting on us card is a full blue info wash, the loudest element in a money zone | `bg-card border-l-[3px] border-l-info` with the eyebrow chip in info; no wash |
| minor | §02 Payments: "Mark paid" bordered but "Due date" and "Waive" are bare text that read as labels | All three `Button size="sm"`: Mark paid `outline`, Due date / Waive `ghost` with icons (`CalendarClock`, `Ban`) |
| minor | Payee chip "INFLUENSIA" ×3 | Plain text; chip only when the payee is the factory (the exception) |
| minor | "On this page" doesn't highlight the section in view | IntersectionObserver scrollspy; active item `font-semibold text-foreground` + 2px green left bar |
| minor | §04 PO: nested bordered box inside the section card | Sheet row per PO |
| polish | §07 Documents: 12 rows each with ref, download, publish, trash, all visible at once | Hover-reveal actions (always visible on touch), per DESIGN §5.11 |

### Ops orders list, confirm order (`o-orders.png`, `o-order-new.png`)
| Sev | Issue | Fix |
|---|---|---|
| major | Confirm-order empty state instructs the user to edit the URL | Combobox "Pick an accepted offer" |
| minor | "Confirm order" as the list's primary even when no accepted offers exist | Disable with tooltip "No accepted offers" |

### Suppliers (`o-suppliers.png`, `o-supplier-0007.png`, `o-supplier-0001.png`)
| Sev | Issue | Fix |
|---|---|---|
| major | Columns clipped (Top 8) | |
| minor | Channels icon-only (the 1688 glyph is unreadable) | Icon + 11px label, or tooltip |
| minor | Type verdict chips with `Factory` icon are all the same neutral grey, so "Trading" (amber) is the only signal, which works. But `UNCHECKED` (dashed) carries the same weight as a real verdict | Unchecked: `text-faint`, no chip (DESIGN §6.11) |
| polish | Supplier page profile rows use uppercase micro labels in a white table; the rail has quick stats | Fine. Add the Performance tab KPI tiles once data exists |

### Products (`o-products.png`, `o-product-0001.png`, `o-product-0004.png`)
| Sev | Issue | Fix |
|---|---|---|
| minor | 11 private rows × 6 dash cells = a wall of dashes | For `private` rows, merge the reference columns into one muted cell "Not in catalog" |
| minor | Spec column `— /1` | "v– of 1" → show "draft" |
| minor | Header "Save" (disabled grey) + "Unpublish" | Hide Save until dirty; show a "Unsaved changes" pill |
| polish | Catalog preview shows the seed placeholder | Real image |

### Factory ranges (`o-ranges.png`, `o-range-0001.png`, `o-range-new.png`)
| Sev | Issue | Fix |
|---|---|---|
| major | Not in the sidebar (Top 9) | |
| minor | "No PDF yet — optional, but clients expect it." shown above an existing PDF row | Render only when there is no PDF |
| minor | Provenance chips lowercase (Top 4) | |

### Clients (`o-clients.png`, `o-client-koff.png`)
| Sev | Issue | Fix |
|---|---|---|
| minor | Client page opens on a settings form. The frequent need (lines, orders) is below the fold | Order: 01 Lines, 02 Orders, 03 Users, 04 Settings (collapsed), 05 Activity |
| minor | Lines table clips Agent (Top 8) | |
| polish | Clients list: "Pricing & settings" outline next to the "+ Client" primary goes to Settings | Fine. Rename "Pricing rules" |

### Outbox and Settings (`o-outbox.png`, `o-settings.png`)
| Sev | Issue | Fix |
|---|---|---|
| minor | Template column shows snake_case ids | Acceptable for an admin log; add a label column, or tooltip the human name |
| minor | Last column clipped | Top 8 |
| polish | Pricing rules: "default" row in lowercase bold | "Default (fallback)" |

### Sheets and dialogs (`o-sheet-log-quote.png`, `o-sheet-add-supplier.png`, `o-sheet-change-state.png`, `o-dialog-publish-po.png`, `o-sheet-add-client.png`, `o-sheet-mark-paid.png`, `o-sheet-order-change-state.png`)
| Sev | Issue | Fix |
|---|---|---|
| major | Publish leak-check "blocked" ends in a disabled "Fix and try again" with no path to fixing | Under each failed row add the concrete remedy: filename → inline "Rename to" input prefilled `Factory-F-0042-PO.pdf`; PDF text layer → "Upload a redacted copy" button. Primary becomes "Re-check" |
| minor | Log quote sheet is 480px with a 3-column grid of native selects/dates; labels wrap ("Pack qty (per bag/pack)", "…to (max)") | Width `sm:max-w-[40rem]` (DESIGN §2.3 says 640 for quote logging). Two columns. "Lead days" as a "20–30 days" range input pair |
| minor | Change state: a single radio with a mono `offer_ready` code and 400px of empty sheet | When one transition is allowed, make it a dialog: "Move to Offer ready?" + note + confirm |
| polish | + Supplier sheet: "…or create inline" link text | Button `ghost size=sm` "Create new supplier" |

---

## 4. Signature touches (innovative, premium, each a few hours)

1. **"Now → Next" strip under the stepper (client and ops).** A single line in a `bg-section-alt rounded-lg px-4 py-3` strip directly below the stepper: left `NOW` eyebrow + "Bogdan is comparing 2 factory quotes" (from the state + participation counts); middle `→`; right `NEXT` eyebrow + "Your price · expected ~3 Oct" (mono date). On ▲ steps the strip becomes the green Waiting card. Data exists already (state, counts, spec date). It answers the only question a client has, in WhatsApp-level words. About 3h, plus copy per state in `messages/en.json`.

2. **Dated stepper.** Under each done step, its date (mono 11 muted, "3 Sep"). Under future steps, the expected date in `text-faint` ("~18 Nov" under Delivered). The connector segment between the current and next step animates its fill once over 200ms on mount (reduced-motion safe). In lists, replace the dash bar with `Step 4/9 · Sample` + a 9-dot track where only the current dot is green. About 2h in `milestone-stepper.tsx`.

3. **Sourcing-board price strip.** Above the table, in the compare-bar band, a 64px-tall SVG number line from 0.8× cost floor to 1.2× the highest quote. Cost floor = dashed ink rule with label; target = solid green-600 rule with label; each quote a 10px dot (manufacturer = filled ink, trading = hollow, excluded = hollow faint with ×, selected = green-600 filled with ring); hover a dot to highlight its table row (shared `hoveredId` state); click to scroll to the row. Stale quotes get a 2px amber ring. Spread "1.6×" as a bracket above the dots. About 60 lines of SVG, 3–4h. This is the single most "product-demo" moment in ops.

4. **Inline "Ask Bogdan" composer (WhatsApp effort).** At the bottom of the client Updates feed, a sticky composer: 40px avatar of the contact, textarea "Message Bogdan…", paperclip for photos, `Send` (action). Sent messages appear immediately as client-question items. Replaces the separate Ask tab and the header button (the header button focuses the composer). About 3h; the `AskForm` component already exists.

5. **Smart paste chips on New request.** When a link is parsed, show the platform badge (neutral text badge: `Allegro`, `eMAG`, `Alibaba`), the auto title, and quantity presets `1k · 5k · 10k · 50k` as 28px pill buttons under the qty input. A running summary in the sticky bar: "3 products · 60,000 pcs · Send request". About 2h.

6. **Scroll-spy "On this page" with live counts (ops order page).** The rail list already exists. Add IntersectionObserver highlighting, a 2px green left bar on the active section, and turn amber counts into "1 open" micro-chips. Clicking animates the scroll (smooth, reduced-motion safe). About 1h.

7. **⌘K command palette with "jump to ref".** Typing `0312-02` jumps to the line, `SUP-7` to the supplier, `>assign` to actions. The "Recent" group makes the ops workspace feel instant. About 2–3h (see Top 9).

---

*Method:* Playwright/Chromium, 1440×900 and 390×844, deviceScaleFactor 1 (2 for zoom crops). No app code was modified. The server on :3202 was stopped after the review.

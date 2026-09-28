# Influensia Sourcing Platform — Exploratory QA Report

**Date:** 28 Sep 2026 · **Build:** existing production build (`next start`, Next 16.3.6) · **Server:** `http://localhost:3201`, QA data dir `.data/qa/*` (seeded dataset, then mutated by this session). **Tester:** manual and scripted Playwright (Chromium, 1440×900 desktop and 390×844 phone). Console errors, page errors and failed 4xx/5xx requests were captured on every page visited.
**Accounts:** `piotr@example.pl` (client), `buyer@koff.example` (client), `bogdan@influensia.ro` (agent), `marko@influensia.ro` (admin), plus a new client `newbuyer@example.pl` invited during the test.

> The QA dataset at `.data/qa` is now heavily mutated (new requests REQ-2026-0327…0330, order ORD-2026-0301 driven to Delivered, range FR-0002 / Factory F-0043, supplier SUP-0018, client "Nowy Sklep", PRD-0016 published then unpublished). Reseed before reusing it: stop the server, then run `npm run db:seed` with the same env.
> Screenshots are in `docs/qa-shots/`. Names starting with `piotr_*`, `koff_*`, `*_m_*` come from full crawls (`_m_` = phone). The others are per-step shots named after the step.

## Summary

| Severity | Count |
|---|---|
| S1 blocker | 1 |
| S2 major | 11 |
| S3 minor | 15 |
| S4 polish | 25 |
| **Total** | **52** |

**Top 10**
1. **QA-01 (S1):** The leak check lets a supplier contact's first name (`Daryl`), the Chinese short name (`源拓`) and Chinese contact names (`李小姐`) through. They get published to the client.
2. **QA-02 (S2):** New request: the last pasted link is not parsed until the textarea loses focus, and the first "Send request" click is silently swallowed.
3. **QA-03 (S2):** Phone: line pages scroll horizontally, by up to 406 px, when a pasted link is long.
4. **QA-04 (S2):** "Order confirmed — invoice PI-… issued" is posted 2–3× per order, before any invoice exists. The client sees "Invoice ready" but has no invoice.
5. **QA-05 (S2):** Reorder does not take the fast path. The new line lands in *In review* with an empty sourcing board and no draft offer.
6. **QA-06 (S2):** The offer builder pre-fills the port from the factory's quote (e.g. "Linyi" for Tongfu gloves). City names pass the leak check.
7. **QA-07 (S2):** If quotes are logged before "Mark RFQ sent", the line stays stuck in `rfq_out`. "Send offer" is then disabled with no explanation.
8. **QA-08 (S2):** The client request page is orphaned (nothing links to it). It has no Ask box and no "Request a change", so there is no way to change a frozen spec.
9. **QA-11 (S2):** After "Ask for changes" or "Decline", the client line page still says "Your price is ready" while showing no price.
10. **QA-10 (S2):** Lines created from a factory range have no agent, and they are not in Queue, Unassigned or anyone's "Mine" view.

---

## S1 — Blocker

| ID | Area | Steps to reproduce | Expected | Actual | Screenshot |
|---|---|---|---|---|---|
| QA-01 | Anonymity / leak check | 1. As `bogdan@influensia.ro`, open `/ops/lines/REQ-2026-0312-05?tab=timeline`. 2. Choose **Client update**, type `Our factory contact Daryl will confirm the thickness tomorrow` and click **Post**. 3. On `/ops/lines/REQ-2026-0312-14?tab=timeline`, post client updates `Update: 源拓 confirmed`, `Update: 李小姐 replied` and `Update: Linyi factory ready`. 4. Sign in as `piotr@example.pl` and open `/app/lines/REQ-2026-0312-05` and `/app/lines/REQ-2026-0312-14`. | Every post is blocked by the leak check. SPEC 5.4 forbids every supplier contact name and CN name, and AC-ORD-02 lists `Daryl` explicitly. | All four posts are published ("Update published") and show in the client's Updates feed. Comparable strings are blocked: `Daryl Yang` (full name), `Tim Wang`, `YUANTUO`, `xinhong1688`, `13800000042`. So the checker matches only full contact names and full CN legal names, and it ignores cities. Also passed: `Yuan-tuo`, `Dongguan`. | `qa-shots/piotr_final_app_lines_REQ-2026-0312-05.png`, `qa-shots/b27_timeline.png` |

---

## S2 — Major

| ID | Area | Steps to reproduce | Expected | Actual | Screenshot |
|---|---|---|---|---|---|
| QA-02 | Client · New request | 1. As Piotr, open `/app/requests/new`. 2. Paste 3 links into the textarea in one go, with no trailing newline (e.g. `https://allegro.pl/oferta/a-1?srsltid=x`⏎`https://allegro.pl/oferta/b-2?fbclid=y`⏎`https://www.emag.ro/c/pd/X/?utm_campaign=z`). 3. Without clicking elsewhere, click **Send request**. | 3 lines appear immediately. Send shows "Enter a quantity" under each empty qty (AC-NEW-02). | Only 2 lines appear, because the last URL is parsed only on blur. The first **Send** click blurs the textarea and adds line 3, but does nothing else: no validation, no toast, no request. The user has to click Send a second time before anything happens. | `qa-shots/a5_send_noqty.png`, `qa-shots/a4_d_noqty.png` |
| QA-03 | Client · Phone layout | Phone 390×844. As KOFF, open `/app/lines/REQ-2026-0325-01`. As Piotr, open `/app/lines/REQ-2026-0327-02` and `/app/lines/REQ-2026-0327-03`. | No horizontal scroll (AC-SHELL-02). | `scrollWidth − clientWidth` is 406 px, 19 px and 51 px respectively. The full Allegro/eMAG URL in "What we understood" does not wrap. The tabs and cards stretch to about twice the viewport width. | `qa-shots/koff_final_m_app_lines_REQ-2026-0325-01.png`, `qa-shots/piotr_final_m_app_lines_REQ-2026-0327-03.png` |
| QA-04 | Order confirmation · Updates feed | 1. As KOFF, accept `/app/offers/OFR-2026-0301-01-v1`. 2. As Bogdan, open `/ops/orders/new?lineId=REQ-2026-0301-01` and click **Confirm order**. 3. As KOFF, open `/app/orders/ORD-2026-0301`. | One "Order confirmed" update. The client is not told an invoice was issued until the PI is published. | The client feed shows **"Order confirmed — invoice PI-ORD-2026-0301 issued" three times** at the same minute. The ops timeline has 2. The seeded ORD-2026-0312 and ORD-2026-0290 already show 2. The stepper sub-label reads "Invoice ready" and the deposit is "due 5 Oct 2026", but there is no invoice or "View invoice" until an agent uploads and publishes one. This client will message on WhatsApp asking for the invoice. | `qa-shots/inspect_app_orders_ORD-2026-0301.png` |
| QA-05 | Reorder (F-12) | As KOFF (fresh seed: complete ORD-2026-0290 via **Confirm delivery** first), open `/app/orders/ORD-2026-0290`, click **Reorder**, keep 1 000 and click **Create request**. Then as Bogdan open `/ops/lines/REQ-2026-03xx-01?tab=offer` for the new line (REQ-2026-0330-01 in this run). | The Ecosino quote is valid until 31 Oct 2026, so per AC-REO-01/02 the line goes to `negotiating` with "Repeat order — price being confirmed", Ecosino is `selected` on the board, and a draft offer is prefilled at $8.90 @ 1 000. | The line is `in_review` / "Received 1 of 9" / "In review — your contact is Bogdan". The sourcing board is empty ("0 quotes of 0 contacted") and the Offer tab says "No quotes on this line yet". The fast path never runs. The "Repeat" badge is shown, and the `ops_new_request` subject is not "Repeat order". | `qa-shots/c5_reorder.png` |
| QA-06 | Offer builder · anonymity | As Bogdan, open `/ops/lines/REQ-2026-0301-01?tab=offer`. The Tongfu quote is `EXW Linyi`. | Port defaults to the offer's shipping port (Ningbo), or stays empty. A factory city never ends up client-visible (AC-OFFER-01 forbids `Linyi`). | `offer-port` is pre-filled with **Linyi** and the incoterm with FOB, i.e. "FOB Linyi", which is an inland factory city. QA-01 shows the leak check does not catch city names, so sending a new version would publish the factory's city. On REQ-2026-0327-01 the port was pre-filled the same way from the quote ("Shenzhen 深圳"). | `qa-shots/b9_offer_builder.png` |
| QA-07 | Sourcing state machine | 1. On a freshly frozen line (e.g. claim REQ-2026-0327-01, freeze the spec, save cost and confirm the target), add 2 suppliers on the Sourcing board and **Log quote** on both. 2. Then click **Mark RFQ sent**. 3. Shortlist one supplier and Mark it selected / Negotiating. 4. Open the Offer tab and fill the ladder. | The line moves to `quotes_in` → `shortlisted` / `negotiating`, and "Send offer" becomes enabled. | Logging quotes in `cost_target_price` does not advance the state. After Mark RFQ sent the line sits in **RFQ OUT** permanently, although the board shows "2 quotes", one selected and one negotiating. **Send offer is disabled with no tooltip or reason.** The only way out is header **Change state**, and that dialog does nothing on Submit unless you first click the single radio option (it is not preselected, and there is no error). | `qa-shots/b9_offer_builder.png`, `qa-shots/b10_change_state.png` |
| QA-08 | Client request page (F-06) | 1. As Piotr, look for any link to `/app/requests/REQ-2026-0312` on the dashboard, list, line or order pages. None exists; the page is reachable only by typing the URL, or right after creating a request. 2. Open it. | Per F-06 the page has an "Ask about this request" box, and frozen lines show a lock plus **Request a change** (AC-REQ-02/03). | The page has only Updates / Documents / History tabs and no Ask box. Every frozen line says "Spec confirmed — ask us for a change", but no change-request action exists anywhere: not here and not on the line page. The client cannot raise a formal change request, and the `change_requested` exception can only come from an offer. | `qa-shots/inspect_app_requests_REQ-2026-0312.png` |
| QA-09 | Auth · password reset | As any client, open `/login` → **Forgot password?**, enter `piotr@example.pl` and submit. | Either a working reset flow, or the link is hidden until it is built. | The page says "If an account exists for that address, a reset link is on its way." The reset page does not exist (RUNBOOK §7 known gap), so a locked-out client hits a dead end. The admin invite dialog also shows an **Invite link `/invite/<token>` that returns 404**, and a user who signs in with the temporary password is never asked to change it. | `qa-shots/d2_forgot.png`, `qa-shots/d1_invite_result.png` |
| QA-10 | Factory range → request ownership | 1. As Marko, publish a range for a supplier and client (here FR-0002 → KOFF, Factory F-0043). 2. As KOFF, open `/app/orders/ORD-2026-0301/range`, tick 2 items and click **Request these items**. 3. As Bogdan, look at `/ops`, `/ops/queue` and `/ops?scope=all`. | The new lines get an owner (the order's agent) or appear under Unassigned/Queue with Claim. | REQ-2026-0329-01/-02 are created directly in `negotiating` with agent "—". They are **not** in the Queue, not under Unassigned and not in Bogdan's default "Mine" view; they only show in "All › Waiting on us". Nobody owns them. | `qa-shots/c4_m_after_range_request.png` |
| QA-11 | Client line page after offer decisions | 1. Bogdan sends an offer on REQ-2026-0327-01. 2. Piotr clicks **Ask for changes** on `/app/offers/OFR-2026-0327-01-v1` and sends. 3. Open `/app/lines/REQ-2026-0327-01`. 4. Bogdan sends v2; Piotr **Declines** it and opens the line again. | The page states clearly that a new price is coming. | After the change request, the header says "Price ready · 3 of 9", the stepper sub-label says "**Your price is ready**" and the Price fact says "— on its way", all next to the "Change requested — we're on it" badge. After Decline there is no badge at all: the page still says "Your price is ready" with no price. The offer page itself is correct ("Changes requested — we'll send a new price"). | `qa-shots/c1_line_after_changes.png`, `qa-shots/b13_line_after_decline.png` |
| QA-12 | Client emails / milestone wording | As Piotr, approve the sample at `/app/samples/SMP-2026-0312-02-1`. As KOFF, accept the gloves offer. Check `/ops/outbox` and the line pages. | Wording that reflects "offer accepted, we're preparing your order". | Email subjects: "**Standard sleeves 66×91 mm, 80 µm: order confirmed**" and "Work gloves …: order confirmed". The line chip reads "Order confirmed · 5 of 9", while the sub-label in small print says "Preparing your order confirmation". No order, PI or payment exists yet, so the client may believe the order is placed. | `qa-shots/a2_after_approve.png` |

---

## S3 — Minor

| ID | Area | Steps to reproduce | Expected | Actual | Screenshot |
|---|---|---|---|---|---|
| QA-13 | New request · validation | As Piotr on `/app/requests/new`, paste 1 link, set qty `99999999999999` and click Send. | Inline "quantity too large" error. | The server throws a PGlite `integer out of range` error. The toast "Something went wrong — please try again." appears twice. A request number is burned: the next successful request was REQ-2026-0327 and REQ-2026-0326 does not exist. | `qa-shots/a7_huge_qty_send.png` |
| QA-14 | Cost model | As Bogdan, open `/ops/lines/REQ-2026-0327-01?tab=cost` (any frozen line). Set Material floor `-1`, Process cost `abc`, clear Packaging and click **Save cost model**. | Field errors; nothing saved. | Saves successfully. Material is stored as **$1.0000** (the sign is silently dropped) and `abc` is ignored. "Est. production cost" keeps the old $0.0308, so the components and the estimate disagree. | `qa-shots/b3_negative_cost.png` |
| QA-15 | Ops validation messages | Log quote with no price break, or MOQ `-100`. Set Uplift % to `99999`. | Field-level, human messages. | Raw zod toasts: "Too small: expected array to have >=1 items", "Too small: expected number to be >=0", "Too big: expected number to be <=500". Nothing is highlighted in the form. | `qa-shots/b7_invalid_quote.png` |
| QA-16 | Silent submits in ops dialogs | a) `/ops/orders/<ord>` → **Record forwarder**, fill only Forwarder, then Book. b) **Change state** without ticking the radio. c) Timeline → **Log WhatsApp** without counterparty/date. d) The Offer tab while the line is in rfq_out. | An error or a disabled-reason hint. | a) and b): nothing happens and the dialog stays open with no message. c) and d): Post / Send are disabled with no explanation. | `qa-shots/b24_forwarder_partial.png` |
| QA-17 | Dates not validated | a) Order Payments → **Mark paid** with Paid on `2030-01-01`. b) PO **Ex-works ETA** `2026-09-01` (past). c) Inspection "Inspected on" 28 Sep while scheduled 20 Oct. | Future payment dates rejected; the others at least warn. | All accepted. The client order page shows "Deposit **PAID 1 Jan 2030**". | `qa-shots/b18_order_after_pay.png`, `qa-shots/koff_final_app_orders_ORD-2026-0301.png` |
| QA-18 | Client artwork section | As Bogdan, **Upload dieline** on ORD-2026-0301 (published OK). As KOFF, open `/app/orders/ORD-2026-0301#artwork`. | The artwork card shows the dieline download. | The card says "**Dieline coming**" plus "Upload artwork". The dieline is only in the Documents tab. The card updates only after the client uploads artwork. | `qa-shots/c2_m_order_artwork.png` |
| QA-19 | Upload errors | As KOFF, **Upload artwork** with a file named `.jpg` that is not an image (`/tmp/qa/fake.jpg`). The same applies to photo uploads. | "This file isn't a valid image". | Toast "Something went wrong." The server log shows `Input buffer contains unsupported image format` (sharp). | — |
| QA-20 | Dashboard → needs-input action | Bogdan uses Timeline → **Ask the client** on REQ-2026-0312-05. Piotr clicks **Answer** on the dashboard card. | Lands on the Ask box, ready to type. | Goes to `/app/lines/REQ-2026-0312-05#ask`, but the **Updates** tab is shown and no textarea. The Ask tab must be clicked separately. Answering did clear the exception correctly. | `qa-shots/c6_answer.png` |
| QA-21 | Ops global search | Click **Search or jump to… ⌘K** in the ops sidebar, or press Ctrl/⌘+K. | A search dialog (F-02, `GET /api/ops/search`). | Nothing happens. The button has no handler (`src/components/ops/ops-shell.tsx:45`), and `/api/ops/search` does not exist. | `qa-shots/search_open.png` |
| QA-22 | Offer content | Build and send an offer with "Sample before order" ticked and Sample cost left empty (only the placeholder 45.00 shows). Open it as the client. | Sample cost is required when a sample is required. | The client sees "Sample **—**", "Sample before order **yes**". There is no cost and no payer, so the client has to ask. | `qa-shots/c1_offer.png` |
| QA-23 | Anonymity · factory label | After Bogdan marks Yuantuo selected on REQ-2026-0327-01 and sends an offer, open `/app/lines/REQ-2026-0327-01` as Piotr. Similar: `/app/lines/REQ-2026-0312-02`, `/app/lines/REQ-2026-0301-01` (F-0043). | Per SPEC 5.5, the "Factory F-nnnn" label appears only on the range page, the "More from this factory" link and lines created from the range. | A "Factory F-0042" badge appears in the line header of every line whose selected supplier has a range. This happens even at offer stage, before the client accepts, so the client can map which lines are made by the same factory. | `qa-shots/c1_line_after_changes.png`, `qa-shots/piotr_d_app_lines_REQ-2026-0312-02.png` |
| QA-24 | Client payload hygiene | View the source of any `/app` page. | Only the `app.*` strings and client DTO fields. | The whole `messages/en.json` is serialised into every client page, including ops strings ("Cost model + target price", "Suppliers", `"E_LEAK_CHECK":"Blocked: the text names a supplier."`, `participation_status` labels). Client DTOs also carry internal enum values (`"state":"spec_frozen"`). No supplier identity is exposed, but it reveals the internal model (target prices, factory participation). | — |
| QA-25 | Order close-out data | Drive ORD-2026-0301 through Arrived → Mark delivered, then open it as KOFF. | Customs "Cleared" (or hidden) once delivered; PO completed. | The client sees "CUSTOMS **In progress**" next to "DELIVERED 28 Sep 2026". The ops PO stays "IN PRODUCTION" after delivery, and it was never "issued" (draft → in_production). | `qa-shots/koff_final_app_orders_ORD-2026-0301.png` |
| QA-26 | New client onboarding | Admin **+ Client** creates `newbuyer@example.pl`, then that user signs in with the temporary password. | Forced password change on first sign-in (tokens exist per RUNBOOK). | The user lands directly on `/app`, and the random temporary password stays valid indefinitely. The same run also shows the admin form accepts a VAT-like string (`PL1234567890`) as the contact's name without complaint. | `qa-shots/d2_newclient_dash.png` |
| QA-27 | Offer builder source list | On `/ops/lines/REQ-2026-0327-01?tab=offer` after dropping SUP-0018. | Dropped / cannot_make participations are not selectable as option sources. | "Ningbo QA Test Packaging … $0.0450/pcs · dropped · 2 flags" is still a tickable source. | `qa-shots/b11_after_send.png` |

---

## S4 — Polish

| ID | Area | Steps / location | Expected | Actual | Screenshot |
|---|---|---|---|---|---|
| QA-28 | Client · on hold | Bogdan → Timeline → **Put on hold** on REQ-2026-0312-14 with reason "waiting for client volume". Piotr opens `/app/lines/REQ-2026-0312-14`. | Badge "On hold" plus the reason (SPEC 3.5). | Badge only, no reason. | `qa-shots/b39_client_onhold.png` |
| QA-29 | Ops dashboard lists | `/ops` (Bogdan). | Unassigned lines appear only under Unassigned. "Since" is when the question was asked. | Submitted, unassigned lines are also listed under "Waiting on us". REQ-2026-0312-05 "Needs input" shows "since 23 Sep", but the question was asked 28 Sep (it uses the last state change). | `qa-shots/b39_ops_dash.png` |
| QA-30 | Delivery note duplicated | KOFF: **Confirm delivery** with an "Any issues?" note. | One entry. | Updates shows the note as a comment **and** "Delivery confirmed — <note>". | `qa-shots/a3_after_confirm.png` |
| QA-31 | Raw spec keys to client | `/app/lines/REQ-2026-0312-02` "What we confirmed" shows `pvc_free`. `/app/catalog/PRD-0001` shows "Load Total", "Load Per Shelf". | Human labels. | snake_case / auto-title-cased keys. | `qa-shots/a2_line02_after.png` |
| QA-32 | µ uppercase | `/app/orders/ORD-2026-0312` eyebrow. | "100 µM" or keep case. | CSS uppercase turns µ into Greek capital Mu: "100 **ΜM**". | `qa-shots/piotr_d_app_orders_ORD-2026-0312.png` |
| QA-33 | Avatar initials | KOFF user "Anna (KOFF)". | "AK" or "A". | Avatar shows "**A(**". | `qa-shots/koff_d_app.png` |
| QA-34 | Units / number formatting | Offer and line pages. | "10,000 pairs", "1,000 sets", "$0.052 / pc + $450.00 fee". Decimals consistent. | "10,000 pair", "at 1,000 set", "$0.052 / pcs+ $450.00 fee" (missing space). Ops shows "$0.058" next to "$0.0601". A qty of 2.5 gets "Enter a quantity" instead of "whole numbers only". | `qa-shots/c1_offer.png` |
| QA-35 | Client-visible jargon | `/app/orders/ORD-2026-0290`. | "Your forwarder", no visibility badges. | "Rohlig Suus **(client)**"; the shipping docs carry a "**CLIENT**" visibility badge. The request page shows "Sent from the portal" / "Imported from a file". | `qa-shots/koff_d_app_orders_ORD-2026-0290.png` |
| QA-36 | Sample tracking | `/app/samples/SMP-2026-0312-02-1`. | The tracking number links to the courier (F-09 "tracking link"). | Plain text. | `qa-shots/piotr_d_app_samples_SMP-2026-0312-02-1.png` |
| QA-37 | Emoji in ops tables | `/ops` row "Card box 🃏 with magnet — 磁铁卡盒". | The emoji renders. | A tofu box (the font has no emoji fallback). | `qa-shots/search_open.png` |
| QA-38 | Ops navigation | Sidebar. | "Factory ranges" is in the nav (SPEC 2.3). | Missing; the page is reachable only via a supplier page. | `qa-shots/search_open.png` |
| QA-39 | Phone dashboard | `/app` at 390 px. | Compact rows. | Each line has a lone "—" row (empty ETA). Recent updates repeats the full date and time beside the day header, which squeezes the text to about 40 % width. | `qa-shots/piotr_m_app.png` |
| QA-40 | Email subjects / URLs | `/ops/outbox`, `.data/qa/outbox.log`. | Consistent subjects and absolute URLs. | Mixed case: "ORD-2026-0301: quality check" vs "…: In production — ex-works ETA …". Wrong plural: "(1 lines)". Catalog and reorder subjects drop the client name. Reorder is not titled "Repeat order". Payload `url` values are relative (`/app/lines/…`), which is unusable in a real email (the Resend sender is a known gap). | `qa-shots/b26_outbox.png` |
| QA-41 | Password hint order | `/app/settings`: new password `short`. | "At least 10 characters". | "Include at least one digit". | — |
| QA-42 | Inline supplier without contact | Sourcing board **+ Supplier** → create inline with only a legal name. | No contact row. | An empty contact is created: the supplier page shows "(no name) · Alibaba", and the board "Contact" column shows "Alibaba". | `qa-shots/b8_board_status.png` |
| QA-43 | Range item unit | `/ops/factory-ranges/FR-0002` → Add item, type `0.31` in Unit. | Unit select / validation. | Accepted. The client sees "6,000 0.31" on the resulting request lines. | `qa-shots/c4_m_after_range_request.png` |
| QA-44 | Range page breadcrumb | `/app/orders/ORD-2026-0301/range`. | Breadcrumb back to the order. | Eyebrow reads "Catalog". | `qa-shots/b38_koff_range.png` |
| QA-45 | Supplier KPI | `/ops/suppliers/SUP-0001` → Performance. | The label matches the formula. | Labelled "ON-TIME … ex-works vs promised", but computed as delivered vs port ETA. Ecosino shows 0 % because the warehouse delivery came 2 days after port arrival. | — |
| QA-46 | File download filename | `GET /api/files/…/client/<uuid>.pdf?filename=ZZLEAKTEST-Yuantuo.pdf&dl=1` as the owning client. | Filename comes from the DB record. | `Content-Disposition` echoes whatever `filename` query is supplied (spoofable names). Access control itself held: other org → 404, `/internal/` → 404, traversal → 400, no session → 401. | — |
| QA-47 | Offer v2 builder | After a change request, open the Offer tab. | Previous option values carried over. | Deviations, sample and other fields are blank again, and Send fails with "Deviations text required". | — |
| QA-48 | Ops order header | ORD-2026-0301 after **Approve artwork** (before Start production). | "Start production". | The header still reads "WAITING ON US · Artwork review". The stepper sub-label shows the raw enum (`order_confirmed`, `awaiting_artwork`). | `qa-shots/b19_order_production.png` |
| QA-49 | Payments table order | Mark the deposit and fee paid on ORD-2026-0301. | Stable order: Deposit, Fee, Balance. | Balance moves to the top (ops and client). | `qa-shots/b18_order_after_pay.png` |
| QA-50 | Decline default | `/app/offers/<ref>` → **Decline**. | The client picks a reason. | "Too expensive" is preselected, so one click sends that reason. | `qa-shots/b13_decline_dlg.png` |
| QA-51 | Range supplier picker | `/ops/factory-ranges/new`. | All suppliers, or a "type to search more" hint. | Only SUP-0001…0012 are listed; SUP-0013…0018 appear only after searching. | — |
| QA-52 | Seed data | Piotr's lines show "Your reference **KOFF-312-02**" etc. (SPEC 7.6 seeds `client_sku` this way). | A client never sees another client's name. | "KOFF", another client's name, appears on Piotr's pages. It is a seed issue, but it looks like cross-client data to a demo audience. | `qa-shots/c6_answer.png` |

---

## Anonymity crawl (plan E) — results

- **Pages crawled:** 76 `/app` URLs (dashboard, list tabs, every line, offer, sample, order, `/range`, `/app/ranges/<id>`, catalog, product, settings) for both clients, at desktop and 390 px. I also fetched every client file link found (PI, invoices, QC report, BL, packing list, dieline, artwork, range PDF).
- **Scanned for:** all 17 supplier legal and CN names, contact names and handles, `Co., Ltd`, `有限公司`, `+86`, wechat, alibaba/1688 domains, `SUP-`, `PO-20`, `T/T`, `ZZLEAKTEST`.
- **Seeded data is clean.** No supplier identifier in any page HTML, file name or file body. Client email rows in `outbox.log` (65) are also clean.
- **Hits:** only the strings I injected through the leak-check gaps in QA-01 (`Daryl`, `源拓`, `李小姐`, `Linyi`, `Dongguan`). Other matches are allowed: the client's own pasted `alibaba.com` link on the KOFF draft, and the client-arranged forwarder `Rohlig Suus`.
- **Guardrails that held:**
  - Offer send blocked `Yuantuo` / `WeChat` in deviations and `+86 138…` in the note to client.
  - Document publish blocked `Linyi-Tongfu-PI.pdf` (filename) and a QC report whose **PDF text layer** named the supplier.
  - Product publish blocked "made by Yuantuo".
  - Range publish blocked an item named "Tongfu …".
  - Internal notes and WhatsApp logs never reach the client.
- **Access control was correct:**
  - Piotr gets 404 on every KOFF ref (line, offer, order, range, request, draft, sample, private product), on `/ops/**`, on `/api/ops/**`, and on KOFF's client files.
  - Bogdan visiting `/app/**` is redirected to `/ops`.
  - Anonymous visits redirect to `/login?next=…` and return to the page after sign-in.
  - `next=/ops/...`, `https://evil…` and `//evil…` are ignored after login.
  - The agent sees Settings read-only and has no "+ Client" or "Run worker" controls.

## Performance (plan F)

Every page stayed well under 1.5 s on `next start`:
- **Client pages:** 70–360 ms. The slowest were `/app/orders/ORD-2026-0312` and the first `/app/samples/…` hit.
- **Ops pages:** 100–220 ms. The slowest was the line Timeline tab.
- **Server actions:** 1–2.5 s including navigation.

The only "slow" feel comes from QA-02 and QA-16, where the UI does nothing and looks unresponsive.

## What works well

- **The core happy paths work end to end with correct side effects.**
  - Client: sample approve, offer accept / ask for changes / decline, confirm delivery, catalog "Request offer", range "Request these items", artwork upload.
  - Agent: claim and assign, spec freeze with confirm dialog, cost model to target, quotes in CNY with price breaks (normalised at 6.6933), offer v1→v2, confirm order, PI publish, payments, dieline, artwork approval, start production, inspection pass (balance due and email), forwarder, shipped, departed, arrived, delivered.
  - Each step updates the client milestone, the Updates feed and the outbox correctly.
- **The leak-check UX is excellent where it applies.** The publish dialog shows per-source results (filename / text / PDF text layer) with the matched rule. Blocked publishes also notify admins (`ops_leak_blocked`).
- **The data model is solid on double-submits.** Double-clicking Claim, Confirm order, Send request, Accept, Approve and Send offer never created duplicates.
- **Tracking parameters are stripped correctly** (`srsltid`, `utm_*`, `fbclid`, eMAG `ref=`). Emoji and Chinese text survive in names, notes, spec values and supplier names.
- **Client copy is mostly plain and reassuring.** Examples: "Price — on its way", "Received — we are assigning it", "What happens next", "Nothing is waiting on you". Money is consistently `$1,234.56` and dates are consistently `28 Sep 2026`.
- **No console errors, page errors or unexpected 4xx/5xx** on any page. The only 5xx came from QA-13 and QA-19 inputs.
- **Pages load fast and the design is calm and legible.** Phone layout is clean everywhere except the long-URL case (QA-03).
- **Admin flows work:** client invite with a one-time password, pricing rule validation (−10 and 150 % rejected), and product publish/unpublish (unpublished products 404 for clients immediately).

## UX friction for the client — things that would send Piotr back to WhatsApp

1. **The deposit is due but there is no invoice** (QA-04). "Invoice ready" and "invoice issued" appear three times, yet there is nothing to download until the agent remembers to publish the PI.
2. **"Your price is ready" with no price** after he asked for changes or declined (QA-11). He cannot tell whether his message was received.
3. **No way to change a confirmed spec** (QA-08). The UI says "ask us for a change", but there is only a generic Ask box on the line, and the request page has none.
4. **Pasting links then hitting Send does nothing on the first click** (QA-02). The same effort as WhatsApp is the whole promise of that screen.
5. **"Order confirmed" email and chip right after approving a sample** (QA-12). He believes the order is placed, then waits days for an invoice.
6. **Answer link opens the wrong tab** (QA-20). The dieline is "coming" when it is already there (QA-18). The offer shows no sample cost when a sample is required (QA-22).
7. **Forgot password promises a link that never comes** (QA-09).
8. **On phone, a line page with a long Allegro link scrolls sideways** (QA-03).
9. **Money details that raise questions:** "PAID 1 Jan 2030" (QA-17), and "Customs in progress" on a delivered order (QA-25).

## Environment notes

- The server ran on port 3201 with `AUTH_RATE_LIMIT=off`, so login throttling (AC-AUTH-09) was not assessed. Per RUNBOOK §7 it is a known gap: 6 wrong passwords followed by the right one still logs in.
- **Known gaps confirmed, not counted separately:** `/invite/[token]`, `/reset-password`, `/ops/lines/[ref]/preview`, `/ops/lines/[ref]/samples`, `/api/app/**` JSON routes, R2 and Resend.
- The server was stopped at the end (only the 3201 process). Throwaway scripts are in `/tmp/qa/`.

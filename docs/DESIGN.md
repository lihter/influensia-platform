# Influensia Sourcing Platform — Design System

Version 1.0 · 2026-09-28 · Target stack: Next.js 16, Tailwind CSS 4, shadcn/ui (Radix), Lucide icons, TanStack Table, sonner.
Scope: `/app` (client portal) and `/ops` (agent + admin workspace). Light theme is the default; dark theme is supported through `.dark` on `<html>` and is optional for v1 (ops users may want it; clients get light unless they opt in).

Sources this document is derived from:
- `docs/BRAND_INPUT.md` + `docs/brand_influensia_ro.png` — measured brand colours (ink #171717, off-white #FAFAF7, sage #97CF8D, deep #4F8A45, dark green #0F2A0B, beige hairlines #E0D9CA/#E8E3D8/#F0ECE2), radius .75rem cards, numbered green eyebrow pills, alternating white / off-white / near-black sections, black primary button + sage secondary button.
- TAVRO (`$HOME/mnt/freightex`) — the user's freight exchange. Patterns carried over are quoted inline where used: the "sheet" list (`sheetListClass = 'divide-y-2 divide-line overflow-hidden rounded-tile border-2 border-line bg-paper'`), alternating `bg-paper` / `bg-surface` section bands (`HomePage.tsx`), the sticky uppercase table header with an ink bottom rule (`BoardTable.tsx`: `sticky top-0 z-20 … text-[0.6875rem] font-bold uppercase tracking-[0.1em]` + `boxShadow: 'inset 0 -2px 0 var(--color-ink)'`), `NUM = 'font-mono tabular-nums text-[0.8125rem]'`, 40px desktop rows (`dimension.desktop-row`), the tone-keyed `Stamp` chip (`ok / warn / info / attention / danger / outline / grey / dashed`), `DetailRow` (`border-b border-line py-2.5 last:border-b-0`), the `1fr / minmax(20rem,24rem)` detail grid with a `lg:sticky lg:top-6` rail, the accent underline / left-bar active nav (`border-b-2 border-magenta`, `border-l-4`), status colours (`ok #177334 · warn #8F5A00 · info #1A5CB8 · danger #B42318` with wash + border), motion durations (`press 70ms · state 120ms · settle 200ms`) and the global reduced-motion rule. Deliberately NOT carried over: 2px ink borders everywhere, lime/magenta, 16px tile radius, hard press shadow, grain texture, 56px glove tap targets — those solve a truck-cab problem this product does not have. TAVRO fixed v1 "flatness" with heavy strokes; Influensia fixes it with background layering (page → section-alt → white card) plus beige hairlines, which is what the brand site already does.
- `docs/blueprint.html` §08 UX (New request, Order page, Sourcing board wireframes), §03 decisions D-01…D-23, §06 data model (9 milestones, 24 internal states, participation statuses, document visibility), §07 anonymity mechanisms.

---

## 1. Design principles

1. **Two doors, one language.** `/app` and `/ops` share every token and component; they differ in density and in what is shown, never in style. A client and an agent looking at the same order see the same stepper, the same chips, the same facts strip.
2. **Actions first (D-06).** The first thing a client sees is the "Waiting on you" card; the first thing an agent sees is stale / waiting-on-us / unassigned counts. Nothing decorative sits above these.
3. **Client side is calm: one green surface per page.** Only the "Waiting on you" card and the ▲ milestone are allowed a green fill. Everything else is ink on off-white with beige hairlines. Few actions, large targets, no tables wider than the phone.
4. **Ops side is a scanning instrument.** 40px rows, sticky headers, mono right-aligned numbers, chips with text (never colour alone), stale rows flagged in one column, keyboard nav (`J K ⏎ /`). Density is a first-class setting, not an afterthought.
5. **Division by ground, not by stroke.** Sections are told apart by background layer (page #FAFAF7 → section-alt #F3F1EA → white card) and one hairline; lists are one bordered object parted by rules (the TAVRO "sheet"), never N gapped boxes and never a card inside a card.
6. **Numbered structure.** Eyebrow labels ("01 · SPEC", "REQ-2026-0312 · KOFF") are the wayfinding device, inherited from the brand site's 01…09 cards. Every page header, every stacked section on the order page, every tab carries one.
7. **Money is boring on purpose.** Prices, invoices, payments and offers use ink, mono figures, hairlines and nothing else; no green, no motion, no cleverness in that zone (TAVRO's "money zone" rule, kept).

---

## 2. Colour tokens

### 2.1 Light theme (default)

All values are hex. Contrast ratios computed with the WCAG 2.x formula against the grounds they are allowed on (page #FAFAF7, section-alt #F3F1EA, white #FFFFFF).

**Background layers**

| Token | Hex | Use |
|---|---|---|
| `--bg-page` | `#FAFAF7` | App background (brand warm off-white). Body colour. |
| `--bg-section-alt` | `#F3F1EA` | Secondary bands: filter bars, right rails, sidebar, compare bar, expanded table rows, internal-note backgrounds. |
| `--bg-surface` | `#FFFFFF` | Cards, tables, inputs, sheets, popovers. |
| `--bg-surface-raised` | `#FFFFFF` + `--shadow-md` | Popovers, dropdown menus, command palette. Same white; elevation comes from the shadow. |
| `--bg-surface-sunken` | `#F7F6F1` | Table zebra rows (ops compact mode), row hover, disabled inputs. |
| `--bg-inverse` | `#171717` | Toasts, tooltips, primary buttons, the (optional) dark CTA band on the client dashboard. |

**Ink scale**

| Token | Hex | On page | On alt | On white | Use |
|---|---|---|---|---|---|
| `--ink` | `#171717` | 17.1 | 15.9 | 17.9 | Body text, headings, icons. |
| `--ink-strong` | `#111111` | — | — | — | Display headings only. |
| `--ink-2` | `#525252` | 7.5 | 6.9 | 8.0 | Secondary text, inactive sidebar items, table body on low-priority columns. |
| `--muted-fg` | `#5F6670` | 5.6 | 5.1 | 5.8 | Meta text, labels, captions. NOTE: the brand's `#6B7280` is 4.28 on section-alt and fails AA there; `#5F6670` passes on every ground. |
| `--faint-fg` | `#8A8F98` | 3.3 | 3.0 | 3.3 | Placeholders, disabled text, decorative icons only. Never for text the user must read. |
| `--ink-inverse` | `#FFFFFF` | — | — | 17.9 on `#171717` | Text on inverse / primary button. |

**Hairlines and borders** (beige, from the brand's off-white sections)

| Token | Hex | Use |
|---|---|---|
| `--hairline-faint` | `#F0ECE2` | Row dividers inside a card or sheet list; table body row rules. |
| `--hairline` | `#E8E3D8` | Card borders, sheet-list border, tab list bottom rule, top bar bottom rule. |
| `--hairline-strong` | `#E0D9CA` | Section-alt band edges, sidebar right edge, table header bottom rule, KPI tile borders. |
| `--border-input` | `#CFC8B8` | Input/select/textarea rest border. (1.9:1 vs white — below the 3:1 non-text threshold; inputs are always paired with a visible label, a white fill on the off-white page, and a 2px green focus ring, which is how they are identified. If an audit demands strict 1.4.11, switch to `#A9A291` (2.7) or `#9A9382` (3.1).) |
| `--rule-ink` | `#171717` | The single 1px ink rule under a table header and under a stacked-section heading (TAVRO's `border-t-2 border-ink` device, at 1px). |

**Brand green scale**

| Token | Hex | Notes |
|---|---|---|
| `--green-50` | `#F3F9F1` | = sage at 12% on white (the brand's pill background). Waiting-on-you card fill, selected table row. |
| `--green-100` | `#E3F1DF` | Eyebrow pill fill, accent (shadcn `--accent`), current-step fill. |
| `--green-200` | `#C9E6C2` | Waiting-on-you card border, chip borders on green washes. |
| `--green-300` | `#97CF8D` | **Sage** (brand). Fill for the client's ▲ action buttons (with `--green-900` text, 8.6:1). Wordmark on dark. Never as text on light. |
| `--green-400` | `#6FB463` | Charts, stepper "done" dots on dark. |
| `--green-500` | `#4F8A45` | **Deep** (brand). Wordmark on light (large text only: 4.2:1). Icons ≥ 24px. Not for body-size text on white (fails 4.5). |
| `--green-600` | `#3F7A38` | **Interactive on light**: links, focus ring, active nav bar, current step ring, selected-state borders, solid green button fill (white text 5.2:1). 5.2 on white, 4.6 on section-alt, 5.2 on page — AA everywhere. |
| `--green-700` | `#2F5F2A` | Text on `--green-50/100/200` washes (5.6–7.5:1). Eyebrow pill text. `--green-600` on `--green-100` is only 4.4 — do not use it there. |
| `--green-800` | `#1F4419` | Text on sage (6.1). Hover state of solid green button. |
| `--green-900` | `#0F2A0B` | **Dark green** (brand). Text on sage buttons (8.6). Dark-theme primary-foreground. |

**Semantic colours** (text / wash / border). Text tokens pass AA on white, page, alt AND on their own wash.

| Token set | Text | Wash | Border | Contrast (text on white / on wash) | Meaning |
|---|---|---|---|---|---|
| `--success` | `#2E7D32` | `#EAF3EB` | `#A6CDAF` | 5.1 / 4.5 | paid, passed QC, delivered, approved, selected |
| `--warning` | `#8A5A00` | `#FBF0DA` | `#E2C58D` | 5.9 / 5.2 | stale, negotiating, expiring validity, changes requested |
| `--danger` | `#B42318` | `#FBECEC` | `#EFB3AD` | 6.6 / 5.7 | failed QC, cannot_make, declined, leak-check blocked, destructive |
| `--info` | `#1A5CB8` | `#E9F0FA` | `#AECBEF` | 6.4 / 5.6 | quoted, in transit, waiting on us, client question |
| `--neutral` | `#5F6670` | `#F3F1EA` | `#E0D9CA` | 5.8 / 5.1 | contacted, todo, internal, draft |

White on `--danger #B42318` = 6.6 (destructive button). White on `--green-600` = 5.2 (solid green button). Ink `#171717` on `--green-300` = 14.1 (sage button, alternative to `--green-900` text; use `--green-900` for brand fidelity).

**Focus ring**: `--ring: #3F7A38`, 2px solid, `outline-offset: 2px`, on every focusable element via `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`. Inside the ink top bar / toasts use `#97CF8D`.

**Shadows** (very subtle; ink-tinted, never grey-blue)

```
--shadow-sm: 0 1px 2px rgba(23,23,23,0.04);
--shadow-md: 0 2px 8px rgba(23,23,23,0.06), 0 1px 2px rgba(23,23,23,0.04);
--shadow-sheet: 0 8px 32px rgba(23,23,23,0.10);
```
Cards get `--shadow-sm` only when they are interactive (hover lifts to `--shadow-md`). Static cards have no shadow — hairline only.

### 2.2 Dark theme

Ink and page invert; hairlines go neutral (a warm hairline on near-black looks muddy); sage becomes the interactive colour (brand dark CTA banner).

| Token | Hex | Contrast notes |
|---|---|---|
| `--bg-page` | `#111111` | |
| `--bg-section-alt` | `#161616` | |
| `--bg-surface` | `#1A1A1A` | |
| `--bg-surface-raised` | `#202020` | + `--shadow-md` with `rgba(0,0,0,0.5)` |
| `--bg-surface-sunken` | `#141414` | |
| `--bg-inverse` | `#F2F2F2` | toasts/tooltips: light on dark theme, `#171717` text |
| `--ink` | `#F2F2F2` | 15.6 on surface, 14.6 on raised |
| `--ink-strong` | `#FFFFFF` | |
| `--ink-2` | `#C4C4C4` | ~10 on surface |
| `--muted-fg` | `#A3A3A3` | 6.9 on surface, 6.5 on raised, 6.0 on `#262626` (brand's `rgba(255,255,255,.65)` ≈ this) |
| `--faint-fg` | `#7A7A7A` | 4.1 on surface — placeholders/disabled only |
| `--hairline-faint` | `#222222` | |
| `--hairline` | `#2A2A2A` | |
| `--hairline-strong` | `#333333` | |
| `--border-input` | `#3A3A3A` | |
| `--rule-ink` | `#F2F2F2` | |
| `--green-300` (sage) | `#97CF8D` | **Interactive on dark**: links, focus ring, active nav, primary button fill (text `#0F2A0B`, 8.6). 9.6 on surface. |
| `--green-wash` | `#1E2E1B` | Waiting-on-you fill, selected row, accent. Text on it: `#B7E0AF` (≈9:1). |
| `--green-wash-border` | `#2F4A2B` | |
| `--success` | `#7ED27A` / wash `#17281A` | 9.4 on surface / 9.2 on wash |
| `--warning` | `#E5B25B` / wash `#2B2416` | 9.0 / 7.9 |
| `--danger` | `#F08A80` / wash `#2E1A18` | 7.2 / 6.8. Destructive button fill `#C0392B` with white text (5.4). |
| `--info` | `#7FB3F0` / wash `#172234` | 8.0 / 7.3 |
| `--neutral` | `#A3A3A3` / wash `#262626` | 6.0 |
| `--ring` | `#97CF8D` | |

### 2.3 shadcn/ui variables — paste into `globals.css`

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

:root {
  /* shadcn */
  --background: #FAFAF7;
  --foreground: #171717;
  --card: #FFFFFF;
  --card-foreground: #171717;
  --popover: #FFFFFF;
  --popover-foreground: #171717;
  --primary: #171717;               /* brand primary button = black, white text */
  --primary-foreground: #FFFFFF;
  --secondary: #ECE9E0;             /* tertiary buttons on white cards; use variant=outline for real secondaries */
  --secondary-foreground: #171717;
  --muted: #F3F1EA;                 /* = section-alt */
  --muted-foreground: #5F6670;
  --accent: #E3F1DF;                /* green-100: hover/selected in menus, current step fill */
  --accent-foreground: #0F2A0B;
  --destructive: #B42318;
  --destructive-foreground: #FFFFFF;
  --border: #E8E3D8;                /* beige hairline */
  --input: #CFC8B8;
  --ring: #3F7A38;
  --chart-1: #3F7A38;
  --chart-2: #97CF8D;
  --chart-3: #525252;
  --chart-4: #C4A35A;               /* wheat — warm, on-brand fourth series */
  --chart-5: #1A5CB8;
  --radius: 0.5rem;                 /* sm 4 · md 6 · lg 8 · xl 12 (cards) */
  --sidebar: #F3F1EA;
  --sidebar-foreground: #171717;
  --sidebar-primary: #171717;
  --sidebar-primary-foreground: #FFFFFF;
  --sidebar-accent: #FFFFFF;        /* active item fill */
  --sidebar-accent-foreground: #171717;
  --sidebar-border: #E0D9CA;
  --sidebar-ring: #3F7A38;

  /* Influensia extensions */
  --bg-section-alt: #F3F1EA;
  --bg-surface-sunken: #F7F6F1;
  --bg-inverse: #171717;
  --ink-2: #525252;
  --faint-fg: #8A8F98;
  --hairline-faint: #F0ECE2;
  --hairline-strong: #E0D9CA;
  --rule-ink: #171717;
  --green-50: #F3F9F1; --green-100: #E3F1DF; --green-200: #C9E6C2; --green-300: #97CF8D;
  --green-400: #6FB463; --green-500: #4F8A45; --green-600: #3F7A38; --green-700: #2F5F2A;
  --green-800: #1F4419; --green-900: #0F2A0B;
  --brand-link: #3F7A38;
  --brand-action: #97CF8D;          /* client ▲ action button fill */
  --brand-action-fg: #0F2A0B;
  --success: #2E7D32; --success-wash: #EAF3EB; --success-border: #A6CDAF;
  --warning: #8A5A00; --warning-wash: #FBF0DA; --warning-border: #E2C58D;
  --danger: #B42318;  --danger-wash: #FBECEC;  --danger-border: #EFB3AD;
  --info: #1A5CB8;    --info-wash: #E9F0FA;    --info-border: #AECBEF;
  --neutral: #5F6670; --neutral-wash: #F3F1EA; --neutral-border: #E0D9CA;
  --shadow-sm: 0 1px 2px rgba(23,23,23,.04);
  --shadow-md: 0 2px 8px rgba(23,23,23,.06), 0 1px 2px rgba(23,23,23,.04);
  --shadow-sheet: 0 8px 32px rgba(23,23,23,.10);
}

.dark {
  --background: #111111;
  --foreground: #F2F2F2;
  --card: #1A1A1A;
  --card-foreground: #F2F2F2;
  --popover: #202020;
  --popover-foreground: #F2F2F2;
  --primary: #97CF8D;
  --primary-foreground: #0F2A0B;
  --secondary: #262626;
  --secondary-foreground: #F2F2F2;
  --muted: #1F1F1F;
  --muted-foreground: #A3A3A3;
  --accent: #1E2E1B;
  --accent-foreground: #B7E0AF;
  --destructive: #C0392B;
  --destructive-foreground: #FFFFFF;
  --border: #2A2A2A;
  --input: #3A3A3A;
  --ring: #97CF8D;
  --chart-1: #97CF8D; --chart-2: #4F8A45; --chart-3: #A3A3A3; --chart-4: #C4A35A; --chart-5: #7FB3F0;
  --sidebar: #161616;
  --sidebar-foreground: #F2F2F2;
  --sidebar-primary: #97CF8D;
  --sidebar-primary-foreground: #0F2A0B;
  --sidebar-accent: #232323;
  --sidebar-accent-foreground: #F2F2F2;
  --sidebar-border: #262626;
  --sidebar-ring: #97CF8D;

  --bg-section-alt: #161616;
  --bg-surface-sunken: #141414;
  --bg-inverse: #F2F2F2;
  --ink-2: #C4C4C4;
  --faint-fg: #7A7A7A;
  --hairline-faint: #222222;
  --hairline-strong: #333333;
  --rule-ink: #F2F2F2;
  --green-50: #1E2E1B; --green-100: #1E2E1B; --green-200: #2F4A2B;   /* washes collapse to one dark wash */
  --brand-link: #97CF8D;
  --brand-action: #97CF8D;
  --brand-action-fg: #0F2A0B;
  --success: #7ED27A; --success-wash: #17281A; --success-border: #2E5A2C;
  --warning: #E5B25B; --warning-wash: #2B2416; --warning-border: #5C4A22;
  --danger: #F08A80;  --danger-wash: #2E1A18;  --danger-border: #5E2C28;
  --info: #7FB3F0;    --info-wash: #172234;    --info-border: #2B4468;
  --neutral: #A3A3A3; --neutral-wash: #262626; --neutral-border: #3A3A3A;
  --shadow-sm: 0 1px 2px rgba(0,0,0,.4);
  --shadow-md: 0 2px 8px rgba(0,0,0,.5), 0 1px 2px rgba(0,0,0,.4);
  --shadow-sheet: 0 8px 32px rgba(0,0,0,.6);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1); --color-chart-2: var(--chart-2); --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4); --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);

  /* extensions → utilities: bg-section-alt, text-ink-2, border-hairline-strong, bg-green-50, text-success … */
  --color-section-alt: var(--bg-section-alt);
  --color-surface-sunken: var(--bg-surface-sunken);
  --color-inverse: var(--bg-inverse);
  --color-ink-2: var(--ink-2);
  --color-faint: var(--faint-fg);
  --color-hairline-faint: var(--hairline-faint);
  --color-hairline: var(--border);
  --color-hairline-strong: var(--hairline-strong);
  --color-rule-ink: var(--rule-ink);
  --color-green-50: var(--green-50); --color-green-100: var(--green-100); --color-green-200: var(--green-200);
  --color-green-300: var(--green-300); --color-green-400: var(--green-400); --color-green-500: var(--green-500);
  --color-green-600: var(--green-600); --color-green-700: var(--green-700); --color-green-800: var(--green-800);
  --color-green-900: var(--green-900);
  --color-link: var(--brand-link);
  --color-action: var(--brand-action);
  --color-action-foreground: var(--brand-action-fg);
  --color-success: var(--success); --color-success-wash: var(--success-wash); --color-success-border: var(--success-border);
  --color-warning: var(--warning); --color-warning-wash: var(--warning-wash); --color-warning-border: var(--warning-border);
  --color-danger: var(--danger);   --color-danger-wash: var(--danger-wash);   --color-danger-border: var(--danger-border);
  --color-info: var(--info);       --color-info-wash: var(--info-wash);       --color-info-border: var(--info-border);
  --color-neutral: var(--neutral); --color-neutral-wash: var(--neutral-wash); --color-neutral-border: var(--neutral-border);

  --radius-sm: calc(var(--radius) - 4px);   /* 4px  checkbox, mini chips */
  --radius-md: calc(var(--radius) - 2px);   /* 6px  table cells, dense chips, menu items */
  --radius-lg: var(--radius);               /* 8px  buttons, inputs, tabs, popovers */
  --radius-xl: calc(var(--radius) + 4px);   /* 12px cards, sheets, drop zone (= brand .75rem) */
  --radius-2xl: calc(var(--radius) + 8px);  /* 16px client offer option cards only */

  --shadow-sm: var(--shadow-sm);
  --shadow-md: var(--shadow-md);
  --shadow-sheet: var(--shadow-sheet);

  --font-sans: "Figtree", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;

  --text-2xs: 0.6875rem; --text-2xs--line-height: 1rem;        /* 11px chips, eyebrows */
  --text-xs: 0.75rem;    --text-xs--line-height: 1rem;         /* 12px meta */
  --text-sm: 0.875rem;   --text-sm--line-height: 1.25rem;      /* 14px body (app default) */
  --text-base: 0.9375rem;--text-base--line-height: 1.5rem;     /* 15px client prose */
  --text-lg: 1.125rem;   --text-lg--line-height: 1.75rem;      /* 18px h2 */
  --text-xl: 1.5rem;     --text-xl--line-height: 2rem;         /* 24px h1 */
  --text-2xl: 2rem;      --text-2xl--line-height: 2.5rem;      /* 32px display */
  --text-kpi: 1.75rem;   --text-kpi--line-height: 2rem;        /* 28px KPI figure */

  --ease-out: cubic-bezier(0.2, 0, 0, 1);
  --duration-press: 70ms;
  --duration-state: 120ms;
  --duration-settle: 200ms;
}

@layer base {
  * { @apply border-border; }
  body { @apply bg-background text-foreground font-sans text-sm antialiased; }
  h1, h2, h3 { @apply text-foreground; letter-spacing: -0.01em; }
  .font-mono { font-feature-settings: "tnum" 1, "zero" 1; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
  }
}
```

Component overrides on top of shadcn defaults (edit the generated component files once):
- `Button`: `rounded-lg` (8px) instead of `rounded-md`; add variant `action` = `bg-action text-action-foreground hover:bg-green-400`; add variant `green` = `bg-green-600 text-white hover:bg-green-700` (ops-only confirmations such as "Select supplier"); `outline` = `border-input bg-card hover:bg-surface-sunken`.
- `Card`: `rounded-xl border border-border bg-card shadow-none`; `CardHeader` padding `p-5`; body `px-5 pb-5`.
- `Badge`: see §5.3 chip families; base `rounded-md text-2xs font-semibold uppercase tracking-[0.06em] h-[22px] px-2`.
- `Input`, `Select`, `Textarea`: `h-9 rounded-lg border-input bg-card placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 focus-visible:border-ring`.
- `Tabs` (underline style): `TabsList` = `h-10 gap-6 border-b border-border bg-transparent p-0 rounded-none`; `TabsTrigger` = `rounded-none border-b-2 border-transparent px-0 pb-3 text-sm text-ink-2 data-[state=active]:border-green-600 data-[state=active]:text-foreground data-[state=active]:font-semibold data-[state=active]:shadow-none`.
- `Sheet`: `SheetContent side="right"` width `w-full sm:max-w-[30rem]` (480px) default, `sm:max-w-[40rem]` for quote logging; `rounded-l-xl`; `shadow-sheet`.
- `Sidebar` (shadcn `sidebar-07` pattern): width `14.5rem` expanded, `3.5rem` icon rail.

---

## 3. Typography

**Fonts** (Google Fonts, free; loaded with `next/font/google`, which downloads at build time and self-hosts — no runtime request to Google, which matters for EU visitors; TAVRO's `fonts.css` records the same GDPR reason).

| Role | Font | Weights | Why |
|---|---|---|---|
| UI + display | **Figtree** | 400, 500, 600, 700 | Closest free match to Proxima Nova's rounded humanist-geometric shapes (open `a`, round `o`, low contrast, friendly `g`), excellent at 12–14px, latin-ext (ł ś ź for Polish, č ć đ š ž for Croatian). |
| Numbers, refs, tables, code | **JetBrains Mono** | 400, 500, 600 | Tabular by construction, tall x-height, slashed zero, distinct `1 l I`, latin-ext. Used for EVERY money value, quantity, percentage, date in tables, reference (`REQ-2026-0312`, `SUP-0042`, `F-0042`) and KPI figure. |

```ts
// app/layout.tsx
import { Figtree, JetBrains_Mono } from "next/font/google";
const sans = Figtree({ subsets: ["latin", "latin-ext"], weight: ["400","500","600","700"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin", "latin-ext"], weight: ["400","500","600"], variable: "--font-mono", display: "swap" });
```

**Type scale** (rem at 16px root)

| Style | Size / line | Weight | Tracking | Font | Use |
|---|---|---|---|---|---|
| Display | 32 / 40 | 600 | -0.015em | Figtree | Client dashboard greeting line, offer headline price context. Client only; ops never uses display. |
| H1 | 24 / 32 | 600 | -0.01em | Figtree | Page title in the page header. One per page. |
| H2 | 18 / 28 | 600 | -0.005em | Figtree | Card / section titles ("Payments", "Options"). |
| H3 | 15 / 24 | 600 | 0 | Figtree | Sub-blocks inside cards, sheet form sections, offer option labels. |
| Body | 14 / 20 | 400 | 0 | Figtree | App default (ops tables, forms, timeline). |
| Prose | 15 / 24 | 400 | 0 | Figtree | Client explanatory paragraphs (offer deviations, empty states, "what happens next"). `max-width: 64ch`. |
| Small | 12 / 16 | 400/500 | 0 | Figtree | Meta lines, captions, table secondary lines, helper text. |
| Micro | 11 / 16 | 600 | 0.06em, uppercase | Figtree | Chip text, table headers, KPI labels. Floor: nothing below 11px. |
| Eyebrow | 11 / 16 | 600 | 0.08em, uppercase | Figtree | Section numbering and context labels. Two variants: `plain` (muted text, no pill) and `pill` (brand green pill, see §5.7). |
| Mono figure | 13 / 20 | 400/500 | 0 | JetBrains Mono | Table numbers, facts, refs. 500 for the value the row is about (USD/pc, ETA). |
| Mono large | 20 / 28 | 500 | -0.01em | JetBrains Mono | Facts strip values, offer option price. |
| KPI | 28 / 32 | 600 | -0.02em | JetBrains Mono | Ops dashboard tiles. |

Rules:
- `tabular-nums` (+ `"tnum"`) is on for the mono font globally; also set `tabular-nums` on any Figtree element that shows a count inline (e.g. "3 of 8 quoted").
- Headings are sentence case. Uppercase is reserved for micro/eyebrow/table-header sizes (11px) so it works as a structural signal, not shouting.
- Links: `text-link underline decoration-green-200 underline-offset-[3px] hover:decoration-link` (light) — an underline that is visible but quiet; never green text without underline in body copy.
- Numbers in running text (client prose) may stay in Figtree; the moment a number is compared to another number (a table, a facts strip, a price ladder) it is mono.

---

## 4. Layout system

### 4.1 App shells

**`/app` (client): top bar, no sidebar.**
Why: three destinations (Dashboard · Orders · Catalog) plus one primary action; a sidebar would be 80% empty and steals 240px on a 13" laptop; a top bar mirrors the brand site header (wordmark left, links, black CTA right) and collapses cleanly to 390px.

- Height 56px, `bg-card`, `border-b border-border`, sticky top, `z-40`.
- Inner container `max-w-[72rem] mx-auto px-4 sm:px-6` (1152px content width — the client never needs more).
- Left: wordmark "INFLUENSIA" in Figtree 700 18px tracking 0.04em `text-green-500` (large text → 4.2:1 passes AA-large). Then nav links `text-sm text-ink-2 font-medium`, gap 24px. Active: `text-foreground font-semibold` + 2px `bg-green-600` bar at the very bottom of the bar (`after:absolute after:inset-x-0 after:-bottom-px after:h-0.5`) — the TAVRO `border-b-2` accent-underline device, in green.
- Right: `Button variant="default" size="sm"` "New request" (black), then `Avatar` 32px with `DropdownMenu` (Account, Sign out).
- < 768px: nav collapses into a `Sheet side="left"` (hamburger at left of wordmark); "New request" becomes an icon button (Plus) and is repeated as a full-width button on the dashboard.
- Main: `bg-background`, `py-6 sm:py-8`, gutter `px-4 sm:px-6` (16px on phone — never less).

**`/ops` (agents/admin): left sidebar + no top bar (a slim page header per route instead).**
Why: eight destinations (Dashboard · Requests · Sourcing · Orders · Suppliers · Products · Clients · Settings), a search/command palette, frequent switching, ≥1280px screens; the persistent rail is the "easy to get around" device and the sidebar's own background (section-alt) gives the chrome/content division without a stroke.

- shadcn `Sidebar` (collapsible="icon"): expanded 232px (`14.5rem`), rail 56px; `bg-sidebar` (#F3F1EA) with `border-r border-sidebar-border` (#E0D9CA).
- Header: wordmark 16px `text-green-500` + tiny "OPS" chip (neutral). Below: `Command`-palette trigger styled as a search input ("Search or jump to… ⌘K").
- Items: `h-9 px-3 rounded-lg text-sm font-medium text-ink-2 gap-3`, Lucide 18px icon. Hover `bg-white/60`. Active: `bg-sidebar-accent (white) text-foreground font-semibold shadow-sm` plus a 3px `bg-green-600` bar on the left edge (`before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r`). Count badges right-aligned in mono 11px (`Requests 12`, `Stale 4` in warning colour when > 0).
- Groups: "Work" (Dashboard, Requests, Sourcing, Orders), "Master data" (Suppliers, Products, Clients), footer (Settings, user menu). Group labels = eyebrow plain.
- Content: `max-w-[100rem]` (1600px) `px-6 py-6`; detail pages with a right rail use the grid in §4.3; tables may use the full width.
- Below 1280px the sidebar collapses to the icon rail automatically; below 1024px it becomes an off-canvas sheet. Ops is desktop-first; phone support is "readable", not optimised.

### 4.2 Page header pattern (both doors)

```
[eyebrow: plain or pill]                                   [secondary] [secondary] [Primary] [⋯]
[H1 title]
[meta row: chips · assigned agent · last change]           (optional)
[Tabs]                                                     (optional, underline style)
```
- Eyebrow first (`REQ-2026-0312 · KOFF · Piotr`, or `02 · Sourcing board`), then H1, then the meta row of chips. Actions right-aligned, vertically centred on the H1; at most one `default` (black) or `action` (sage) button, up to two `outline`, everything else in a `DropdownMenu` behind an ellipsis icon button.
- On ops detail pages the header is sticky (`sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border`) so the ref, state and primary action never scroll away; height when stuck: 64px (eyebrow + title only, meta row hides).
- Below the header: 24px gap, then content.
- Phone: actions drop below the title as a full-width row; the primary action stays; secondaries go into the ⋯ menu.

### 4.3 Grids and rails

- Client reading column: `max-w-[72rem]`. Order page inner grid `lg:grid-cols-[1fr_20rem] gap-8` (rail 320px, `lg:sticky lg:top-20`). TAVRO used `[1fr_minmax(20rem,24rem)]` with `lg:sticky lg:top-6`; same idea, fixed 320px here because the client rail holds only facts and one button.
- Ops detail: `xl:grid-cols-[1fr_22rem] gap-6` (rail 352px). The rail is a full-height **section-alt band** (`bg-section-alt border-l border-hairline-strong -my-6 py-6 px-5`) — not a card — holding facts, product history, Log WhatsApp. Cards may sit on the band.
- Ops tables: escape the grid (`col-span-full`) and use the full content width; the compare bar and filter bar sit on section-alt bands above the table.

### 4.4 Section-alt rhythm

The brand site alternates white → #FAFAFA/#FAFAF7 → white → near-black sections. In the app, the rhythm is three grounds, always in this nesting order:

```
page (#FAFAF7)
 └ section-alt band (#F3F1EA, border-y or border-l #E0D9CA)   ← filters, rails, compare bar, sidebar
    └ white card (#FFFFFF, border #E8E3D8, radius 12)            ← content
       └ rows divided by hairline-faint (#F0ECE2)                 ← items (the "sheet")
```
- A white card sits on page or on alt. Never a card on a card. Inside a card, subdivide with `divide-y divide-hairline-faint` rows, a `border-t border-rule-ink pt-4` stacked-section rule (TAVRO's `manifestSectionClass` at 1px), or a section-alt inset (`bg-section-alt -mx-5 px-5 py-3`) for a summary strip.
- The **sheet list** (from TAVRO `sheetListClass`): `divide-y divide-hairline-faint overflow-hidden rounded-xl border border-border bg-card`; rows carry their own padding (`px-4 py-3`) and never their own border; hover fills the whole row `bg-surface-sunken`. Use it for: order lists, document lists, request lines, payment schedules, timeline groups. Do not use gapped `space-y-3` stacks of cards for records.
- Near-black band: exactly one allowed place — the client dashboard may end with an ink CTA band ("Need something new? Start a request") mirroring the brand's CTA banner, `bg-inverse text-white rounded-xl p-6`, sage button. Not in ops.

### 4.5 Spacing, radius, borders

- Spacing scale (Tailwind default, 4px base): 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64. Card padding 20px (`p-5`); table cell `px-3 py-2` (40px rows) / `px-3 py-1.5` (36px compact); page gutters 24px ops, 16–24px client; gap between cards 16px (ops) / 24px (client); between page sections 32px.
- Radius: 12px cards, sheets, drop zone, waiting card; 8px buttons, inputs, tabs content, popovers, sidebar items; 6px table cells, dense chips, menu items; 4px checkbox; 999px pill chips and avatars. Never mix 12 and 16 on one screen (16 is reserved for client offer option cards).
- Borders: 1px everywhere. Hairline tokens by role (§2.1). The only 2px strokes are the focus ring, the active-tab underline and the stepper connector.
- Shadows: none on static cards; `shadow-sm` on hoverable cards; `shadow-md` on popovers/menus; `shadow-sheet` on sheets/dialogs.

---

## 5. Component specs

Component names refer to shadcn/ui unless marked *custom*. Icons: Lucide, 16px in rows/chips/buttons, 18px sidebar, 20px empty states, stroke 1.75. No emoji, no icon packs mixed.

### 5.1 Milestone stepper *(custom `MilestoneStepper`)*

Nine steps in this order (D-05): Received · Finding factory · Price ready ▲ · Sample ▲ · Order confirmed ▲ · In production · Quality check ▲ · Shipping · Delivered ▲.

Desktop (≥768px) horizontal, full card width, `<ol>` with `aria-current="step"` on the current `<li>`, each node is `flex-1` so labels centre under dots; connector is a 2px line between dot centres.

| State | Dot | Connector to next | Label |
|---|---|---|---|
| done | 14px circle `bg-foreground`, white `Check` 10px | `bg-foreground` | 12px `text-ink-2` |
| current | 18px circle `bg-green-100 border-2 border-green-600` with inner 6px `bg-green-600` dot | `bg-border` | 12px `text-foreground font-semibold` |
| todo | 10px circle `bg-card border border-hairline-strong` | `bg-border` | 12px `text-muted-foreground` |
| blocked (current step is a ▲ step and waits on the client) | as current, plus a 8px solid triangle `border-b-green-600` 4px above the dot, `aria-label="Your action"` | | label gets a second line "Your action" in 11px `text-green-700 font-semibold` |
| ▲ step not yet reached | todo dot, small outline triangle (`Triangle` icon 8px `text-faint`) above | | |

Ops variant adds a third line under each label: the internal state name in mono 11px `text-muted-foreground` (e.g. `po_sent`) — only under the current step.

Phone (<768px): a summary row `Step 7 of 9 · Quality check` (mono for the numbers) and a 9-segment bar (TAVRO `ProgressSteps`: `h-1 rounded-full` segments, done `bg-foreground`, current `bg-green-600`, todo `bg-border`) with ▲ markers over action steps; tapping expands to a vertical list (`Collapsible`) using the same dot/label rules with a vertical 2px connector.

Motion: when the current step advances, the new dot's ring fades in over `--duration-state`; nothing slides.

### 5.2 "Waiting on you" action card *(custom `ActionCard`, client)*

The single green-washed surface on a client page.
- `rounded-xl border border-green-200 bg-green-50 p-5` (dark: `bg-accent border-green-200`).
- Row 1: eyebrow pill "▲ WAITING ON YOU" (`Triangle` icon 10px filled). Right: due date in mono 12px `text-green-700` when there is one ("due 28 Sep").
- Row 2: H2 18/600 — the action in plain words: "Balance 70% — $3,780" / "Approve the sample" / "Accept the price".
- Row 3: 14px `text-ink-2` context: "QC passed on 22 Sep · report attached".
- Row 4 (desktop right-aligned, phone full width): `Button variant="action"` (sage, dark-green text, 40px tall) with the verb from D-06: Accept price · Approve sample · View invoice · Upload artwork · View QC report · Confirm delivery. Optional secondary `Button variant="ghost"` "Ask a question".
- Several items (dashboard): one card, items as sheet rows divided by `border-green-200`, each with its own button; header "3 things are waiting on you".
- Empty (dashboard): plain white card, `CheckCircle2` 20px `text-green-600`, "Nothing is waiting on you", small muted "We'll email you when something needs your decision." No green fill when empty.

Ops mirror: "Waiting on us" uses the same layout with `bg-info-wash border-info-border`, eyebrow "WAITING ON US"; "Waiting on client" uses neutral wash. Same component, `tone` prop.

### 5.3 Chips (shadcn `Badge` with custom variants)

Three families; each has fixed geometry so they never get confused.

**A. Client milestone chips** — pill, sentence case, calm.
`rounded-full h-6 px-2.5 text-xs font-medium`. Colour by relation to the client:

| Milestone chip | Style |
|---|---|
| any non-action milestone (Received, Finding factory, In production, Shipping) | `bg-neutral-wash text-ink-2 border border-neutral-border` |
| ▲ milestone waiting on the client | `bg-green-100 text-green-700 border border-green-200` + `Triangle` 8px |
| Delivered | `bg-success-wash text-success border border-success-border` |

**B. Internal state chips (24 states, ops only)** — 6px radius, uppercase micro, mono-ish precision.
`rounded-md h-[22px] px-2 text-2xs font-semibold uppercase tracking-[0.06em] border`. Tone by state group (define once in `stateTone.ts`):

| Group | Example states | Tone |
|---|---|---|
| intake / spec | received, spec_incomplete, spec_frozen | neutral |
| sourcing | rfq_sent, quotes_in, shortlisted | info |
| negotiation / pricing | negotiating, cost_modelled, target_set, offer_draft | warning (amber = someone must decide) |
| sent to client | offer_sent, sample_shipped, pi_sent, qc_report_sent | outline (`border-foreground text-foreground bg-transparent`) — "ball is with the client" |
| execution | confirmed, deposit_paid, po_sent, in_production, inspection_booked, shipped | info |
| terminal good | delivered, closed | success |
| terminal bad / blocked | declined, cannot_source, on_hold | danger (declined) / neutral dashed (on_hold: `border-dashed`) |

Stale overlay: any state chip on a line with no change for 5 working days gets a trailing `Clock` 12px in `text-warning` (the chip itself does not turn amber; the "Last" column does).

**C. Supplier participation status chips (sourcing board)** — same geometry as B.

| Status | Style | Icon |
|---|---|---|
| contacted | neutral wash, `text-ink-2` | — |
| quoted | info wash | — |
| shortlisted | `bg-green-100 text-green-700 border-green-200` | `Star` 12px |
| negotiating | warning wash | — |
| selected | solid `bg-green-700 text-white border-green-700` | `Check` 12px |
| backup | `bg-transparent text-green-700 border-green-600` (outline) | — |
| dropped | `bg-transparent text-muted-foreground border-border line-through` | — |
| cannot_make | danger wash | `X` 12px |

Chips carry the word; colour is a second channel. In-cell editing: the chip is a `DropdownMenu` trigger (`DropdownMenuRadioGroup`) on the ops board; on hover it shows a 12px `ChevronDown`.

**D. Small utility badges**: `Client` / `Internal` visibility (§5.11), `Draft by Claude` (neutral, `Sparkles` 12px), `v2 frozen` (outline mono), `Repeat` (info), `Recommended` (green-100 on offer option).

### 5.4 Data table (shadcn `Table` + TanStack Table)

- Container: `rounded-xl border border-border bg-card overflow-auto max-h-[calc(100vh-14rem)]` (ops) so the header sticks inside the container; horizontal scroll allowed with a sticky first column.
- Header (`thead th`): `sticky top-0 z-20 bg-card h-9 px-3 text-left align-bottom text-2xs font-semibold uppercase tracking-[0.06em] text-foreground whitespace-nowrap` and `box-shadow: inset 0 -1px 0 var(--rule-ink)` (TAVRO's ink rule, at 1px). Sortable headers are buttons with `ArrowUpDown` 12px `text-faint` → `text-foreground` when active; `aria-sort` set.
- Rows: 40px (`h-10`) default, 36px compact (density toggle in the toolbar, persisted per table in localStorage). `border-b border-hairline-faint`, hover `bg-surface-sunken`, `transition-colors duration-[120ms]`. Zebra only in compact mode (`even:bg-surface-sunken/60`).
- Cells: `px-3 py-0 align-middle text-sm`. Primary column: name 14/500 `text-foreground`; second line 12px `text-muted-foreground` (ref in mono). Truncate at `max-w-[32ch]` with `title`.
- Numeric columns: `text-right font-mono text-[13px] tabular-nums`; the deciding number (USD/pc, target, total) `font-medium text-foreground`; others `text-ink-2`. Header of numeric columns right-aligned.
- Chips inline in cells at 22px, vertically centred.
- Selected row: `bg-green-50` + 3px `bg-green-600` left bar (`shadow-[inset_3px_0_0_var(--green-600)]`). Focused row (keyboard): 2px inset ring `--ring`.
- Stale row (≥5 working days without change): the "Last" cell shows `15 d` in `text-warning font-medium` with `Clock` 12px, and the row gets a 3px `--warning-border` left bar. No full-row wash — washes kill scanning.
- New row (created < 24h, ops queue): 3px `bg-green-600` left bar for the first visit (TAVRO's `border-l-[3px] border-l-signal` device).
- Expand: chevron in first cell; expanded content sits in a full-width row on `bg-section-alt` with `px-6 py-4` (quotes with price breaks under a supplier row).
- Toolbar above (section-alt band, `px-4 py-3 rounded-t-xl border border-b-0`): search `Input` with `Search` icon (`/` focuses it), filter `Popover`s with checkbox lists, active filters as removable chips, density toggle (`ToggleGroup` two icons), column visibility (`DropdownMenuCheckboxItem`), result count in mono ("38 lines").
- Selection: `Checkbox` column 40px; `BulkActionBar` (custom) slides up from the bottom (`fixed bottom-4`, ink bg, white text, sage buttons) with count and actions.
- Keyboard (ops): `J`/`K` move focus, `Enter` opens, `Space` selects, `/` search, `Esc` clears. Documented in the ⌘K palette.
- Empty: inside the container, §5.6.
- Loading: 8 skeleton rows (`Skeleton` h-4 bars, widths 60/30/20%), header stays.

### 5.5 Page header — see §4.2.

### 5.6 Empty states *(custom `EmptyState`)*
`mx-auto max-w-sm py-12 text-center`: Lucide icon 20px `text-muted-foreground` in a 40px `bg-section-alt rounded-lg` square; title H3; body prose muted; one action (`outline` unless it is the page's primary action, then `default`). Examples: Requests queue → "No requests match these filters" + "Clear filters"; Client orders → "No orders yet" + "New request"; Sourcing board → "No suppliers on this line yet" + "+ Supplier" (`default`).

### 5.7 Eyebrow labels *(custom `Eyebrow`)*
- `plain`: `text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground`. Used in page headers and card titles ("PAYMENTS · 3 OF 4 PAID").
- `pill` (brand): `inline-flex h-[22px] items-center gap-1.5 rounded-full border px-2.5 text-2xs font-semibold uppercase tracking-[0.08em]`, `bg-green-50 border-green-200 text-green-700` (dark: `bg-accent border-green-200 text-accent-foreground`). Number prefix in mono: "01 — SPEC" (the em dash and number are `font-mono font-medium`).
- Used as the numbering device on stacked order-page sections, on offer options ("OPTION A"), on the client's "WAITING ON YOU".

### 5.8 Toasts (sonner `Toaster`)
Position `bottom-right` ops, `top-center` client on phone (<640px) else bottom-right. Style: `bg-inverse text-white rounded-lg shadow-sheet px-4 py-3 text-sm`, icon 16px left: success `Check` in `--green-300`, error `AlertCircle` in `#F08A80`, info `Info` in `#A3A3A3`. Duration 4s; errors persist until dismissed; max 3 stacked. Action link inside the toast in `--green-300` underlined ("Undo", "Open order").

### 5.9 Dialogs and sheets
- **Sheets for create/edit** (`Sheet side="right"`): + Supplier, Log quote, Change state, New payment, Record inspection, Add shipment, Log WhatsApp, Ask about this order, Edit spec. Header: eyebrow (context ref) + H2 title; body scrolls; footer sticky `border-t border-border bg-card p-4` with `Cancel` (ghost, left) and the primary (right). Width 480px; 640px when a file preview sits beside the form (Log quote with an uploaded price list → extraction preview).
- **Dialogs for decisions** (`Dialog`, `max-w-md`): destructive confirmations (Drop supplier, Decline offer), "Publish to client" with the leak-check result (§5.16), Freeze spec v1. Title H2, body prose, buttons right-aligned, destructive uses `variant="destructive"`.
- **Drawer (vaul) on client phone** for Ask about this order and Approve/Reject sample (bottom sheet, 90vh, drag handle).
- Never open a dialog from a sheet; stack at most one sheet.

### 5.10 Forms
- `Label` 12px 500 `text-ink-2` above the control, 6px gap; helper 12px muted below; error 12px `text-danger` with `AlertCircle` 12px, border turns `border-danger`.
- Inputs 36px tall (40px on client phone), `rounded-lg`, white fill even on section-alt. Required marker: none — mark optional fields with "(optional)" instead (the paste-and-go form has one required thing: at least one line).
- Money inputs: mono, right-aligned, currency as a fixed prefix in `text-muted-foreground`; quantities mono right-aligned with unit suffix.
- **Paste-and-go intake (D-04):**
  1. Drop zone: `rounded-xl border border-dashed border-input bg-card min-h-[140px] p-6 text-center`, hover/drag-over `border-green-600 bg-green-50`; inside: `Link` + `Image` icons 20px muted, title 15/500 "Paste links, one per line — or drop photos", small muted "Allegro, eMAG, Alibaba, TikTok, a photo from your phone". The zone IS a `Textarea` (transparent, full size) so paste works on click without a separate field.
  2. On paste/parse each line becomes a row in a sheet list below: 24px favicon/thumbnail (`rounded-sm bg-section-alt`), the URL (14px, `truncate` middle with the domain kept) or file name, a quantity `Input` 96px mono right-aligned with "pcs" suffix, a remove `X` ghost button. Rows added with a 120ms fade.
  3. Note `Textarea` "Anything we should know? (optional)", 3 rows.
  4. Primary "Send request" in the page header (desktop) and as a sticky bottom bar on phone (`sticky bottom-0 bg-background/95 border-t p-4`).
  5. After send: full-page confirmation card with the `REQ-` ref in mono large, "We'll email you when the price is ready — usually within 5 working days", buttons "View request" (default) / "New request" (outline).
- xlsx import (ops, on behalf): `Sheet` 640 with `DropZone` + mapped-columns preview table.

### 5.11 Document list rows *(sheet list rows)*
`px-4 py-3 flex items-center gap-3`: kind icon 16px in a 32px `bg-section-alt rounded-md` square (`FileText` PI/invoice, `ClipboardCheck` QC report, `Ship` B/L, `Image` artwork/reference, `Award` certificate, `Table2` price list); name 14/500 truncate; meta 12px muted mono-ish "PI · 218 KB · 03 Sep"; visibility badge right: `Client` = `bg-green-100 text-green-700 border-green-200` with `Eye` 12px; `Internal` = neutral wash with `EyeOff` 12px. Ops actions on hover (always visible on touch): Download (ghost icon), `Publish to client` (`outline` sm) on internal rows → leak-check dialog. Client rows show Download only. Group by kind with eyebrow plain headers when > 6 documents.

### 5.12 Timeline / updates feed *(custom `Timeline`)*
`<ol>` with a 2px vertical connector `bg-border` at x = 8px; each item `grid grid-cols-[16px_1fr] gap-3 pb-5`. Date group headers as eyebrow plain ("22 SEP") with a `border-t border-hairline-faint` above. Four item kinds:

| Kind | Marker | Body |
|---|---|---|
| milestone / state change | 12px filled `bg-foreground` dot; if it is a ▲ milestone `bg-green-600` | title 14/500 "Quality check passed — 0 critical, 2 minor"; mono 12px time right; optional attachment chip row |
| note (agent) | 12px hollow dot `border-2 border-foreground bg-card` | prose 14px; if `visibility=internal` (ops only) the body sits in `bg-section-alt rounded-lg px-3 py-2` with an `Internal` badge; if client-visible, plain |
| logged WhatsApp (ops) | 16px `MessageCircle` icon `text-muted-foreground` in the marker slot | `WhatsApp` neutral badge + author; the pasted text in a quote block `border-l-2 border-hairline-strong pl-3 text-ink-2`; screenshots as 96px thumbnails |
| client question | 16px `HelpCircle` icon `text-info` | `Client question` info badge; the question in prose; ops see a `Reply` outline button which opens the Ask sheet pre-addressed |
| system (email sent, ETA changed) | 8px `bg-border` dot | 12px muted, one line |

Client sees only client-visible items; the ops timeline shows everything with visibility badges.

### 5.13 Money and quantity formatting *(util `formatMoney`, `formatQty`)*
- `Intl.NumberFormat('en-US')` for v1 (English UI, USD FOB; EUR display and locale switching are v1.1 and change only the formatter).
- Unit prices: 2 decimals when ≥ 1 (`$58.90`), 3 when 0.1–1 (`$0.539`), 4 when < 0.1 (`$0.0539`); always followed by ` /pc` (or the unit) in `text-muted-foreground`. Totals: 2 decimals, grouped (`$3,780.00`). Never round a quote for display beyond what was quoted.
- `factory_plus_fee` display: two lines — `$0.054 /pc` (mono large) and `+ $0.006 fee` (mono 13 `text-ink-2`); `all_in`: one number. Invoices always show both numbers as separate rows (D-10).
- Quantities: grouped, unit suffix (`100,000 pcs`), mono. MOQ as `MOQ 3,000`.
- Percentages: `70 %` with NNBSP; deltas with explicit sign (`+4.2 %`, `−1.1 %` using U+2212).
- Dates: `22 Sep 2026` in prose, `22 Sep` in tables, ISO in tooltips; relative age only for staleness (`15 d`).
- Currency of origin on quotes: `¥0.38` with a tooltip "USD 0.0539 at 7.05 (21 Sep)"; the normalised USD column is what sorts.

### 5.14 Anonymised factory label *(custom `FactoryLabel`)*
- Client: `inline-flex items-center gap-1.5 rounded-md border border-dashed border-hairline-strong bg-card px-2 h-[22px] font-mono text-xs text-foreground` with `Factory` icon 12px `text-muted-foreground`: `Factory F-0042`. Tooltip: "Factories are anonymised. You always deal with Influensia." The dashed border is the "placeholder identity" cue (TAVRO's `dashed` stamp tone).
- Ops: the real name is primary (`Dongguan Yuantuo Packaging`, 14/500) with `SUP-0042` mono muted; the anonymised label follows in the same dashed chip prefixed by `EyeOff` 12px, meaning "shown to client as". If `disclosed_to_org_ids` includes this client, the chip switches to a solid neutral chip with `Eye` — disclosed.
- The label never appears next to a supplier name in any client DTO; the component simply has no `supplierName` prop in the client bundle (mechanism 1, §07).

### 5.15 KPI tiles (ops dashboard) *(custom `KpiTile`)*
4-up grid (`grid-cols-2 xl:grid-cols-4 gap-4`), each a white card `p-5` that is a link (`hover:shadow-md`): eyebrow plain label ("STALE LINES"), figure KPI 28px mono, meta 12px muted ("no change ≥ 5 working days"). A 8px tone dot precedes the label only when the figure is non-zero for Stale (warning) and Waiting on us (info); Unassigned uses neutral. No sparklines in v1. Do not colour the figure.

### 5.16 Publish-to-client / leak check *(Dialog)*
Title "Publish to client"; body lists the document/comment; a check list with three rows (Filenames · Text · PDF text layer) each with `Check` success or `X` danger and the matched string in mono danger wash ("`Co., Ltd` found in page 2"). Blocked state disables the primary and shows "Fix and try again". Passed: primary `green` "Publish". This is the one place `variant="green"` appears on ops.

### 5.17 Nav active states — see §4.1 (client: green underline; ops: white item + 3px green left bar). Tabs: 2px green underline (§2.3 override).

### 5.18 Facts strip *(custom `FactsStrip`)*
One white card, `grid grid-cols-2 md:grid-cols-4 divide-x divide-hairline-faint` (phone: `divide-y`), each cell `px-5 py-4`: eyebrow plain label ("QUANTITY"), value mono large 20/500, sub 12px muted ("at $0.054 /pc + fee"). Used on order/request pages for Quantity · Price · ETA · Next payment (client) and Qty · Target · Cost floor · Deadline (ops).

### 5.19 Buttons — sizes
`sm` 32px (tables, toolbars), `default` 36px, `lg` 40px (client primary actions; phone min 44px). Icon-only buttons are square and always have `aria-label`. Loading: `Loader2` spinner replaces the icon, label stays.

### 5.20 Avatars, agents
`Avatar` 24px in tables, 32px in headers; initials Figtree 600 11px on `bg-section-alt text-ink-2`; ring-2 `ring-green-600` when "assigned to me".

---

## 6. Screen-by-screen visual spec

Density: **C** = client (comfortable: 15px prose, 40px controls, 24px gaps), **O** = ops (dense: 14px, 40px rows, 16px gaps).

### 6.1 Client dashboard (`/app`) — C
- Regions: page header (eyebrow "KOFF" · H1 "Your orders" · actions: **New request** default) → Waiting on you card (§5.2) → "In progress" sheet list → "Recent updates" timeline (last 5 across orders) → optional ink CTA band.
- Above the fold (1280×800): header, the action card (or its empty state), first 3 rows of In progress.
- In-progress rows (56px): ref mono 12 muted + product name 14/500; milestone chip (family A); 9-segment mini progress bar (§5.1 phone variant, 96px wide); right: ETA mono ("18 Nov") or "—"; whole row is a link.
- Secondary: "Delivered" collapsed section (`Collapsible`, count in mono) with Reorder outline buttons per row (D-18).
- 390px: single column; New request as full-width button under the header; rows keep ref/name/chip and move ETA to a second line.

### 6.2 Client new request (`/app/requests/new`) — C
- Regions: header (eyebrow "NEW REQUEST" · H1 "What should we source?" · **Send request** default, disabled until one line has a quantity) → `lg:grid-cols-[1fr_20rem]`: left the paste-and-go form (§5.10); right rail (section-alt band) "What happens next" three numbered eyebrow pills (01 We complete the spec · 02 Price ready in ~5 working days · 03 Sample, then order) + assigned agent card (avatar, name, "replies within 24h").
- Above the fold: drop zone and the first parsed rows.
- 390px: rail moves below the form; Send request in a sticky bottom bar.

### 6.3 Client request / order page (`/app/orders/[ref]`) — C
- Header: eyebrow `ORD-2026-0312 · CARD SLEEVES 66×91`; H1 = product name; right meta "Quality check · 7 of 9" in mono 12 muted (header row, right-aligned); actions: `Ask about this order` (outline) and the ▲ action button if any (`action`).
- Stepper card (§5.1) full width.
- Waiting on you card (only if an action is due).
- Facts strip (Quantity · Price · ETA port · Next payment).
- `Tabs`: Updates (default) · Documents · History. Updates = client-visible timeline; Documents = sheet list with `Client` badges only; History = "You ordered this product before" list (D-19, client-visible) with refs, dates, unit prices in mono.
- Request stage (before an order exists): same page; stepper shows steps 1–3; the facts strip shows Quantity · Target delivery · Status; a "What we understood" card lists the request lines (name, qty, source link) so the client can correct via Ask.
- Offer accepted → the page grows into the order without a URL change (D-07: requests and orders share the page).
- 390px: stepper collapses to the summary bar; facts strip 2×2; tabs scroll horizontally.

### 6.4 Client offer page (`/app/offers/[id]`) — C, money zone
- Header: eyebrow `OFFER · REQ-2026-0312 · VALID UNTIL 30 SEP` (validity in mono, `text-warning` when < 7 days); H1 "Price for Card sleeves 66×91"; no actions in the header — decisions live in the sticky bar.
- Options A/B/C as `grid md:grid-cols-3 gap-4`; each a white card `rounded-2xl p-6`: eyebrow pill "OPTION A" + `Recommended` badge on one; price mono 24/500 with `/pc` and the fee line per `pricing_display`; DetailRow list (TAVRO `DetailRow`: `flex justify-between border-b border-hairline-faint py-2.5 last:border-b-0`, label 12 muted, value mono 13): MOQ · Lead time · Payment terms · Sample cost · Incoterm/port; "Deviations from your reference" as a prose bullet list; price ladder as a 2-column mini table (qty → unit price, mono, right-aligned).
- No factory, no supplier type, no quote count anywhere on this page (the DTO cannot carry them).
- Sticky decision bar (`sticky bottom-0 bg-card border-t border-border p-4`): left the selected option summary ("Option B · 100,000 pcs · $5,400 + $600 fee"), right **Accept** (`action`, sage) · Ask for changes (outline) · Decline (ghost, `text-danger`). Option selection via `RadioGroup` cards (`aria-checked` ring `ring-2 ring-green-600`).
- 390px: options become a `Tabs` segmented A/B/C above one card; decision bar stays sticky.

### 6.5 Client catalog (`/app/catalog`) — C
- Header: eyebrow "CATALOG"; H1 "Products we can source for you"; search input right.
- Filter chips row on a section-alt band (`-mx-6 px-6 py-3`): category chips (`ToggleGroup`), "Ordered before" toggle.
- Grid `sm:grid-cols-2 xl:grid-cols-3 gap-6`: product card = clean image 4:3 `bg-section-alt rounded-t-xl object-cover`, body `p-4`: name 15/500, reference price mono 16/500 `$0.054 /pc` + small "at 100,000 · FOB Shenzhen · valid until 30 Nov · spec v2", `Request offer` outline button full width (pre-fills a request, D-16).
- Factory ranges section (D-15): stacked sections headed by the dashed `Factory F-0042` label + "12 items" mono; items in a compact sheet list (thumbnail, name, MOQ, price) with a `Select` checkbox column and a "Request selected" default button.
- 390px: single-column cards; range tables become card rows.

### 6.6 Ops dashboard (`/ops`) — O
- Header: eyebrow "TODAY · 28 SEP"; H1 "Dashboard"; actions: `New request on behalf` (outline), ⌘K hint.
- KPI row (§5.15): Stale lines · Waiting on us · Waiting on client · Unassigned. Each links to the queue pre-filtered.
- Two columns `xl:grid-cols-2 gap-4`: "Stale lines" compact table (Ref · Product · Client · State chip · Last `15 d` amber · Agent) and "Waiting on us" table (Ref · Product · What is waiting · Since). Below full width: "Unassigned" table with a `Claim` sm outline button per row (hover-revealed on pointer, always visible on touch) — one click assigns to me and toasts "Assigned to you · Undo".
- Above the fold: KPIs + first 6 rows of each table. Density compact by default on this page.

### 6.7 Ops request queue (`/ops/requests`) — O
- Header: eyebrow "REQUESTS"; H1 "Request lines" with count mono; actions: `New request` (default, opens sheet: client select + paste-and-go + source = agent_on_behalf), `Import xlsx` (outline).
- Toolbar (§5.4): search, filters State (grouped by §5.3-B groups), Milestone, Client, Agent, "Mine" `Switch`, "Stale only" `Switch`, density, columns.
- Table columns: Ref (mono, sticky) · Product / line name (2-line) · Client · State chip (B) · Milestone (client chip A, muted) · Qty (mono right) · Target $/pc (mono right) · Agent (avatar 24) · Last (mono, stale amber) · ⋯ row menu. Default sort: Last ascending (stalest first). Row click → line page; `Cmd+click` new tab.
- Bulk: assign agent, set state, export csv.

### 6.8 Ops request line page (`/ops/requests/[ref]/lines/[n]`) — O
- Sticky header: eyebrow `REQ-2026-0312 · KOFF · PIOTR` + `Repeat` badge if `is_repeat`; H1 "07 · Card sleeves 66×91 100 µm" (line number in mono); meta row: state chip (B) · milestone chip (A) · agent avatar + name · "last change 2 d" mono; actions: `Change state` (outline, opens sheet with the allowed transitions as radio rows + note), the stage primary (`Freeze spec` → `Generate RFQ` → `Build offer` → `Send offer`, one at a time, `default`), ⋯ (Log WhatsApp, Reassign, Put on hold).
- `Tabs`: **Spec** · **Sourcing board** · **Cost & target** · **Offer** · **Timeline**. Tabs are routes (`?tab=`) so they deep-link.
- Grid `xl:grid-cols-[1fr_22rem]`; the right rail (section-alt band, sticky) holds: FactsStrip vertical (Qty first · 12-month volume · Target · Cost floor · Deadline · Destination/incoterm), "This client ordered this product" (client-visible history) and "Other clients' orders of this product" (ops-only, with `Internal` badge) as compact sheet lists, `Log WhatsApp` outline full-width button, internal notes textarea (`Internal` badge). The **Sourcing board** tab hides the rail (`col-span-full`) to give the table the full width.
- Spec tab: white card with a two-column definition form (materials, dimensions, customisation, client links as a list with favicons, reference images as 96px thumbnails with kind chips — only `clean` ones may be published); completeness meter (9-segment bar + "6 of 9 fields") at the top; `Freeze v1` default button; frozen versions listed as outline mono chips (`v1 · 24 Sep · Marko`) with a diff popover.
- Cost & target tab: two cards side by side (`lg:grid-cols-2`): "Cost model" table (component · unit · qty · CNY · USD, mono, totals row `border-t border-rule-ink font-medium`) with `Draft by Claude` badge and `Regenerate` ghost; "Target" card with uplift % input, target $/pc mono large, margin readout, `Confirm target` default (records `target_confirmed_by`).
- Offer tab: builder — three option columns (as the client will see them, same component as §6.4 in an edit state) fed from shortlisted participations chosen via `Select` (labelled by supplier name for ops, rendered as Option A/B/C), `pricing_display` toggle, validity date, `Preview as client` outline (opens the client rendering in a sheet, DTO-filtered) and `Send offer` default → dialog with the leak-check checklist.
- Timeline tab: full feed (§5.12) with a filter chip row (All · Milestones · Notes · WhatsApp · Client questions).

### 6.9 Ops sourcing board table (tab of §6.8) — O, full width
- Compare bar on a section-alt band above the table (`rounded-t-xl border px-4 py-3 flex flex-wrap gap-x-6 gap-y-1 text-sm`): "Best clean **$0.0539** (Yuantuo)" · "Lowest quoted **$0.032** (Suti — excluded: 6-month trader)" · "Spread **2.4×**" · "**3** quotes of **8** contacted" · "**2** stale" — figures mono 500, labels ink-2; "excluded" reason in `text-warning`. Right: `+ Supplier` (default), `Log quote`, `Shortlist`, `Build offer` (outline; `Build offer` becomes `default` once ≥1 selected/shortlisted).
- Table columns (from the wireframe): Supplier (name 14/500 + `SUP-0042` mono muted + dashed F-label if allocated; sticky) · Type · Grade (type verdict as text `manufacturer`, grade as a 20px circle mono `B`, `unchecked` in `text-faint`) · Contact · Channel (name + channel icon: Lucide `Mail`, `MessageCircle` for WeChat/WhatsApp, `Globe` for Alibaba/1688 with the platform name in text) · Status (chip C, in-cell editable) · Price @ MOQ (mono: `0.0539 @ 100k`, original currency on hover) · Terms (`FOB SZ · 30 d · T/T`, 12px) · USD/pc (mono 13/500 right; the best clean quote gets `text-green-700`; excluded rows `text-muted-foreground line-through`) · Last (mono, `15 d` amber + `Clock` when stale) · ⋯.
- Row expand shows the quote versions as a nested sheet list on section-alt: version, received date, incoterm (with `incoterm_uncertain` as a `?` warning badge), MOQ, lead days, valid until, payment terms, price breaks as mono pairs, deviations text, source file chip. `Log quote` per row pre-fills the supplier.
- Dropped rows sink to the bottom and dim (`opacity-60`), never hidden (the reason column stays readable).
- Keyboard: `J K` rows, `S` shortlist, `Q` log quote, `Enter` expand.

### 6.10 Ops order page (`/ops/orders/[ref]`) — O, money zone
- Sticky header: eyebrow `ORD-2026-0312 · KOFF · AGENCY PASS-THROUGH · FACTORY + FEE` (commercial mode and pricing display as neutral chips); H1 product name; meta: state chip · milestone chip · PI number mono; actions: `Change state` (outline), stage primary (`Send PI` → `Record payment` → `Approve artwork` → `Send PO` → `Book inspection` → `Add shipment` → `Confirm delivery`), ⋯ (Log WhatsApp, Publish document, Preview as client).
- Stepper card with internal-state sub-labels.
- Ops "Waiting on us / on client" card (§5.2 tone variants).
- Facts strip: Qty · Unit price (+ fee) · Total · ETA port · Ex-works ETA · Next payment due.
- Then **one long page of numbered stacked sections** (D-07 "one page holds everything"), each a white card with a `border-t border-rule-ink pt-4` heading row (eyebrow pill number + H2 + right-aligned section action), and a sticky "On this page" mini-nav in the right rail (section-alt band) listing 01–07 with the count of open items per section (mono):
  - **01 Payments** — sheet table: Kind (deposit/fee/balance/sample) · % · Amount (mono) · Payee (agency/factory chip) · Due (mono, amber if overdue) · Paid (date + reference mono, or `Mark paid` sm outline → sheet with reference field). Totals row. Client sees the same table minus Payee=factory rows' internal references.
  - **02 Artwork** — per order line: dieline download, submitted file thumbnail, status chip (submitted/changes/approved), `Approve` green sm / `Request changes` outline sm; approval writes the timeline and emails.
  - **03 Purchase orders** — one card row per supplier: supplier name + SUP ref + F-label, PO ref mono, factory total mono, terms, ex-works ETA (editable inline → ETA change emails the client if the client-facing ETA moves), status chip.
  - **04 Inspections** — rows: PO · inspector · date · AQL · sample size · result chip (pass success / fail danger / rework warning) · report document row with visibility badge and `Publish` if internal.
  - **05 Shipments** — rows: mode icon (`Ship`/`Plane`/`TrainFront`) + text · forwarder · booking ref mono · container/AWB mono · cargo ready · ETD · ETA port · customs status chip · B/L and packing list document rows.
  - **06 Documents** — full document list (§5.11) grouped by kind, `Upload` outline in the heading.
  - **07 Timeline** — full feed.
- Above the fold: header, stepper, waiting card, facts strip, the start of 01 Payments.
- The whole page is `data-zone="money"`: no green fills except the stepper current dot and the `Publish`/`Approve` green sm buttons; no toasts with jokes; mono everywhere numbers appear.

### 6.11 Ops suppliers list + supplier page — O
- List (`/ops/suppliers`): header eyebrow "SUPPLIERS" · H1 with count · `+ Supplier` default · `Import from sheet` outline. Toolbar filters: Type verdict, Grade, Province, Channel, "Has open lines", "Disclosed to a client". Columns: Ref (mono, sticky) · Legal name + 中文名 (12px muted) · Type verdict (text with a 12px icon: `Factory` manufacturer / `Store` trading / `Blend` hybrid / `HelpCircle` unknown / `CircleDashed` unchecked in faint) · Grade (circle) · City / Province · Channels (icon row) · Open lines (mono) · Orders (mono) · On-time % (mono) · Last contact (mono, stale amber). Row click → supplier page.
- Supplier page (`/ops/suppliers/[ref]`): sticky header eyebrow `SUP-0042 · DONGGUAN · GUANGDONG`; H1 legal name; sub-line 中文名 + USCC mono; meta: type verdict chip (neutral; `unchecked` dashed) · grade circle · `verdict_source` in 12px muted ("1688 工厂档案 · 29 Aug"); actions: `Edit` outline, `Add contact` outline, ⋯. If `disclosed_to_org_ids` is non-empty: a full-width `bg-warning-wash border-warning-border` band under the header: "Disclosed to KOFF on 03 Sep — this supplier's name appears on their bank statements". Grid `xl:grid-cols-[1fr_22rem]`: `Tabs` Profile (definition rows: registered, capital, ports, notes) · Contacts (sheet rows: name, channel icon + handle mono, phone mono, primary star) · Participations (table: Request line · Client · Status chip C · Best USD/pc · Last) · Price lists & catalogues (document rows, always `Internal`, no Publish button rendered) · Performance (4 KpiTiles: orders, on-time %, defect %, quote accuracy). Rail: F-labels allocated per client (dashed chips with client name), quick stats.

### 6.12 Ops catalog / products admin (`/ops/products`) — O
- Header: eyebrow "PRODUCTS"; H1 "Products" with count; `+ Product` default.
- Toolbar: Visibility (private / catalog / proposed), Category, Owner org, "Reference price expiring" switch.
- Columns: Ref `PRD-0041` (mono, sticky) · Name + category (12px muted) · Owner org · Visibility chip (private neutral / catalog success / proposed info) · Reference $/pc (mono) · At MOQ (mono) · Incoterm/port · Spec (outline mono `v2`) · Valid until (mono; `text-warning` < 30 d, `text-danger` past) · Published (date mono) · ⋯ (Edit, Publish to catalog, Unpublish).
- Product page (`/ops/products/[ref]`): header with visibility chip and `Publish to catalog` (outline → leak-check dialog, §5.16) / `Unpublish`; grid with `Tabs` Overview (definition rows + reference price card with the FX date) · Images (grid of 160px tiles, each with kind chip `client_reference` neutral / `supplier_facing` warning / `clean` success; only `clean` tiles show a `Use in catalog` checkbox; supplier-facing tiles carry an `EyeOff` overlay) · Specs (versions list, frozen chips) · Orders (table across clients, `Internal`) · Requests (lines referencing this product). Rail: catalog preview card exactly as the client sees it (§6.5), rendered through the client DTO.

---

## 7. Motion & feedback

What animates, and only this:
- Sheet open/close: translate-x 100%→0 over `--duration-settle` (200ms) `--ease-out`; backdrop `bg-foreground/40` fades in 200ms (TAVRO drawer: `translate` + backdrop opacity, same durations).
- Dialog: opacity 0→1 and scale .98→1 over 150ms.
- Toast: slide up 8px + fade over 200ms; exit 120ms.
- Stepper: the current-step ring fades in over 120ms when a milestone changes; segments in the phone bar change colour over 120ms.
- Table row hover / chip hover: `background-color` 120ms. Buttons: `background-color` 120ms, `:active` `translate-y-px` 70ms (no shadow tricks).
- Skeletons: `animate-pulse` at 1.6s.
- Nothing else: no page transitions, no number count-ups, no parallax, no hover lifts on static cards, no confetti on Delivered (a green check in the toast is the celebration).
- `prefers-reduced-motion: reduce` → the global rule in §2.3 sets every duration to 0.01ms; state is always carried by text/colour/position, never by motion alone.
- Feedback rules: every mutation gets either an inline state change plus a toast (create/update) or a dialog result (publish/leak check). Optimistic UI only for chip status changes on the sourcing board; rollback with a danger toast on failure. Loading buttons keep their width.

---

## 8. Accessibility & responsiveness

- Contrast: all text tokens are AA on every ground they are permitted on (tables in §2). `--faint-fg` is restricted to placeholders/disabled. Chips always carry text; colour is a secondary channel. The ▲ marker always has the text "Your action" (visible on the stepper, `aria-label` on chips).
- Focus: visible 2px ring everywhere (`--ring`), including table rows (`tabindex=0`), chips that open menus, and sidebar items; skip link "Skip to content" as the first focusable element.
- Semantics: page header H1 is the only H1; stepper is `<ol>` with `aria-current="step"`; tables use `<th scope="col">` and `aria-sort`; sheets/dialogs trap focus and return it (Radix); toasts are `aria-live="polite"`, errors `assertive`; timeline is `<ol>`; document rows are `<li>` with the visibility in text.
- Touch targets: client controls ≥ 40px, ≥ 44px on phone; ops row actions ≥ 32px with 8px spacing (WCAG 2.5.8 24px minimum met everywhere).
- Language: `lang="en"`; Polish/Croatian diacritics in names render because both fonts ship latin-ext.
- Breakpoints: client pages are built at 390px first (`sm` 640 → two columns where listed, `lg` 1024 → rails). Rules at 390px: 16px gutters, no horizontal page scroll, tables become sheet rows (the only client tables are the price ladder and the payments table, both ≤ 3 columns and fit), sticky bottom bars for the primary action, tabs scroll horizontally with a fade mask.
- Ops: designed at 1440 and verified at 1280 (sidebar rail collapsed, tables scroll horizontally inside their container with a sticky first column). Below 1024 the sidebar is off-canvas; nothing is hidden, but ops is not optimised for phones.
- Dark theme: same structure; verify the four semantic text tokens on wash (all ≥ 6.7:1) and sage-on-surface (9.6:1). Images with white backgrounds get a `bg-section-alt` frame so they do not glow.
- Testing gates: axe on every Storybook story (TAVRO runs `storybook-axe`); a contrast audit script over the token file on every colour change (TAVRO `design:contrast`); the anonymity crawl (§07 mechanism 9) is a design gate too — no client screen may render a supplier name, and the `FactoryLabel` client bundle has no supplier prop.

---

## 9. Do / Don't

**Do**
- Use the three grounds (page / section-alt / white card) and beige hairlines to divide; use one 1px ink rule under table headers and stacked-section titles.
- Put every number that can be compared in JetBrains Mono, right-aligned, tabular.
- Number sections and label context with eyebrows; keep headings sentence case.
- Give each page one primary button; put the rest behind ⋯.
- Keep green for interaction and "your action"; black for primary buttons; semantic colours only for states.
- Let lists be one bordered object with rows (sheet), and let rows be the click target.
- Show "stale" in one column plus a left bar; show reasons in text next to the chip.
- Prefer a side sheet for create/edit; a dialog only for a decision.

**Don't**
- No purple/blue gradients, no glassmorphism, no glows, no drop shadows on static cards, no grey-blue shadows.
- No emoji, no illustration packs, no icon tint colours other than ink/muted/semantic.
- No card-on-card; no nested rounded boxes; no `space-y-3` stacks of bordered cards for records.
- No centred layouts for app pages (empty states and the confirmation card are the only centred blocks); no hero sections in the app.
- No generic shadcn look: no `#E5E7EB` grey borders, no 8px-radius-everything, no `text-gray-500`, no default blue ring, no Inter/Geist.
- No colour-only states, no amber/green washes over whole table rows, no chips without words.
- No motion for decoration; no count-up numbers; no skeleton "shimmer" on text that is already known.
- No supplier name, platform URL, WeChat handle or +86 number in any client-rendered component, ever — and no UI toggle that could show one.

---

## 10. Summary of decisions

1. One design system for both doors; `/app` is a top bar with three links, `/ops` is a 232px section-alt sidebar with a green left-bar active state — density, not style, separates them.
2. Light default: page `#FAFAF7`, section-alt `#F3F1EA`, cards white, beige hairlines `#F0ECE2 / #E8E3D8 / #E0D9CA`, ink `#171717`, muted `#5F6670` (the brand's `#6B7280` fails on the alt band). Dark theme is a full token set on `.dark`.
3. Green is rationed: `#3F7A38` for links/focus/active/current on light, sage `#97CF8D` for the client's ▲ action button (dark-green text) and for everything interactive on dark; primary buttons are black like the brand.
4. Semantic set with text/wash/border triples (success `#2E7D32`, warning `#8A5A00`, danger `#B42318`, info `#1A5CB8`), all AA on white, page, alt and their own wash; dark equivalents verified ≥ 6.7:1.
5. Type: Figtree (Proxima Nova's free cousin) for UI at 14px, JetBrains Mono for every number, ref, and KPI; 11px uppercase eyebrows and table headers; nothing below 11px.
6. Geometry: `--radius .5rem` so shadcn yields 12px cards, 8px controls, 6px dense chips/cells; 1px borders only; shadows only on things that float.
7. Division by ground: page → section-alt band → white card → hairline rows; the TAVRO "sheet list" replaces gapped card stacks; one 1px ink rule marks table headers and stacked-section titles; card-on-card is banned.
8. Nine-step stepper with done/current/todo/blocked states and a ▲ + "Your action" marker; the "Waiting on you" card is the only green surface on a client page and is mirrored in ops as Waiting on us / on client.
9. Three chip families with fixed geometry (client milestone pills; internal state chips toned by state group; supplier participation chips: contacted · quoted · shortlisted · negotiating · selected · backup · dropped · cannot_make), always with words; stale is shown in one column plus a left bar.
10. Screens: client dashboard / new request / order / offer / catalog and ops dashboard / queue / line page with five tabs / sourcing board / stacked-section order page / suppliers / products are specified with regions, above-the-fold content and one primary action each; sheets for create/edit, dialogs for decisions, sonner toasts, 200/120/70ms motion, reduced-motion honoured, client at 390px, ops at ≥1280.

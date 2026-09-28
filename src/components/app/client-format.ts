/**
 * Client-portal presentation helpers (FIX-B). Pure, no React, no server imports — safe in client and server components.
 *
 *   platformOf("https://allegro.pl/oferta/…")  → { key: "allegro", label: "Allegro" }
 *   clientInitials("Anna (KOFF)")              → "AK"
 *   perUnit("pcs")                              → "pc"   ("$0.062 / pc")
 *   nextStepFor({...line})                      → { now, next, when, short } — "what's next and when" (UX #3)
 *
 * Expected dates follow the SPEC service timings (working days, Mon–Fri): spec confirmed ~2 wd after review starts,
 * quotes ~3 wd after the RFQ goes out, the offer ~2 wd after quotes are in (≈ 5 wd from spec to price). A date that
 * would already be in the past is rolled forward to the next working day — we never show an overdue "expected" date.
 */
import type { Milestone, LineState, LineException } from "@/db/enums";
import { fmtDateShort } from "@/lib/format-date";

/* ── platform badge (smart paste chips) ───────────────────────────────────────────── */

export type PlatformKey = "allegro" | "emag" | "amazon" | "alibaba" | "1688" | "tiktok" | "aliexpress" | "temu" | "other";
export type Platform = { key: PlatformKey; label: string };

const PLATFORMS: [RegExp, PlatformKey, string][] = [
  [/(^|\.)allegro\.(pl|cz|sk|hu)$|(^|\.)allegrolokalnie\.pl$/i, "allegro", "Allegro"],
  [/(^|\.)emag\.(ro|bg|hu|pl)$/i, "emag", "eMAG"],
  [/(^|\.)amazon\.[a-z.]+$|(^|\.)amzn\.(to|eu)$/i, "amazon", "Amazon"],
  [/(^|\.)1688\.com$/i, "1688", "1688"],
  [/(^|\.)alibaba\.com$/i, "alibaba", "Alibaba"],
  [/(^|\.)aliexpress\.[a-z.]+$/i, "aliexpress", "AliExpress"],
  [/(^|\.)tiktok\.com$/i, "tiktok", "TikTok"],
  [/(^|\.)temu\.com$/i, "temu", "Temu"],
];

/** Platform badge derived from the host; unknown hosts → "other" with the bare domain as label. */
export function platformOf(url: string | null | undefined): Platform {
  let host = "";
  try { host = new URL(String(url ?? "")).hostname.replace(/^www\./i, ""); } catch { /* not a URL */ }
  for (const [re, key, label] of PLATFORMS) if (re.test(host)) return { key, label };
  const short = host.split(".").slice(-2).join(".");
  return { key: "other", label: short || "Link" };
}

/** Readable "domain › slug" for a long pasted link (never the raw 300-char URL). */
export function shortLink(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, "");
    const path = decodeURIComponent(u.pathname).replace(/\/+$/, "");
    const last = path.split("/").filter(Boolean).pop() ?? "";
    return last ? `${host} › ${last.length > 40 ? `${last.slice(0, 40)}…` : last}` : host;
  } catch {
    return url.length > 60 ? `${url.slice(0, 60)}…` : url;
  }
}

/* ── people & units ──────────────────────────────────────────────────────────────── */

/** Avatar initials from the first letters of the first two words: "Anna (KOFF)" → "AK", "Piotr" → "P". */
export function clientInitials(name: string | null | undefined): string {
  const words = String(name ?? "").trim().split(/\s+/).map((w) => w.match(/\p{L}|\p{N}/u)?.[0] ?? "").filter(Boolean);
  return words.slice(0, 2).join("").toUpperCase() || "?";
}

/** Singular unit for "per" prices: pcs → pc, sets → set. */
export function perUnit(unit: string | null | undefined): string {
  const u = String(unit ?? "pcs");
  if (u === "pcs" || u === "pc") return "pc";
  return u.replace(/s$/, "");
}

/** Parses a typed quantity ("50,000", "50 000", "5k") → integer, or null. Keeps decimals so callers can reject them. */
export function parseQty(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/[\s,  _]/g, "");
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] === "k" ? 1_000 : m[2] === "m" ? 1_000_000 : 1);
  return Number.isFinite(n) ? n : null;
}

export const groupQty = (n: number) => new Intl.NumberFormat("en-US").format(n);

/* ── dates ───────────────────────────────────────────────────────────────────────── */

const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12));

/** Adds N working days (Mon–Fri) to a date, at noon UTC so the display zone never shifts the day. */
export function addWorkingDays(from: Date | string, n: number): Date {
  let cur = startOfDay(new Date(from));
  let left = n;
  while (left > 0) { cur = new Date(cur.getTime() + 86_400_000); if (!isWeekend(cur)) left--; }
  return cur;
}

/** Never show an "expected" date in the past: roll forward to the next working day after today. */
function notBefore(d: Date, now: Date): Date {
  const today = startOfDay(now);
  return d.getTime() <= today.getTime() ? addWorkingDays(today, 1) : d;
}

export const expectedText = (d: Date | string) => `~${fmtDateShort(d)}`;

/* ── "what's next and when" ──────────────────────────────────────────────────────── */

export type NextStepInput = {
  milestone: Milestone;
  state?: LineState | null;
  waitingReason?: string | null;
  exception?: LineException | null;
  offerOutcome?: "changes_requested" | "declined" | "expired" | null;
  sourcing?: { reached: number; priced: number } | null;
  /** last state change (line page) or last update (rows) */
  since: string | Date;
  agentName?: string | null;
  isRepeat?: boolean;
  etaDate?: string | null;
  etaLabel?: string | null;
  /** ex-works ready date (order page), used while in production */
  readyDate?: string | null;
  offerValidUntil?: string | null;
  sampleStatus?: "ordered" | "shipped" | "received" | "approved" | "rejected" | null;
  onHoldReason?: string | null;
  now?: Date;
};

export type NextStep = {
  /** what is happening right now, in WhatsApp words ("Bogdan is comparing 2 quotes") */
  now: string;
  /** the next event ("Your price") */
  next: string | null;
  /** its date, when we can say one */
  when: Date | string | null;
  /** expected (~), due (hard date), eta (logistics date) */
  whenKind: "expected" | "due" | "eta" | null;
  /** whose move it is */
  party: "client" | "agency" | "none";
  /** one compact phrase for list rows ("Price by ~3 Oct"); null → show nothing (never a lone dash) */
  short: string | null;
};

const wd = (since: string | Date, n: number, now: Date) => notBefore(addWorkingDays(since, n), now);

/** Derives the Now → Next pair and the expected date from the line state + SPEC timings. */
export function nextStepFor(i: NextStepInput): NextStep {
  const now = i.now ?? new Date();
  const who = i.agentName?.split(/\s+/)[0] || "Your contact";
  const s = i.state ?? null;
  const reached = i.sourcing?.reached ?? 0;
  const priced = i.sourcing?.priced ?? 0;
  const step = (x: Omit<NextStep, "short"> & { short?: string | null }): NextStep => ({ short: null, ...x });
  const exp = (label: string, d: Date) => `${label} ${expectedText(d)}`;

  // closed / paused
  if (i.exception === "cancelled") return step({ now: "This line is closed", next: null, when: null, whenKind: null, party: "none" });
  if (i.exception === "on_hold") return step({ now: i.onHoldReason ? `On hold — ${i.onHoldReason}` : "On hold for now", next: "We'll pick it up again with you", when: null, whenKind: null, party: "none", short: "On hold" });

  // the client's move
  switch (i.waitingReason) {
    case "needs_input": return step({ now: `${who} asked you a question`, next: "Your answer", when: null, whenKind: null, party: "client", short: "Your answer needed" });
    case "offer_sent": return step({ now: "Your price is ready", next: "Your decision", when: i.offerValidUntil ?? null, whenKind: i.offerValidUntil ? "due" : null, party: "client", short: i.offerValidUntil ? `Decide by ${fmtDateShort(i.offerValidUntil)}` : "Your decision" });
    case "sample_received": return step({ now: "The sample has arrived", next: "Your approval", when: null, whenKind: null, party: "client", short: "Approve the sample" });
    case "deposit_due": return step({ now: "Your order is confirmed", next: "Deposit payment", when: null, whenKind: null, party: "client", short: "Deposit due" });
    case "artwork_due": return step({ now: "Packaging templates are ready", next: "Your artwork", when: null, whenKind: null, party: "client", short: "Artwork needed" });
    case "balance_due": return step({ now: "Quality check passed", next: "Balance payment", when: null, whenKind: null, party: "client", short: "Balance due" });
    case "delivery_confirm": return step({ now: "Delivered", next: "Confirm you received everything", when: null, whenKind: null, party: "client", short: "Confirm delivery" });
  }

  // we owe a new price
  if (i.offerOutcome === "changes_requested" || i.exception === "change_requested") {
    const d = wd(i.since, 3, now);
    return step({ now: `${who} is revising your price`, next: "New price", when: d, whenKind: "expected", party: "agency", short: exp("New price", d) });
  }
  if (i.offerOutcome === "declined") return step({ now: "You declined this offer", next: `${who} will get in touch`, when: null, whenKind: null, party: "agency" });
  if (i.offerOutcome === "expired" || i.exception === "quote_expired") {
    const d = wd(i.since, 3, now);
    return step({ now: "The price expired — refreshing quotes", next: "New price", when: d, whenKind: "expected", party: "agency", short: exp("New price", d) });
  }
  if (i.exception === "sample_rejected") return step({ now: `${who} is sorting out the sample issue`, next: "A corrected sample", when: null, whenKind: null, party: "agency", short: "New sample in progress" });
  if (i.exception === "qc_failed") return step({ now: "Rework in progress after the quality check", next: "Re-inspection", when: null, whenKind: null, party: "agency", short: "Rework in progress" });

  switch (i.milestone) {
    case "received": {
      if (s === "draft") return step({ now: "Draft — nobody sees it yet", next: "Send it when you're ready", when: null, whenKind: null, party: "client", short: "Draft" });
      const d = wd(i.since, s === "submitted" ? 2 : 2, now);
      return step({ now: s === "submitted" ? "We're assigning your contact" : `${who} is checking your links and photos`, next: "Spec confirmed", when: d, whenKind: "expected", party: "agency", short: exp("Spec by", d) });
    }
    case "finding_factory": {
      if (i.isRepeat) { const d = wd(i.since, 2, now); return step({ now: `${who} is re-confirming last time's price`, next: "Your price", when: d, whenKind: "expected", party: "agency", short: exp("Price by", d) }); }
      const comparing = s ? ["quotes_in", "shortlisted", "negotiating"].includes(s) : priced > 0;
      const asked = s ? s === "rfq_out" : reached > 0;
      if (comparing) {
        const d = wd(i.since, 2, now);
        const n = priced || reached;
        return step({ now: n > 1 ? `${who} is comparing ${n} quotes` : `${who} is negotiating your price`, next: "Your price", when: d, whenKind: "expected", party: "agency", short: exp("Price by", d) });
      }
      if (asked) {
        const d = wd(i.since, 5, now);
        return step({ now: reached > 1 ? `${who} has asked ${reached} factories for quotes` : `${who} is collecting quotes`, next: "Your price", when: d, whenKind: "expected", party: "agency", short: exp("Price by", d) });
      }
      const d = wd(i.since, 5, now);
      return step({ now: `${who} is preparing the sourcing round`, next: "Your price", when: d, whenKind: "expected", party: "agency", short: exp("Price by", d) });
    }
    case "price_ready": return step({ now: "Your price is ready", next: "Your decision", when: i.offerValidUntil ?? null, whenKind: i.offerValidUntil ? "due" : null, party: "client", short: "Your decision" });
    case "sample": {
      if (i.sampleStatus === "shipped") { const d = wd(i.since, 5, now); return step({ now: "Your sample is on its way", next: "Sample arrives", when: d, whenKind: "expected", party: "agency", short: exp("Sample arrives", d) }); }
      const d = wd(i.since, 5, now);
      return step({ now: "The factory is making your sample", next: "Sample ships", when: d, whenKind: "expected", party: "agency", short: exp("Sample ships", d) });
    }
    case "order_confirmed": {
      const d = wd(i.since, 2, now);
      return step({ now: s === "offer_accepted" ? `${who} is preparing your order confirmation` : "Your invoice is being prepared", next: "Invoice", when: d, whenKind: "expected", party: "agency", short: exp("Invoice by", d) });
    }
    case "in_production":
      return i.readyDate
        ? step({ now: "In production", next: "Ready ex-works, then quality check", when: i.readyDate, whenKind: "eta", party: "agency", short: i.etaLabel ?? `Ready ${expectedText(i.readyDate)}` })
        : step({ now: "In production", next: "Quality check before shipping", when: null, whenKind: null, party: "agency", short: i.etaLabel ?? null });
    case "quality_check":
      return step({ now: "Quality check booked", next: "Inspection result", when: null, whenKind: null, party: "agency", short: i.etaLabel ?? "Inspection booked" });
    case "shipping":
      return step({ now: "On its way", next: "Arrival", when: i.etaDate ?? null, whenKind: i.etaDate ? "eta" : null, party: "agency", short: i.etaLabel ?? (i.etaDate ? `ETA ${fmtDateShort(i.etaDate)}` : null) });
    case "delivered":
      return step({ now: "Delivered", next: null, when: null, whenKind: null, party: "none", short: null });
  }
  return step({ now: "In progress", next: null, when: null, whenKind: null, party: "agency" });
}

/** One status word for the chip: the DTO's truthful label, corrected while we owe a new price (QA-11). */
export function chipLabel(l: { milestoneLabel?: string; offerOutcome?: "changes_requested" | "declined" | "expired" | null }): string | undefined {
  if (l.offerOutcome === "declined") return "Offer declined";
  if (l.offerOutcome) return "New price coming";
  return l.milestoneLabel;
}

/** "expected ~3 Oct" / "due 3 Oct" / "18 Nov" for the Now → Next strip. */
export function whenText(n: NextStep): string | null {
  if (!n.when) return null;
  if (n.whenKind === "expected") return `expected ${expectedText(n.when)}`;
  if (n.whenKind === "due") return `by ${fmtDateShort(n.when)}`;
  return fmtDateShort(n.when);
}

/** The milestone the "next" event lands on (for the expected date under the stepper). */
export function nextMilestoneOf(m: Milestone): Milestone | null {
  const order: Milestone[] = ["received", "finding_factory", "price_ready", "sample", "order_confirmed", "in_production", "quality_check", "shipping", "delivered"];
  const i = order.indexOf(m);
  return i >= 0 && i < order.length - 1 ? order[i + 1] : null;
}

/** Dates under the stepper: actual date for reached steps, `~date` for the next step (and the delivery ETA when known). */
export function stepperDates(reached: { milestone: Milestone; at: string }[] | undefined, current: Milestone, step: NextStep, eta?: string | null): Partial<Record<Milestone, { text: string; expected?: boolean }>> {
  const out: Partial<Record<Milestone, { text: string; expected?: boolean }>> = {};
  for (const r of reached ?? []) out[r.milestone] = { text: fmtDateShort(r.at) };
  const nxt = nextMilestoneOf(current);
  if (nxt && (current === "received" || current === "finding_factory") && step.when && step.whenKind === "expected" && step.party === "agency" && !out[nxt]) out[nxt] = { text: expectedText(step.when), expected: true };
  if (eta && !out.delivered && current !== "delivered") out.delivered = { text: expectedText(eta), expected: true };
  return out;
}

/** Courier tracking link (QA-36): DHL / UPS / FedEx direct, anything else via 17TRACK. */
export function trackingUrl(courier: string | null | undefined, tracking: string | null | undefined): string | null {
  const t = String(tracking ?? "").trim();
  if (!t) return null;
  const c = String(courier ?? "").toLowerCase();
  if (c.includes("dhl")) return `https://www.dhl.com/global-en/home/tracking/tracking-express.html?tracking-id=${encodeURIComponent(t)}`;
  if (c.includes("ups")) return `https://www.ups.com/track?tracknum=${encodeURIComponent(t)}`;
  if (c.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(t)}`;
  return `https://t.17track.net/en#nums=${encodeURIComponent(t)}`;
}

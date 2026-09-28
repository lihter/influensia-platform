/**
 * SPEC Appendix B.4 — quote comparison for one line. Pure; takes plain inputs so it is unit-testable and
 * carries no supplier row types. Ops code maps supplier rows into `ParticipationInput`; client code only ever
 * receives `{ reached, priced }` (the counts) via `sourcingProgress()`.
 */
import type { ParticipationStatus, SupplierTypeVerdict } from "@/db/enums";
import { now } from "./clock";

export type QuoteFlag =
  | "expired" | "incoterm_uncertain" | "unit_mismatch" | "currency_unknown" | "supplier_unchecked" | "supplier_trading"
  | "excluded_status" | "moq_above_qty" | "deviation";

export const DISQUALIFYING_FLAGS: readonly QuoteFlag[] = ["expired", "incoterm_uncertain", "unit_mismatch", "currency_unknown", "supplier_unchecked", "supplier_trading", "excluded_status"];

export type QuoteInput = {
  currency: string;
  unit: string;
  packQty?: number | null;
  incoterm?: string | null;
  incotermUncertain?: boolean;
  validUntil?: string | Date | null; // yyyy-mm-dd or Date
  deviations?: string | null;
  receivedAt?: Date | string;
  breaks: { minQty: number; unitPriceMinorE2: number }[];
};

export type ParticipationInput = {
  id: string;
  /** display label for the strip — ops passes the supplier legal name; never reaches clients */
  label: string;
  status: ParticipationStatus;
  verdict?: SupplierTypeVerdict | null;
  lastContactAt?: Date | string | null;
  /** latest quote version, if any */
  quote?: QuoteInput | null;
};

export type FxLookup = (currency: string, at?: Date | string) => number | null; // units of `currency` per 1 USD

export type ComparedQuote = {
  participationId: string;
  label: string;
  status: ParticipationStatus;
  usdMinorE2: number | null; // normalised USD per line unit at the chosen break
  chosenBreakMinQty: number | null;
  flags: QuoteFlag[];
  clean: boolean;
};

export type CompareResult = {
  quotes: ComparedQuote[];
  bestClean: ComparedQuote | null;
  lowestQuoted: ComparedQuote | null;
  spread: number | null; // max/min over all normalised, 1 dp
  quotesCount: number;
  contactedCount: number;
  staleCount: number;
};

const toDate = (d: Date | string | null | undefined) => (d ? (typeof d === "string" ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d) : d) : null);

/** Normalises one quote to USD per line unit at the line quantity. */
export function normaliseQuote(q: QuoteInput, line: { qty: number; unit: string }, fx: FxLookup, at: Date = now()): { usdMinorE2: number | null; breakMinQty: number | null; flags: QuoteFlag[] } {
  const flags: QuoteFlag[] = [];
  const sorted = [...q.breaks].sort((a, b) => a.minQty - b.minQty);
  if (!sorted.length) return { usdMinorE2: null, breakMinQty: null, flags };
  let brk = [...sorted].reverse().find((b) => b.minQty <= line.qty);
  if (!brk) { brk = sorted[0]; flags.push("moq_above_qty"); }
  let unitPrice = brk.unitPriceMinorE2;
  if (q.unit !== line.unit) {
    if (q.packQty && q.packQty > 0) unitPrice = unitPrice / q.packQty;
    else flags.push("unit_mismatch");
  }
  let usd: number | null = null;
  if (q.currency === "USD") usd = unitPrice;
  else {
    const rate = fx(q.currency, q.receivedAt ?? at);
    if (rate) usd = unitPrice / rate;
    else flags.push("currency_unknown");
  }
  const vu = toDate(q.validUntil);
  if (vu && vu < new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))) flags.push("expired");
  if (q.incotermUncertain) flags.push("incoterm_uncertain");
  if (q.deviations && q.deviations.trim() && !/^none\b/i.test(q.deviations.trim())) flags.push("deviation");
  return { usdMinorE2: usd === null ? null : Math.round(usd), breakMinQty: brk.minQty, flags };
}

export function compare(line: { qty: number; unit: string }, parts: ParticipationInput[], fx: FxLookup, at: Date = now()): CompareResult {
  const quotes: ComparedQuote[] = [];
  for (const p of parts) {
    if (!p.quote) continue;
    const n = normaliseQuote(p.quote, line, fx, at);
    const flags = [...n.flags];
    if (p.verdict === "unchecked" || p.verdict === "unknown" || !p.verdict) flags.push("supplier_unchecked");
    if (p.verdict === "trading") flags.push("supplier_trading");
    if (p.status === "dropped" || p.status === "cannot_make") flags.push("excluded_status");
    const clean = !flags.some((f) => DISQUALIFYING_FLAGS.includes(f));
    quotes.push({ participationId: p.id, label: p.label, status: p.status, usdMinorE2: n.usdMinorE2, chosenBreakMinQty: n.breakMinQty, flags, clean });
  }
  const priced = quotes.filter((q) => q.usdMinorE2 !== null) as (ComparedQuote & { usdMinorE2: number })[];
  const byPrice = [...priced].sort((a, b) => a.usdMinorE2 - b.usdMinorE2);
  const bestClean = byPrice.find((q) => q.clean) ?? null;
  const lowestQuoted = byPrice[0] ?? null;
  const spread = byPrice.length >= 2 ? Math.round((byPrice[byPrice.length - 1].usdMinorE2 / byPrice[0].usdMinorE2) * 10) / 10 : null;
  const contacted = parts.filter((p) => p.status !== "cannot_make");
  const quotesCount = contacted.filter((p) => !!p.quote).length;
  const staleCount = parts.filter((p) => (p.status === "contacted" || p.status === "negotiating") && p.lastContactAt && (at.getTime() - toDate(p.lastContactAt)!.getTime()) / 86_400_000 > 7).length;
  return { quotes, bestClean, lowestQuoted, spread, quotesCount, contactedCount: contacted.length, staleCount };
}

/** The only sourcing numbers a client may see: "N contacted · M quoted" → `{ reached, priced }`. */
export function sourcingProgress(parts: { status: ParticipationStatus; hasQuote: boolean }[]): { reached: number; priced: number } {
  const contacted = parts.filter((p) => p.status !== "cannot_make");
  return { reached: contacted.length, priced: contacted.filter((p) => p.hasQuote).length };
}

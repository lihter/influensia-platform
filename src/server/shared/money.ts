/**
 * Money (D-21): integer minor units + ISO currency. Never floats in the database.
 * Two precisions exist:
 *  - `minor`     amounts/totals: cents ($1,860.00 = 186000)
 *  - `minorE2`   unit prices: minor × 100 (1/10,000 of the unit — $0.0539 = 539) so sub-cent quotes stay exact
 * Display rules per DESIGN §5.13 / SPEC B.6. `Intl.NumberFormat('en-US')` for v1.
 */
export type Money = { minor: number; currency: string };
export type UnitPrice = { minorE2: number; currency: string; unit?: string };

const SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", CNY: "¥", PLN: "zł", GBP: "£" };

export const symbolFor = (currency: string) => SYMBOLS[currency] ?? `${currency} `;

const groupFmt = (decimals: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: true });

/** Totals: 2 decimals, grouped, symbol prefix: `$6,740.00`. Negative amounts use U+2212. */
export function formatMoney(m: Money): string {
  const abs = Math.abs(m.minor) / 100;
  const s = `${symbolFor(m.currency)}${groupFmt(2).format(abs)}`;
  return m.minor < 0 ? `−${s}` : s;
}

/**
 * Unit price decimals: ≥ 1 → 2 dp (`$58.90`); < 1 → up to 4 dp, trailing zeros trimmed but never below 2 (`$0.26`, `$0.062`, `$0.0539`).
 * Pass `{ decimals }` to force a fixed precision (sourcing board shows 4 dp).
 */
export function formatUnitPrice(p: UnitPrice, opts?: { decimals?: number; withUnit?: boolean }): string {
  const value = Math.abs(p.minorE2) / 10000;
  let body: string;
  if (opts?.decimals !== undefined) body = groupFmt(opts.decimals).format(value);
  else if (value >= 1) body = groupFmt(2).format(value);
  else {
    const four = value.toFixed(4);
    const trimmed = four.replace(/0+$/, "");
    const dp = Math.max(2, trimmed.split(".")[1]?.length ?? 0);
    body = groupFmt(dp).format(value);
  }
  const s = `${p.minorE2 < 0 ? "−" : ""}${symbolFor(p.currency)}${body}`;
  return opts?.withUnit !== false && p.unit ? `${s} / ${p.unit}` : s;
}

/** `100,000 pcs` — grouped, unit suffix. */
export function formatQty(qty: number, unit?: string): string {
  const s = new Intl.NumberFormat("en-US").format(qty);
  return unit ? `${s} ${unit}` : s;
}

/** `70 %` with NNBSP; deltas with explicit sign. */
export function formatPct(pct: number, opts?: { signed?: boolean; decimals?: number }): string {
  const dp = opts?.decimals ?? (Number.isInteger(pct) ? 0 : 1);
  const body = groupFmt(dp).format(Math.abs(pct));
  const sign = pct < 0 ? "−" : opts?.signed && pct > 0 ? "+" : "";
  return `${sign}${body} %`;
}

/** Parses "1234.56" or "1,234.56" or "1 234,56" into minor units. Returns null when not a number. */
export function parseMoneyToMinor(input: string): number | null {
  const cleaned = input.trim().replace(/[\s  ]/g, "").replace(/,/g, (_, i, s: string) => (s.lastIndexOf(",") === i && s.indexOf(".") === -1 && s.length - i <= 3 ? "." : ""));
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export const minorToE2 = (minor: number) => minor * 100;
export const e2ToMinor = (e2: number) => Math.round(e2 / 100);

/** qty × unit price (e2) → total in minor units, rounded to the cent. */
export function lineTotalMinor(qty: number, unitPriceMinorE2: number): number {
  return Math.round((qty * unitPriceMinorE2) / 100);
}

/** Converts a unit price between currencies with a dated FX rate (base→quote). */
export function convertE2(minorE2: number, rateBasePerQuote: number): number {
  return Math.round(minorE2 / rateBasePerQuote);
}

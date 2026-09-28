/**
 * Pure, dependency-free helpers shared by the ops line page UI and the ops repositories (spec gate, cost/target maths,
 * offer prefill). Safe for client bundles. Unit-tested in tests/unit/board.test.ts.
 */

export type SpecCompleteness = { ok: boolean; missing: string[] };

/** SPEC F-15 completeness gate: name, category, unit, ≥ 3 spec fields, ≥ 1 image of any kind or ≥ 1 link, qty ≥ 1. */
export function specCompleteness(p: { name: string | null; category: string | null; unit: string | null; fieldCount: number; imageCount: number; linkCount: number; qty: number | null }): SpecCompleteness {
  const missing: string[] = [];
  if (!p.name?.trim()) missing.push("product name");
  if (!p.category) missing.push("category");
  if (!p.unit) missing.push("unit");
  if (p.fieldCount < 3) missing.push(`spec fields (${p.fieldCount} of 3)`);
  if (p.imageCount < 1 && p.linkCount < 1) missing.push("an image or a link");
  if (!p.qty || p.qty < 1) missing.push("quantity");
  return { ok: missing.length === 0, missing };
}

/** Short client-safe summary of spec fields: "size 66×91 mm, thickness 100 µm, …" */
export function summariseSpec(fields: Record<string, string | number | boolean>): string {
  return Object.entries(fields).slice(0, 5).map(([k, v]) => (typeof v === "boolean" ? (v ? k : `not ${k}`) : `${k} ${v}`)).join(", ");
}

/** SPEC F-16: target = round(est × (1 + uplift/100)) in minor×100 units (4 dp of the unit currency). */
export const targetPriceE2 = (estMinorE2: number, upliftPct: number) => Math.round(estMinorE2 * (1 + upliftPct / 100));
/** Default est. production cost = (material + process + packaging) × (1 + overhead %). */
export const defaultEstE2 = (material: number, process: number, packaging: number, overheadPct: number) => Math.round((material + process + packaging) * (1 + overheadPct / 100));

/** AC-OFB-02: client price = normalised quote × (1 + margin %) rounded to the rule's decimals (of the unit currency). */
export function prefillClientPriceE2(usdMinorE2: number, marginPct: number, rounding: number): number {
  const raw = (usdMinorE2 / 10000) * (1 + marginPct / 100);
  const factor = 10 ** Math.min(4, Math.max(0, rounding));
  return Math.round((Math.round(raw * factor) / factor) * 10000);
}
/** Flat fee prefill: fee % × ladder total at the line qty, in minor units. */
export function prefillFeeMinor(unitPriceMinorE2: number, qty: number, feePct: number): number {
  return Math.round(((unitPriceMinorE2 * qty) / 100) * (feePct / 100));
}

/** Unit price at a quantity from a ladder (largest min_qty ≤ qty, else the smallest). */
export function ladderPriceAt(breaks: { min_qty: number; unit_price_minor_e2: number }[], qty: number | null): number | null {
  if (!breaks.length) return null;
  const sorted = [...breaks].sort((a, b) => a.min_qty - b.min_qty);
  const brk = qty ? [...sorted].reverse().find((b) => b.min_qty <= qty) ?? sorted[0] : sorted[0];
  return brk.unit_price_minor_e2;
}

/** "0.0539 @ 100k" — compact qty label for the board. */
export function compactQty(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${+(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return String(n);
}

/** Parses a decimal unit price ("0.0539") to minor×100 (539). Null when not a number. */
export function parsePriceE2(input: string): number | null {
  const s = input.trim().replace(/,/g, ".").replace(/[^\d.]/g, "");
  if (!s || !/^\d*\.?\d*$/.test(s) || s === ".") return null;
  return Math.round(Number(s) * 10000);
}
/** Parses an amount ("540" / "540.00") to minor units (54000). */
export function parseAmountMinor(input: string): number | null {
  const s = input.trim().replace(/,/g, ".").replace(/[^\d.]/g, "");
  if (!s || !/^\d*\.?\d*$/.test(s) || s === ".") return null;
  return Math.round(Number(s) * 100);
}
export const e2ToText = (e2: number | null | undefined, dp = 4) => (e2 === null || e2 === undefined ? "" : (e2 / 10000).toFixed(dp).replace(/\.?0+$/, (m) => (m.startsWith(".") ? "" : m)));
export const minorToText = (minor: number | null | undefined) => (minor === null || minor === undefined ? "" : (minor / 100).toFixed(2));

/** Participation statuses that require a reason (SPEC F-17). */
export const REASON_REQUIRED: readonly string[] = ["shortlisted", "dropped", "cannot_make", "backup"];

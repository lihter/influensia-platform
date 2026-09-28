/**
 * Anonymity mechanism 4 (ARCHITECTURE §6.2): ids that must never reach a client are branded.
 * A `ServerOnly<string>` is not assignable to a zod `z.string()` output without an explicit cast,
 * so it cannot be placed in a client DTO by accident. The denylist test catches the key name anyway.
 */
declare const serverOnly: unique symbol;
export type ServerOnly<T> = T & { readonly [serverOnly]: true };

/** Shape of `request_lines.cost_model` (SPEC F-16). Internal only. */
export type CostModel = {
  material_floor_minor_e2?: number;
  process_cost_minor_e2?: number;
  packaging_minor_e2?: number;
  overhead_pct?: number;
  est_prod_cost_minor_e2: number;
  method?: string;
  notes?: string;
};

/** Shape of `request_lines.links_meta` entries (SPEC F-04). */
export type LinkMeta = { url: string; not_durable?: boolean; domain?: string };

/** Price ladder row stored on offer options: qty → unit price in minor×100 (1/10,000 of the currency unit). */
export type PriceBreak = { min_qty: number; unit_price_minor_e2: number };

/** Result stored on documents.leak_check_result. */
export type LeakCheckStored = { ok: boolean; at: string; hits: { kind: string; match: string; where: string }[] };

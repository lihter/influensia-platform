import { sql } from "drizzle-orm";
import type { Db } from "@/db";

export type SequenceName = "REQ" | "ORD" | "PRD" | "SUP" | "FACTORY_LABEL" | "FR";

/**
 * Human refs from app.sequences, atomic via INSERT ... ON CONFLICT ... RETURNING (SPEC §0.3).
 * `db.execute` returns `{rows}` on postgres-js and an array on PGlite — normalised here; reuse, don't re-implement.
 * Year-scoped: REQ, ORD. Year-less (year=0): PRD, SUP, FACTORY_LABEL, FR.
 */
export async function nextRef(db: Db, name: SequenceName, year = new Date().getUTCFullYear()): Promise<string> {
  const y = name === "REQ" || name === "ORD" ? year : 0;
  const res = await db.execute(sql`
    insert into app.sequences (name, year, next_value) values (${name}, ${y}, 2)
    on conflict (name, year) do update set next_value = app.sequences.next_value + 1
    returning next_value - 1 as v`);
  const rows = (res as { rows?: { v: number }[] }).rows ?? (res as unknown as { v: number }[]);
  return formatRef(name, Number(rows[0].v), y);
}

export function formatRef(name: SequenceName, v: number, year?: number): string {
  const n4 = String(v).padStart(4, "0");
  if (name === "FACTORY_LABEL") return `F-${n4}`;
  if (name === "PRD" || name === "SUP" || name === "FR") return `${name}-${n4}`;
  return `${name}-${year}-${n4}`;
}

/** Sets a sequence so that the NEXT value handed out is `next` (seed uses this to land on SPEC §7.3 numbers). */
export async function setSequence(db: Db, name: SequenceName, next: number, year = new Date().getUTCFullYear()) {
  const y = name === "REQ" || name === "ORD" ? year : 0;
  await db.execute(sql`
    insert into app.sequences (name, year, next_value) values (${name}, ${y}, ${next})
    on conflict (name, year) do update set next_value = ${next}`);
}

/* Derived refs (SPEC §0.3) — pure helpers, no db. */
export const lineRef = (requestRef: string, lineNo: number) => `${requestRef}-${String(lineNo).padStart(2, "0")}`;
export const offerRef = (lineRefValue: string, version: number) => `OFR-${lineRefValue.replace(/^REQ-/, "")}-v${version}`;
export const sampleRef = (lineRefValue: string, n: number) => `SMP-${lineRefValue.replace(/^REQ-/, "")}-${n}`;
/** ORD reuses the request number; a second order from the same request gets -B, -C. */
export const orderRefFromRequest = (requestRef: string, index = 0) => `${requestRef.replace(/^REQ-/, "ORD-")}${index ? `-${String.fromCharCode(65 + index)}` : ""}`;
export const poRef = (orderRef: string, n: number) => `PO-${orderRef.replace(/^ORD-/, "")}-${String(n).padStart(2, "0")}`;
export const piNumber = (orderRef: string) => `PI-${orderRef}`;

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { Unauthorized, Forbidden, NotFound } from "./authorize";
import { IllegalTransition } from "./state-machine";
import { LeakCheckError } from "./leak-check";

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wrap every route handler: maps domain errors to HTTP codes so no raw 500s leak stack traces. */
export function route<C>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof Unauthorized) return NextResponse.json({ error: "E_UNAUTHORIZED" }, { status: 401 });
      if (e instanceof Forbidden) return NextResponse.json({ error: "E_FORBIDDEN" }, { status: 403 });
      if (e instanceof NotFound) return NextResponse.json({ error: "E_NOT_FOUND" }, { status: 404 });
      if (e instanceof ZodError) return NextResponse.json({ error: "E_VALIDATION", issues: e.issues }, { status: 400 });
      if (e instanceof IllegalTransition) return NextResponse.json({ error: e.code, from: e.from, to: e.to }, { status: 409 });
      if (e instanceof LeakCheckError) return NextResponse.json({ error: e.code, hits: e.hits }, { status: 422 });
      console.error(e);
      return NextResponse.json({ error: "E_INTERNAL" }, { status: 500 });
    }
  };
}

/** Server-action result envelope (ARCHITECTURE §9). Never throw across the action boundary except redirect(). */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; errors?: Record<string, string>; hits?: LeakCheckError["hits"]; /** one human sentence for a toast */ message?: string };

/** "unitPriceMinorE2" / "breaks" / "lines.0.qty" → "Unit price" / "Price breaks" / "Quantity". */
const FIELD_LABELS: Record<string, string> = {
  breaks: "Price breaks", priceBreaks: "Price ladder", minQty: "Quantity", min_qty: "Quantity", unitPriceMinorE2: "Unit price", unit_price_minor_e2: "Unit price", moq: "MOQ", qty: "Quantity",
  leadDays: "Lead time", leadDaysMax: "Lead time (max)", upliftPct: "Uplift %", overheadPct: "Overhead %", materialFloorMinorE2: "Material floor", processCostMinorE2: "Process cost",
  packagingMinorE2: "Packaging", estProdCostMinorE2: "Est. production cost", feeMinor: "Fee", sampleCostMinor: "Sample cost", amountMinor: "Amount", validUntil: "Valid until", paidAt: "Paid on",
  counterparty: "Counterparty", body: "Message", text: "Message", reason: "Reason", name: "Name", email: "Email", password: "Password", unitWeightG: "Unit weight", packQty: "Pack quantity",
  recipientsCount: "Recipients", depositPct: "Deposit %", forwarder: "Forwarder", unit: "Unit", port: "Port", incoterm: "Incoterm", currency: "Currency",
};
const labelOf = (path: PropertyKey[]) => {
  const key = [...path].reverse().find((p) => typeof p === "string") as string | undefined;
  if (!key) return null;
  return FIELD_LABELS[key] ?? key.replace(/MinorE2$|Minor$/, "").replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^\w/, (c) => c.toUpperCase());
};

/**
 * QA-15: zod's default messages ("Too small: expected number to be >=0") are replaced by field-level human sentences.
 * Custom messages (set with `.min(1, "Enter a quantity")` etc.) are kept as they are.
 */
export function humanIssue(i: ZodError["issues"][number]): string {
  const raw = i.message ?? "";
  const isDefault = /^(Too small|Too big|Invalid input|Invalid option|Invalid string|Invalid|Expected|Required|Unrecognized)/.test(raw);
  if (!isDefault) return raw;
  const label = labelOf(i.path) ?? "This field";
  const x = i as unknown as { code: string; origin?: string; minimum?: number | bigint; maximum?: number | bigint; expected?: string; input?: unknown; format?: string };
  switch (x.code) {
    case "too_small":
      if (x.origin === "array") return Number(x.minimum) <= 1 ? `${label}: add at least one row` : `${label}: add at least ${x.minimum}`;
      if (x.origin === "string") return Number(x.minimum) <= 1 ? `${label} is required` : `${label}: at least ${x.minimum} characters`;
      if (Number(x.minimum) === 0) return `${label} can't be negative`;
      return `${label} must be at least ${x.minimum}`;
    case "too_big":
      if (x.origin === "array") return `${label}: at most ${x.maximum}`;
      if (x.origin === "string") return `${label}: at most ${x.maximum} characters`;
      return `${label} must be at most ${Number(x.maximum).toLocaleString("en-US")}`;
    case "invalid_type":
      if (x.input === undefined || x.input === null || x.input === "") return `${label} is required`;
      if (x.expected === "int") return `${label}: whole numbers only`;
      if (x.expected === "number") return `${label}: enter a number`;
      return `${label} is invalid`;
    case "invalid_format":
      if (x.format === "email") return "Enter a valid email address";
      if (x.format === "url") return "Enter a valid link (https://…)";
      if (x.format === "uuid") return `${label} is invalid`;
      return `${label}: check the format`;
    case "invalid_value": return `${label}: choose one of the options`;
    default: return `${label} is invalid`;
  }
}

export function toActionError(e: unknown): ActionResult<never> {
  if (e instanceof ZodError) {
    const errors: Record<string, string> = {};
    for (const i of e.issues) { const k = i.path.join(".") || "_"; if (!errors[k]) errors[k] = humanIssue(i); }
    return { ok: false, error: "E_VALIDATION", errors, message: Object.values(errors)[0] };
  }
  const coded = e as { code?: unknown; status?: unknown; message?: unknown } | null;
  if (coded && typeof coded.code === "string" && /^E_[A-Z_]+$/.test(coded.code) && typeof coded.status === "number" && coded.status < 500 && !(e instanceof LeakCheckError) && !(e instanceof IllegalTransition) && !(e instanceof Unauthorized || e instanceof Forbidden || e instanceof NotFound)) {
    return { ok: false, error: coded.code };
  }
  if (e instanceof LeakCheckError) return { ok: false, error: e.code, hits: e.hits };
  if (e instanceof IllegalTransition) return { ok: false, error: e.code };
  if (e instanceof Unauthorized || e instanceof Forbidden || e instanceof NotFound) return { ok: false, error: e.code };
  console.error(e);
  return { ok: false, error: "E_INTERNAL" };
}

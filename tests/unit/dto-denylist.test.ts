import { describe, it, expect } from "vitest";
import { z } from "zod";

/**
 * Mechanism 3 (SPEC 5.3): walk every zod schema exported from src/server/client/dto/*.ts, recursively, and fail on any key
 * matching DENYLIST. Also asserts `.strict()` and a runtime probe with an extra `supplierId` key.
 */
const DENYLIST = /supplier|factory_id|participation|contact|wechat|alibaba|1688|uscc|quote|po_|factory_price|margin|target_price|cost_model|uplift|internal|storage_key|booking/i;
/** Reviewed exceptions — keep this list tiny and justified. */
const ALLOW = new Set<string>([]);

const modules = import.meta.glob("../../src/server/client/dto/*.ts", { eager: true }) as Record<string, Record<string, unknown>>;

function unwrap(s: z.ZodType): z.ZodType {
  let cur: z.ZodType = s;
  for (let i = 0; i < 10; i++) {
    if (cur instanceof z.ZodOptional || cur instanceof z.ZodNullable || cur instanceof z.ZodDefault || cur instanceof z.ZodReadonly) cur = cur.unwrap() as z.ZodType;
    else if (cur instanceof z.ZodPipe) cur = cur.in as z.ZodType;
    else break;
  }
  return cur;
}

function collectKeys(schema: z.ZodType, path = "", seen = new Set<z.ZodType>()): string[] {
  const s = unwrap(schema);
  if (seen.has(s)) return [];
  seen.add(s);
  if (s instanceof z.ZodObject) {
    return Object.entries(s.shape).flatMap(([k, v]) => [`${path}${k}`, ...collectKeys(v as z.ZodType, `${path}${k}.`, seen)]);
  }
  if (s instanceof z.ZodArray) return collectKeys(s.element as z.ZodType, `${path}[].`, seen);
  if (s instanceof z.ZodUnion || s instanceof z.ZodDiscriminatedUnion) return (s.options as z.ZodType[]).flatMap((o) => collectKeys(o, path, seen));
  if (s instanceof z.ZodRecord) return collectKeys(s.valueType as z.ZodType, `${path}*.`, seen);
  return [];
}

function assertStrict(schema: z.ZodType, name: string) {
  const s = unwrap(schema);
  if (s instanceof z.ZodObject) {
    const catchall = s.def.catchall as { def?: { type?: string } } | undefined;
    expect(catchall?.def?.type, `${name} must be built with .strict()`).toBe("never");
    for (const [k, v] of Object.entries(s.shape)) assertStrict(v as z.ZodType, `${name}.${k}`);
  } else if (s instanceof z.ZodArray) assertStrict(s.element as z.ZodType, `${name}[]`);
  else if (s instanceof z.ZodUnion) for (const o of s.options as z.ZodType[]) assertStrict(o, name);
}

describe("client DTO denylist (mechanism 3)", () => {
  const entries = Object.entries(modules).filter(([p]) => !p.endsWith("/index.ts"));
  it("finds the DTO modules", () => { expect(entries.length).toBeGreaterThanOrEqual(9); });
  let dtoCount = 0;
  for (const [modPath, mod] of entries) {
    for (const [name, value] of Object.entries(mod)) {
      if (!(value instanceof z.ZodType)) continue;
      const s = unwrap(value);
      if (!(s instanceof z.ZodObject)) continue;
      dtoCount++;
      it(`${modPath.split("/").pop()} › ${name}: no denied keys, strict at every level`, () => {
        const keys = collectKeys(value);
        const bad = keys.filter((k) => DENYLIST.test(k.split(".").pop()!.replace(/\[\]$/, "")) && !ALLOW.has(k));
        expect(bad).toEqual([]);
        assertStrict(value, name);
      });
    }
  }
  it("covers every required client shape", () => {
    const names = entries.flatMap(([, m]) => Object.keys(m));
    for (const n of ["ClientRequestDto", "ClientRequestLineDto", "ClientOfferDto", "ClientOfferOptionDto", "ClientSampleDto", "ClientOrderDto", "ClientOrderLineDto", "ClientPaymentDto", "ClientDocumentDto", "ClientCommentDto", "ClientUpdateDto", "ClientCatalogDto", "ClientCatalogProductDto", "ClientFactoryRangeDto", "ClientDashboardDto"]) expect(names, n).toContain(n);
    expect(dtoCount).toBeGreaterThan(15);
  });
  it("rejects an extra supplierId key at runtime", async () => {
    const { ClientRequestLineDto, ClientDocumentDto } = await import("@/server/client/dto");
    expect(() => ClientDocumentDto.parse({ id: crypto.randomUUID(), filename: "a.pdf", kind: "pi", bytes: 1, uploadedAt: new Date().toISOString(), downloadUrl: "/x", supplierId: "leak" })).toThrow();
    expect(() => ClientRequestLineDto.parse({ supplierId: "leak" })).toThrow();
  });
  it("sourcing progress travels as numbers only", async () => {
    const { SourcingProgressDto } = await import("@/server/client/dto");
    expect(SourcingProgressDto.parse({ reached: 3, priced: 2 })).toEqual({ reached: 3, priced: 2 });
    expect(() => SourcingProgressDto.parse({ reached: 3, priced: 2, quoted: 2 })).toThrow();
  });
});

import { describe, it, expect } from "vitest";
import * as E from "@/db/enums";
import { LABELS, ENUM_KIND, label, specKeyLabel, specValueLabel, initials, humanizeKey, unitLabel } from "@/lib/labels";
import { fmtDate, fmtDateShort, fmtDayTime, fmtTime, fmtDateTime, fmtInputDate, parseInputDate, dayKey } from "@/lib/format-date";

describe("label map (FIX_PHASE contract b)", () => {
  const arrays = Object.entries(E).filter(([, v]) => Array.isArray(v)) as [keyof typeof E, readonly string[]][];

  it("maps every enum array in src/db/enums.ts to a label kind", () => {
    const unmapped = arrays.map(([k]) => k).filter((k) => !ENUM_KIND[k]);
    expect(unmapped).toEqual([]);
  });

  it("has a human label for every enum value", () => {
    const missing: string[] = [];
    for (const [name, values] of arrays) {
      const kind = ENUM_KIND[name];
      if (!kind) continue;
      const dict = LABELS[kind] as Record<string, string>;
      for (const v of values) if (!dict[v] || !dict[v].trim()) missing.push(`${name}.${v}`);
    }
    expect(missing).toEqual([]);
  });

  it("never returns snake_case", () => {
    for (const [name, values] of arrays) {
      const kind = ENUM_KIND[name]!;
      for (const v of values) expect(label(kind, v), `${name}.${v}`).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
    }
    expect(label("state", "made_up_state" as never)).toBe("Made up state");
  });

  it("humanises the review's examples", () => {
    expect(label("commercialMode", "agency_passthrough")).toBe("Agency pass-through");
    expect(label("pricingDisplay", "factory_plus_fee")).toBe("Factory + fee");
    expect(label("role", "client_owner")).toBe("Owner");
    expect(label("requestSource", "agent_on_behalf")).toBe("Entered by an agent");
    expect(label("offerStatus", "sent")).toBe("Sent");
    expect(label("paymentStatus", "pending")).toBe("Due");
    expect(label("inspectionResult", null)).toBe("Not inspected yet");
    expect(label("boolean", true)).toBe("Yes");
    expect(label("boolean", false)).toBe("No");
    expect(label("documentKind", "other")).toBe("Document");
    expect(specKeyLabel("pvc_free")).toBe("PVC-free");
    expect(specKeyLabel("Load Total")).toBe("Total load");
    expect(specKeyLabel("weird_new_key")).toBe("Weird new key");
    expect(specValueLabel(true)).toBe("Yes");
    expect(specValueLabel("false")).toBe("No");
    expect(humanizeKey("loadPerShelf")).toBe("Load per shelf");
    expect(unitLabel("pair", 10000)).toBe("pairs");
    expect(unitLabel("pcs", 1)).toBe("pc");
  });

  it("initials ignore bracketed suffixes", () => {
    expect(initials("Anna (KOFF)")).toBe("AN");
    expect(initials("Piotr Nowak")).toBe("PN");
    expect(initials("")).toBe("?");
  });
});

describe("EU dates (FIX_PHASE contract c)", () => {
  it("formats instants in Europe/Zagreb", () => {
    const d = "2026-09-28T12:05:00Z"; // 14:05 CEST
    expect(fmtDate(d)).toBe("28 Sep 2026");
    expect(fmtDateShort(d)).toBe("28 Sep");
    expect(fmtDayTime(d)).toBe("28 Sep, 14:05");
    expect(fmtTime(d)).toBe("14:05");
    expect(fmtDateTime(d)).toBe("28 Sep 2026, 14:05");
    expect(dayKey("2026-09-28T23:30:00Z")).toBe("2026-09-29");
    expect(fmtDate(null)).toBe("—");
  });
  it("never shifts date-only strings", () => {
    expect(fmtDate("2026-10-12")).toBe("12 Oct 2026");
    expect(fmtInputDate("2026-10-12")).toBe("12.10.2026");
  });
  it("parses day-first input", () => {
    expect(parseInputDate("12.10.2026")).toBe("2026-10-12");
    expect(parseInputDate("12/10/2026")).toBe("2026-10-12");
    expect(parseInputDate("1.2.26")).toBe("2026-02-01");
    expect(parseInputDate("12.10.", 2027)).toBe("2027-10-12");
    expect(parseInputDate("2026-10-31")).toBe("2026-10-31");
    expect(parseInputDate("31.02.2026")).toBeNull();
    expect(parseInputDate("13.13.2026")).toBeNull();
    expect(parseInputDate("abc")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { waitingOn, isStale, staleSince } from "@/server/shared/derived";
import { workingDaysBetween, addWorkingDays } from "@/server/shared/dates";
import { compare, sourcingProgress } from "@/server/shared/compare";

const NOW = new Date("2026-09-28T09:00:00Z"); // Monday

describe("working days + stale (SPEC B.3)", () => {
  it("counts Mon–Fri exclusive of start, inclusive of end", () => {
    expect(workingDaysBetween("2026-09-17", NOW)).toBe(7);
    expect(workingDaysBetween("2026-09-23", NOW)).toBe(3);
    expect(workingDaysBetween("2026-09-21", NOW)).toBe(5);
    expect(workingDaysBetween("2026-09-26", NOW)).toBe(1); // Saturday → Monday
    expect(addWorkingDays("2026-09-25", 3).toISOString().slice(0, 10)).toBe("2026-09-30");
  });
  it("stale = waiting on agency and > 5 working days", () => {
    expect(isStale({ state: "spec_frozen", lastStateChangeAt: "2026-09-17" }, NOW)).toBe(true);
    expect(isStale({ state: "spec_frozen", lastStateChangeAt: "2026-09-21" }, NOW)).toBe(false);
    expect(isStale({ state: "in_production", lastStateChangeAt: "2026-09-23" }, NOW)).toBe(false);
    expect(isStale({ state: "offer_ready", offerStatus: "sent", lastStateChangeAt: "2026-08-01" }, NOW), "waiting on client → never stale").toBe(false);
    expect(isStale({ state: "submitted", lastStateChangeAt: "2026-09-01" }, NOW), "unassigned submitted is stale by the same rule").toBe(true);
    expect(isStale({ state: "rfq_out", exception: "on_hold", lastStateChangeAt: "2026-08-01" }, NOW)).toBe(false);
    expect(isStale({ state: "rfq_out", exception: "cancelled", lastStateChangeAt: "2026-08-01" }, NOW)).toBe(false);
    expect(staleSince({ state: "rfq_out", lastStateChangeAt: "2026-09-12" }, NOW)?.toISOString().slice(0, 10)).toBe("2026-09-18") // 12 Sep is a Saturday;
  });
});

describe("waitingOn (SPEC B.2)", () => {
  it("follows the table", () => {
    expect(waitingOn({ state: "draft" })).toEqual({ party: "none", reason: "none" });
    expect(waitingOn({ state: "offer_ready", offerStatus: "sent" })).toEqual({ party: "client", reason: "offer_sent" });
    expect(waitingOn({ state: "offer_ready", offerStatus: "declined" })).toEqual({ party: "agency", reason: "offer_followup" });
    expect(waitingOn({ state: "sampling", sampleStatus: "received" })).toEqual({ party: "client", reason: "sample_received" });
    expect(waitingOn({ state: "sampling", sampleStatus: "shipped" })).toEqual({ party: "agency", reason: "sample_in_progress" });
    expect(waitingOn({ state: "awaiting_deposit", payments: [{ kind: "deposit", status: "pending" }, { kind: "fee", status: "paid" }] })).toEqual({ party: "client", reason: "deposit_due" });
    expect(waitingOn({ state: "awaiting_deposit", payments: [{ kind: "deposit", status: "paid" }, { kind: "fee", status: "paid" }] })).toEqual({ party: "agency", reason: "advance_state" });
    expect(waitingOn({ state: "awaiting_artwork", artworks: [null] })).toEqual({ party: "client", reason: "artwork_due" });
    expect(waitingOn({ state: "awaiting_artwork", artworks: [{ status: "changes_requested" }] })).toMatchObject({ party: "client", reason: "artwork_due", detail: "artwork_changes_requested" });
    expect(waitingOn({ state: "awaiting_artwork", artworks: [{ status: "submitted" }] })).toEqual({ party: "agency", reason: "artwork_review" });
    expect(waitingOn({ state: "awaiting_balance", payments: [{ kind: "balance", status: "pending" }] })).toEqual({ party: "client", reason: "balance_due" });
    expect(waitingOn({ state: "delivered" })).toEqual({ party: "client", reason: "delivery_confirm" });
    expect(waitingOn({ state: "completed" })).toEqual({ party: "none", reason: "none" });
    expect(waitingOn({ state: "negotiating" })).toEqual({ party: "agency", reason: "negotiating" });
    expect(waitingOn({ state: "negotiating", exception: "needs_input" })).toEqual({ party: "client", reason: "needs_input" });
    expect(waitingOn({ state: "negotiating", exception: "on_hold" })).toEqual({ party: "none", reason: "none" });
  });
});

describe("compare (SPEC B.4, AC-BOARD-02)", () => {
  const fx = (c: string) => (c === "CNY" ? 6.6933 : c === "USD" ? 1 : null);
  const line = { qty: 100000, unit: "pcs" };
  const parts = [
    { id: "yuantuo", label: "Yuantuo", status: "selected" as const, verdict: "manufacturer" as const, lastContactAt: "2026-09-26", quote: { currency: "USD", unit: "pcs", incoterm: "FOB", validUntil: "2026-09-30", deviations: "none at spec thickness", breaks: [{ minQty: 100000, unitPriceMinorE2: 539 }] } },
    { id: "suti", label: "Suti", status: "dropped" as const, verdict: "trading" as const, lastContactAt: "2026-09-05", quote: { currency: "USD", unit: "bag", packQty: 100, incoterm: "FOB", validUntil: "2026-09-08", breaks: [{ minQty: 3000, unitPriceMinorE2: 32000 }] } },
    { id: "yili", label: "Yili", status: "quoted" as const, verdict: "unchecked" as const, lastContactAt: "2026-09-16", quote: { currency: "USD", unit: "bag", packQty: 100, incoterm: "EXW", incotermUncertain: true, validUntil: "2026-10-15", breaks: [{ minQty: 3000, unitPriceMinorE2: 34800 }] } },
    { id: "drcard", label: "Dr. Card", status: "quoted" as const, verdict: "manufacturer" as const, lastContactAt: "2026-09-20", quote: { currency: "USD", unit: "pack", packQty: 100, incoterm: "FOB", validUntil: "2026-10-20", breaks: [{ minQty: 1000, unitPriceMinorE2: 74500 }] } },
    { id: "quoted", label: "Quote D", status: "backup" as const, verdict: "unchecked" as const, lastContactAt: "2026-09-14", quote: { currency: "USD", unit: "pcs", incoterm: "FOB", validUntil: "2026-10-31", breaks: [{ minQty: 100000, unitPriceMinorE2: 760 }] } },
    { id: "boyuan", label: "Boyuan", status: "contacted" as const, verdict: "manufacturer" as const, lastContactAt: "2026-09-18", quote: null },
    { id: "fuli", label: "Fuli", status: "contacted" as const, verdict: "manufacturer" as const, lastContactAt: "2026-09-13", quote: null },
    { id: "jinou", label: "Jinou", status: "cannot_make" as const, verdict: "manufacturer" as const, lastContactAt: "2026-09-05", quote: null },
    { id: "zz", label: "ZZLEAKTEST", status: "quoted" as const, verdict: "manufacturer" as const, lastContactAt: "2026-09-12", quote: { currency: "USD", unit: "pcs", incoterm: "FOB", incotermUncertain: true, validUntil: "2026-09-20", breaks: [{ minQty: 100000, unitPriceMinorE2: 500 }] } },
  ];
  it("computes the AC-BOARD-02 strip", () => {
    const r = compare(line, parts, fx, NOW);
    expect(r.bestClean?.label).toBe("Yuantuo");
    expect(r.bestClean?.usdMinorE2).toBe(539);
    expect(r.lowestQuoted?.label).toBe("Suti");
    expect(r.lowestQuoted?.usdMinorE2).toBe(320);
    expect(r.lowestQuoted?.flags).toEqual(expect.arrayContaining(["excluded_status", "expired", "supplier_trading"]));
    expect(r.spread).toBe(2.4);
    expect(r.quotesCount).toBe(6);
    expect(r.contactedCount).toBe(8);
    expect(r.staleCount).toBe(2);
    expect(r.quotes.find((q) => q.label === "Yili")?.flags).toEqual(expect.arrayContaining(["incoterm_uncertain", "supplier_unchecked"]));
  });
  it("normalises CNY with the dated rate and per-bag quotes to per-piece (AC-BOARD-04)", () => {
    const r = compare({ qty: 100000, unit: "pcs" }, [{ id: "x", label: "X", status: "quoted", verdict: "manufacturer", quote: { currency: "CNY", unit: "pcs", incoterm: "FOB", validUntil: "2026-10-31", breaks: [{ minQty: 100000, unitPriceMinorE2: 2400 }] } }], fx, NOW);
    expect(r.quotes[0].usdMinorE2).toBe(359); // ¥0.24 / 6.6933 = $0.0359
    expect(sourcingProgress([{ status: "quoted", hasQuote: true }, { status: "quoted", hasQuote: true }, { status: "contacted", hasQuote: false }, { status: "cannot_make", hasQuote: false }])).toEqual({ reached: 3, priced: 2 });
  });
});

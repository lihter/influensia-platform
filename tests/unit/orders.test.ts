import { describe, it, expect } from "vitest";
import { paymentPlan, unitPriceAtQty, primaryActionFor, allowedOrderTransitions, isOverdue } from "@/server/ops/orders";
import { extractText, publishLeakCheck } from "@/server/ops/documents";
import { canReadKey } from "@/server/shared/files";
import { withVisibility } from "@/server/shared/storage";
import { ClientOrderPageDto } from "@/server/client/dto/orders";
import { clientDownloadUrl } from "@/server/client/documents";
import type { LeakSources } from "@/server/shared/leak-check";

const SOURCES: LeakSources = {
  names: ["Dongguan Yuantuo Packaging Products Co., Ltd.", "ZZLEAKTEST Co., Ltd.", "ZZ泄漏测试有限公司"],
  handles: ["zzleaktest_wx", "https://zzleaktest.en.alibaba.com"],
  phones: ["+86 138 0000 0042"],
  contactNames: ["Leak Tester", "Daryl Yang"],
  usccs: ["91440300ZZLEAKTEST0"],
};

describe("F-22 confirm order — payment plan", () => {
  it("AC-OO-06: 10 000 × $0.26 + $150 fee at 30 % → deposit 780 / fee 150 / balance 1 820, payee agency", () => {
    const goods = Math.round((10_000 * 2600) / 100);
    expect(goods).toBe(260_000);
    const plan = paymentPlan({ goodsMinor: goods, feeMinor: 15_000, depositPct: 30, commercialMode: "agency_passthrough" });
    expect(plan.map((p) => [p.kind, p.amountMinor, p.payee])).toEqual([["deposit", 78_000, "agency"], ["fee", 15_000, "agency"], ["balance", 182_000, "agency"]]);
    expect(plan.reduce((s, p) => s + p.amountMinor, 0)).toBe(275_000);
  });
  it("agency_direct pays the factory for goods and the agency for the fee; zero fee drops the fee row", () => {
    const plan = paymentPlan({ goodsMinor: 100_000, feeMinor: 0, depositPct: 50, commercialMode: "agency_direct" });
    expect(plan.map((p) => [p.kind, p.amountMinor, p.payee])).toEqual([["deposit", 50_000, "factory"], ["balance", 50_000, "factory"]]);
    expect(paymentPlan({ goodsMinor: 100_000, feeMinor: 500, depositPct: 50, commercialMode: "agency_direct" }).find((p) => p.kind === "fee")?.payee).toBe("agency");
  });
  it("picks the ladder break at the order quantity", () => {
    const breaks = [{ min_qty: 100_000, unit_price_minor_e2: 620 }, { min_qty: 200_000, unit_price_minor_e2: 590 }];
    expect(unitPriceAtQty(breaks, 100_000)).toBe(620);
    expect(unitPriceAtQty(breaks, 250_000)).toBe(590);
    expect(unitPriceAtQty(breaks, 50_000)).toBe(620); // below MOQ → smallest break
    expect(unitPriceAtQty([], 1)).toBeNull();
  });
});

describe("F-22 stage primary + transitions", () => {
  const base = { exception: null, depositAndFeePaid: false, artworkNeeded: true, artworkApproved: false, balancePaid: false };
  it("follows DESIGN §6.10: Publish PI → Record payment → Approve artwork → Start production → Schedule inspection → …", () => {
    expect(primaryActionFor({ ...base, state: "order_confirmed" })?.key).toBe("publish_pi");
    expect(primaryActionFor({ ...base, state: "awaiting_deposit" })?.key).toBe("record_payment");
    expect(primaryActionFor({ ...base, state: "awaiting_deposit", depositAndFeePaid: true, artworkNeeded: false })?.key).toBe("start_production");
    expect(primaryActionFor({ ...base, state: "awaiting_artwork" })?.key).toBe("approve_artwork");
    expect(primaryActionFor({ ...base, state: "awaiting_artwork", artworkApproved: true })?.key).toBe("start_production");
    expect(primaryActionFor({ ...base, state: "in_production" })?.label).toBe("Schedule inspection");
    expect(primaryActionFor({ ...base, state: "in_production", exception: "qc_failed" })?.label).toBe("Schedule re-inspection");
    expect(primaryActionFor({ ...base, state: "qc_inspection" })?.key).toBe("record_inspection");
    expect(primaryActionFor({ ...base, state: "awaiting_balance" })?.key).toBe("record_payment");
    expect(primaryActionFor({ ...base, state: "awaiting_balance", balancePaid: true })?.key).toBe("record_forwarder");
    expect(primaryActionFor({ ...base, state: "eu_port_customs" })?.key).toBe("mark_delivered");
    expect(primaryActionFor({ ...base, state: "delivered" })?.key).toBe("close");
    expect(primaryActionFor({ ...base, state: "completed" })).toBeNull();
  });
  it("only lists SPEC §3.4 transitions for the execution lane", () => {
    expect(allowedOrderTransitions("shipped_exworks")).toEqual(["departed_origin"]);
    expect(allowedOrderTransitions("departed_origin")).toEqual(["eu_port_customs", "delivered"]);
    expect(allowedOrderTransitions("completed")).toEqual([]);
  });
  it("flags overdue pending payments only", () => {
    expect(isOverdue("2026-09-25", "pending", "2026-09-28")).toBe(true);
    expect(isOverdue("2026-09-25", "paid", "2026-09-28")).toBe(false);
    expect(isOverdue(null, "pending", "2026-09-28")).toBe(false);
  });
});

describe("F-23 publish leak check", () => {
  const pdf = (text: string) => Buffer.from(`%PDF-1.4\n1 0 obj << /Length 40 >> stream\nBT /F1 24 Tf 60 500 Td (${text}) Tj ET\nendstream endobj\n%%EOF`, "latin1");
  it("AC-DOC-02: the leaky report is blocked on its text layer (name + phone), the clean one passes", () => {
    const leaky = extractText(pdf("QC report — Dongguan Yuantuo Packaging Products Co., Ltd. +86 138 0000 0042"), "application/pdf", "leaky-report.pdf");
    expect(leaky).toContain("Yuantuo");
    const r = publishLeakCheck({ filename: "leaky-report.pdf", text: leaky }, SOURCES);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.hits.some((h) => h.kind === "supplier_name" && h.where === "pdf_text")).toBe(true);
      expect(r.hits.some((h) => h.kind === "phone_cn")).toBe(true);
    }
    const clean = extractText(pdf("QC report — 0 critical, 2 minor, passed"), "application/pdf", "clean-report.pdf");
    expect(publishLeakCheck({ filename: "clean-report.pdf", text: clean }, SOURCES)).toEqual({ ok: true });
  });
  it("AC-DOC-05: a file named after the canary is blocked on the filename alone (binary body skipped)", () => {
    const text = extractText(Buffer.from([0x50, 0x4b, 0x03, 0x04]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "ZZLEAKTEST price list.xlsx");
    expect(text).toBe("");
    const r = publishLeakCheck({ filename: "ZZLEAKTEST price list.xlsx", text }, SOURCES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.hits.map((h) => h.where)).toContain("filename");
  });
  it("reads .txt/.md bodies and escapes PDF literals", () => {
    expect(extractText(Buffer.from("hello wechat"), "text/plain", "note.txt")).toBe("hello wechat");
    expect(extractText(pdf("A \\(B\\) C"), "application/pdf", "x.pdf")).toBe("A (B) C");
    expect(publishLeakCheck({ filename: "note.md", text: "ping me on WeChat" }, SOURCES).ok).toBe(false);
  });
});

describe("F-23 client download gating (SPEC 5.6)", () => {
  const org = "018f0000-0000-7000-8000-000000000001";
  const ent = "018f0000-0000-7000-8000-000000000002";
  const file = "018f0000-0000-7000-8000-000000000003";
  const internalKey = `org/${org}/order/${ent}/internal/${file}.pdf`;
  const clientKey = withVisibility(internalKey, "client");
  it("withVisibility flips only the visibility segment", () => {
    expect(clientKey).toBe(`org/${org}/order/${ent}/client/${file}.pdf`);
  });
  it("a client can read its own /client/ key, never an /internal/ key nor another org's", () => {
    const me = { orgId: org, role: "client_owner" };
    expect(canReadKey(me, clientKey, null)).toBe(true);
    expect(canReadKey(me, internalKey, null)).toBe(false);
    expect(canReadKey({ orgId: "018f0000-0000-7000-8000-0000000000ff", role: "client_owner" }, clientKey, null)).toBe(false);
    expect(canReadKey({ orgId: "x", role: "agent" }, internalKey, null)).toBe(true);
  });
  it("the client DTO builder refuses to expose a non-client storage key", () => {
    expect(clientDownloadUrl(clientKey, "PI.pdf")).toBe(`/api/files/${clientKey}?filename=PI.pdf&dl=1`);
    expect(() => clientDownloadUrl(internalKey, "PO.pdf")).toThrow();
  });
});

describe("ClientOrderPageDto is strict", () => {
  it("rejects a supplierName smuggled into the page payload", () => {
    expect(() => ClientOrderPageDto.parse({ order: {}, companyLabel: "x", agentName: null, updates: [], history: [], previousOrders: [], artworkDue: [], supplierName: "leak" })).toThrow();
  });
});

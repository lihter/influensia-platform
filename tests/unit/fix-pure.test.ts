import { describe, it, expect } from "vitest";
import { z } from "zod";
import { collapseRepeats, collapseClientUpdates, collapseClientHistory } from "@/server/shared/timeline";
import { toActionError } from "@/server/shared/http";
import { subLabelFor, milestoneEmailSubject, clientMilestoneLabel, eventText } from "@/server/shared/labels";
import { sendOfferBlockedReason } from "@/server/ops/participations";
import { firstMilestoneDates, offerOutcomeOf } from "@/server/client/line-extras";
import { quoteStillValid } from "@/server/shared/reorder-fastpath";
import { passwordProblem } from "@/server/client/dto/settings";
import { ORDER_CONFIRMED_TEXT } from "@/server/ops/orders";

describe("timeline dedupe (UX review)", () => {
  const t = (min: number) => new Date(Date.UTC(2026, 8, 3, 9, min)).toISOString();
  it("collapses the same event text within 10 minutes, keeps the newest, never touches comments", () => {
    const items = [
      { kind: "event", text: "Spec confirmed (v1)", at: t(5) }, { kind: "event", text: "Spec confirmed (v1)", at: t(4) }, { kind: "comment", text: "ok", at: t(3) },
      { kind: "comment", text: "ok", at: t(3) }, { kind: "event", text: "Spec confirmed (v1)", at: t(0) }, { kind: "event", text: "Spec confirmed (v1)", at: t(0) },
    ];
    const out = collapseClientUpdates(items);
    expect(out.filter((x) => x.kind === "event")).toHaveLength(1);
    expect(out[0].at).toBe(t(5));
    expect(out.filter((x) => x.kind === "comment")).toHaveLength(2);
  });
  it("keeps repeats that are further apart than the window", () => {
    expect(collapseRepeats([{ k: "a", at: t(40) }, { k: "a", at: t(20) }, { k: "a", at: t(0) }], (x) => x.k, (x) => x.at)).toHaveLength(3);
    expect(collapseClientHistory([{ text: "RFQ out", at: t(50) }, { text: "RFQ out", at: t(0) }], 12 * 3600_000)).toHaveLength(1);
  });
});

describe("QA-15 human validation messages", () => {
  it("replaces zod defaults with field sentences and keeps custom messages", () => {
    const schema = z.object({ breaks: z.array(z.number()).min(1), moq: z.number().int().nonnegative(), upliftPct: z.number().max(500), qty: z.number().min(1, "Enter a quantity") });
    const r = schema.safeParse({ breaks: [], moq: -100, upliftPct: 99999, qty: 0 });
    const e = toActionError(r.error);
    expect(e.ok).toBe(false);
    if (!e.ok) {
      expect(e.errors?.breaks).toBe("Price breaks: add at least one row");
      expect(e.errors?.moq).toBe("MOQ can't be negative");
      expect(e.errors?.upliftPct).toBe("Uplift % must be at most 500");
      expect(e.errors?.qty).toBe("Enter a quantity");
      expect(e.message).toBeTruthy();
      expect(Object.values(e.errors ?? {}).join(" ")).not.toMatch(/Too (small|big)|expected/);
    }
  });
  it("maps domain error codes (OrderError-style) instead of E_INTERNAL", () => {
    class Coded extends Error { status = 409; code = "E_NOT_DELIVERED"; }
    expect(toActionError(new Coded())).toEqual({ ok: false, error: "E_NOT_DELIVERED" });
  });
});

describe("QA-11 / QA-12 / QA-04 wording", () => {
  it("offer_ready sub-label follows the offer outcome", () => {
    expect(subLabelFor("offer_ready", { offerStatus: "sent" })).toBe("Your price is ready");
    expect(subLabelFor("offer_ready", { offerStatus: "changes_requested" })).toBe("We're revising your price");
    expect(subLabelFor("offer_ready", { offerStatus: "declined" })).toMatch(/declined/);
    expect(offerOutcomeOf({ state: "offer_ready", offer: { status: "declined" } as never })).toBe("declined");
    expect(offerOutcomeOf({ state: "offer_ready", offer: { status: "sent" } as never })).toBeNull();
  });
  it("sample approved / offer accepted never says 'order confirmed'", () => {
    expect(milestoneEmailSubject("Sleeves", "offer_accepted", "order_confirmed")).toBe("Sleeves: we're preparing your order confirmation");
    expect(clientMilestoneLabel("offer_accepted", "order_confirmed")).toBe("Order being prepared");
    expect(clientMilestoneLabel("order_confirmed", "order_confirmed")).toBe("Order confirmed");
    expect(subLabelFor("order_confirmed")).toBe("Preparing your invoice");
  });
  it("order confirmation text never claims an invoice exists", () => {
    expect(ORDER_CONFIRMED_TEXT).not.toMatch(/issued/);
    expect(eventText("state_changed", { to: "order_confirmed", piNumber: "PI-ORD-2026-0301" })).not.toMatch(/issued/);
  });
});

describe("QA-07 send-offer reason", () => {
  it("explains every disabled state", () => {
    const base = { state: "quotes_in", exception: null, hasQuotes: true, hasSentOffer: false, hasOrder: false };
    expect(sendOfferBlockedReason(base)).toBeNull();
    expect(sendOfferBlockedReason({ ...base, state: "rfq_out" })).toBeNull(); // quotes exist → the send catches the line up
    expect(sendOfferBlockedReason({ ...base, hasQuotes: false })).toMatch(/quote/);
    expect(sendOfferBlockedReason({ ...base, hasSentOffer: true })).toMatch(/already with the client/);
    expect(sendOfferBlockedReason({ ...base, state: "in_review" })).toMatch(/Freeze the spec/);
    expect(sendOfferBlockedReason({ ...base, exception: "on_hold" })).toMatch(/on hold/);
  });
});

describe("misc pure helpers", () => {
  it("milestone dates: first reach per milestone, capped at the current one", () => {
    const at = (d: string) => new Date(`${d}T09:00:00Z`);
    const out = firstMilestoneDates([
      { type: "state_changed", payload: { milestone: "finding_factory" }, createdAt: at("2026-09-03") },
      { type: "state_changed", payload: { milestone: "finding_factory" }, createdAt: at("2026-09-05") },
      { type: "state_changed", payload: { milestone: "price_ready" }, createdAt: at("2026-09-08") },
      { type: "order_confirmed", payload: {}, createdAt: at("2026-09-20") },
    ], at("2026-09-01"), "price_ready");
    expect(out.map((x) => [x.milestone, x.at.slice(0, 10)])).toEqual([["received", "2026-09-01"], ["finding_factory", "2026-09-03"], ["price_ready", "2026-09-08"]]);
  });
  it("reorder fast path needs a quote valid today or later", () => {
    expect(quoteStillValid("2026-10-31", "2026-09-28")).toBe(true);
    expect(quoteStillValid("2026-09-27", "2026-09-28")).toBe(false);
    expect(quoteStillValid(null, "2026-09-28")).toBe(false);
  });
  it("QA-41 password rules report one problem at a time, length first", () => {
    expect(passwordProblem("short")).toBe("At least 10 characters");
    expect(passwordProblem("longenoughbutnodigit")).toBe("Include at least one digit");
    expect(passwordProblem("1234567890")).toBe("Include at least one letter");
    expect(passwordProblem("GoodPassword2026")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { CreateClientInput, ClientSettingsInput, AddClientUserInput, userStatus, isOpenState } from "@/server/ops/clients";
import { renderSubject, indexLogLines, parseStatusFilter, parseTemplateFilter } from "@/server/ops/outbox";
import { PricingRuleInput, AgencyProfileInput, ruleExample } from "@/server/ops/settings";
import { PasswordInput, ProfileInput, NOTIFICATION_PREFS } from "@/server/client/settings";
import { ClientAccountDto } from "@/server/client/dto/settings";

const d = (s: string | null) => (s ? new Date(s) : null);

describe("F-26 clients admin — validation and derived values", () => {
  it("CreateClientInput applies SPEC 1.3 defaults and normalises email/country", () => {
    const r = CreateClientInput.parse({ orgName: " Pevex ", country: "hr", userName: "Ana Horvat", email: " Ana@Pevex.HR " });
    expect(r).toMatchObject({ orgName: "Pevex", country: "HR", email: "ana@pevex.hr", commercialMode: "agency_passthrough", pricingDisplay: "factory_plus_fee", defaultIncoterm: "FOB", language: "en", vatId: null });
  });
  it("CreateClientInput rejects bad email, short name, non-ISO country, unknown incoterm", () => {
    const bad = CreateClientInput.safeParse({ orgName: "X", country: "Croatia", userName: "A", email: "nope", defaultIncoterm: "XYZ" });
    expect(bad.success).toBe(false);
    const paths = bad.success ? [] : bad.error.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["country", "userName", "email", "defaultIncoterm"]));
  });
  it("ClientSettingsInput coerces deposit and blanks VAT to null", () => {
    const r = ClientSettingsInput.parse({ name: "KOFF", country: "pl", vatId: "", commercialMode: "principal", pricingDisplay: "all_in", defaultIncoterm: "EXW", depositPct: "40", language: "pl", timezone: "Europe/Warsaw" });
    expect(r.depositPct).toBe(40);
    expect(r.vatId).toBeNull();
    expect(r.country).toBe("PL");
    expect(ClientSettingsInput.safeParse({ ...r, depositPct: 101 }).success).toBe(false);
  });
  it("AddClientUserInput needs a uuid org id", () => {
    expect(AddClientUserInput.safeParse({ orgId: "koff", name: "Anna", email: "a@b.co" }).success).toBe(false);
    expect(AddClientUserInput.safeParse({ orgId: "01a0e773-cd7f-7dfa-a718-5e8cba456ec8", name: "Anna", email: "a@b.co" }).success).toBe(true);
  });
  it("userStatus: deactivated > invited > active (AC-CLI-02 'Invited' until a password is set)", () => {
    expect(userStatus({ deactivatedAt: null, passwordSetAt: null })).toBe("invited");
    expect(userStatus({ deactivatedAt: null, passwordSetAt: d("2026-05-02") })).toBe("active");
    expect(userStatus({ deactivatedAt: d("2026-09-01"), passwordSetAt: d("2026-05-02") })).toBe("deactivated");
    expect(userStatus({ deactivatedAt: d("2026-09-01"), passwordSetAt: null })).toBe("deactivated");
  });
  it("isOpenState (AC-CLI-01 'active lines'): delivered, completed and cancelled are not active; ordered lines still are", () => {
    expect(isOpenState("negotiating", null)).toBe(true);
    expect(isOpenState("in_production", "on_hold")).toBe(true);
    expect(isOpenState("delivered", null)).toBe(false);
    expect(isOpenState("completed", null)).toBe(false);
    expect(isOpenState("negotiating", "cancelled")).toBe(false);
  });
});

describe("F-27 outbox viewer — pure helpers", () => {
  it("renderSubject prefers the stored subject, else derives one from template + payload", () => {
    expect(renderSubject({ subject: "Price ready — Deck box", template: "client_offer_ready", payload: {}, entityRef: null })).toBe("Price ready — Deck box");
    expect(renderSubject({ subject: null, template: "client_milestone_changed", payload: { name: "Deck box", milestone: "in_production" }, entityRef: "REQ-1" })).toBe("Deck box: in production");
    expect(renderSubject({ subject: null, template: "ops_new_request", payload: {}, entityRef: "REQ-2026-0312" })).toBe("ops new request — REQ-2026-0312");
  });
  it("indexLogLines maps row id → JSON line and skips garbage", () => {
    const text = [
      JSON.stringify({ ts: "2026-09-28T09:00:00Z", id: "a1", template: "auth_invite", to: "x@y.z" }),
      "not json at all",
      "",
      JSON.stringify({ ts: "2026-09-28T09:00:00Z", template: "no id" }),
      JSON.stringify({ id: "b2", template: "client_offer_ready" }),
    ].join("\n");
    const m = indexLogLines(text);
    expect([...m.keys()]).toEqual(["a1", "b2"]);
    expect(m.get("b2")).toContain("client_offer_ready");
  });
  it("status/template filters accept enum values only", () => {
    expect(parseStatusFilter("pending")).toBe("pending");
    expect(parseStatusFilter("bogus")).toBeUndefined();
    expect(parseStatusFilter(undefined)).toBeUndefined();
    expect(parseTemplateFilter("auth_invite")).toBe("auth_invite");
    expect(parseTemplateFilter("client_x")).toBeUndefined();
  });
});

describe("ops settings — pricing rules", () => {
  it("PricingRuleInput coerces strings from the inline editor and bounds percentages", () => {
    expect(PricingRuleInput.parse({ category: "fitness", marginPct: "18", feePct: "10", upliftPct: "20", rounding: "2" })).toEqual({ category: "fitness", marginPct: 18, feePct: 10, upliftPct: 20, rounding: 2 });
    expect(PricingRuleInput.safeParse({ category: "fitness", marginPct: 120, feePct: 10, upliftPct: 20 }).success).toBe(false);
    expect(PricingRuleInput.safeParse({ category: "toys", marginPct: 10, feePct: 10, upliftPct: 20 }).success).toBe(false);
    expect(PricingRuleInput.parse({ category: "default", marginPct: 15, feePct: 10, upliftPct: 20 }).rounding).toBe(2);
  });
  it("AgencyProfileInput upper-cases country and incoterm", () => {
    expect(AgencyProfileInput.parse({ name: "Influensia", country: "ro", timezone: "Europe/Zagreb", defaultIncoterm: "fob" })).toMatchObject({ country: "RO", defaultIncoterm: "FOB" });
  });
  it("ruleExample: $1.00 factory → all-in and fee in minor×100", () => {
    expect(ruleExample({ marginPct: 15, feePct: 10, upliftPct: 20 })).toEqual({ upliftedE2: 12000, allInE2: 11500, feeE2: 1000 });
  });
});

describe("F-01 client settings", () => {
  it("PasswordInput enforces ≥10 chars, a letter, a digit and matching confirm", () => {
    const ok = PasswordInput.safeParse({ currentPassword: "Password123!", newPassword: "NewSecret2026", confirm: "NewSecret2026" });
    expect(ok.success).toBe(true);
    const short = PasswordInput.safeParse({ currentPassword: "x", newPassword: "Short1", confirm: "Short1" });
    expect(short.success).toBe(false);
    const noDigit = PasswordInput.safeParse({ currentPassword: "x", newPassword: "OnlyLettersHere", confirm: "OnlyLettersHere" });
    expect(noDigit.success).toBe(false);
    const mismatch = PasswordInput.safeParse({ currentPassword: "x", newPassword: "NewSecret2026", confirm: "NewSecret2027" });
    expect(mismatch.success).toBe(false);
    expect(mismatch.success ? [] : mismatch.error.issues.map((i) => i.path.join("."))).toContain("confirm");
  });
  it("ProfileInput trims and bounds the name", () => {
    expect(ProfileInput.parse({ name: "  Piotr Nowak " }).name).toBe("Piotr Nowak");
    expect(ProfileInput.safeParse({ name: "P" }).success).toBe(false);
  });
  it("action-needed notifications are required and cannot be muted (D-09)", () => {
    const req = NOTIFICATION_PREFS.filter((p) => p.required);
    expect(req.map((p) => p.key)).toEqual(["action_needed"]);
    expect(req.every((p) => p.enabled)).toBe(true);
  });
  it("ClientAccountDto is strict and never carries an org id or supplier-shaped keys", () => {
    const base = {
      name: "Piotr", email: "piotr@example.pl", role: "client_owner", passwordSetAt: null, lastSeenAt: null,
      company: { name: "Piotr's team", country: "PL", vatId: null, language: "en", currencyDisplay: "USD", defaultIncoterm: "FOB", timezone: "Europe/Warsaw", pricingDisplay: "factory_plus_fee" },
      teammates: [], notifications: NOTIFICATION_PREFS,
    };
    expect(ClientAccountDto.parse(base)).toBeTruthy();
    expect(() => ClientAccountDto.parse({ ...base, orgId: "leak" })).toThrow();
    expect(() => ClientAccountDto.parse({ ...base, company: { ...base.company, supplierId: "leak" } })).toThrow();
  });
});

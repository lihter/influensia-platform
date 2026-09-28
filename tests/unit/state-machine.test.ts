import { describe, it, expect } from "vitest";
import { STATES, MILESTONES, MILESTONE_OF, TRANSITIONS, assertTransition, milestoneChanged, milestoneFor, IllegalTransition, ACTION_MILESTONES, canTransition } from "@/server/shared/state-machine";

describe("state machine (SPEC §3)", () => {
  it("has 24 states and 9 milestones, every state mapped to exactly one milestone", () => {
    expect(STATES.length).toBe(24);
    expect(MILESTONES.length).toBe(9);
    for (const s of STATES) expect(MILESTONES).toContain(MILESTONE_OF[s]);
    for (const s of STATES) for (const t of TRANSITIONS[s]) expect(STATES).toContain(t);
    expect(() => milestoneFor("nope")).toThrow();
  });
  it("maps the SPEC §3.2 table", () => {
    expect(milestoneFor("submitted")).toBe("received");
    expect(milestoneFor("spec_frozen")).toBe("finding_factory");
    expect(milestoneFor("offer_ready")).toBe("price_ready");
    expect(milestoneFor("sampling")).toBe("sample");
    expect(milestoneFor("offer_accepted")).toBe("order_confirmed");
    expect(milestoneFor("awaiting_artwork")).toBe("order_confirmed");
    expect(milestoneFor("awaiting_balance")).toBe("quality_check");
    expect(milestoneFor("eu_port_customs")).toBe("shipping");
    expect(milestoneFor("completed")).toBe("delivered");
    expect(ACTION_MILESTONES).toEqual(["price_ready", "sample", "order_confirmed", "quality_check", "delivered"]);
  });
  it("every state is reachable from draft", () => {
    const seen = new Set<string>(["draft"]); const q = ["draft"];
    while (q.length) for (const t of TRANSITIONS[q.shift() as keyof typeof TRANSITIONS]) if (!seen.has(t)) { seen.add(t); q.push(t); }
    expect([...seen].sort()).toEqual([...STATES].sort());
  });
  it("allows every transition of SPEC §3.4", () => {
    const allowed: [string, string][] = [
      ["draft", "submitted"], ["submitted", "in_review"], ["submitted", "spec_frozen"], ["in_review", "spec_frozen"], ["spec_frozen", "cost_target_price"],
      ["cost_target_price", "rfq_out"], ["spec_frozen", "rfq_out"], ["rfq_out", "quotes_in"], ["quotes_in", "shortlisted"], ["shortlisted", "negotiating"], ["quotes_in", "negotiating"],
      ["negotiating", "offer_ready"], ["quotes_in", "offer_ready"], ["shortlisted", "offer_ready"], ["offer_ready", "negotiating"], ["offer_ready", "rfq_out"], ["offer_ready", "shortlisted"],
      ["offer_ready", "sampling"], ["offer_ready", "offer_accepted"], ["sampling", "offer_accepted"], ["offer_accepted", "sampling"], ["sampling", "negotiating"], ["sampling", "shortlisted"],
      ["offer_accepted", "order_confirmed"], ["order_confirmed", "awaiting_deposit"], ["awaiting_deposit", "awaiting_artwork"], ["awaiting_artwork", "in_production"], ["awaiting_deposit", "in_production"],
      ["in_production", "qc_inspection"], ["qc_inspection", "awaiting_balance"], ["qc_inspection", "in_production"], ["awaiting_balance", "forwarder_booked"], ["forwarder_booked", "shipped_exworks"],
      ["shipped_exworks", "departed_origin"], ["departed_origin", "eu_port_customs"], ["eu_port_customs", "delivered"], ["departed_origin", "delivered"], ["delivered", "completed"],
    ];
    for (const [f, t] of allowed) expect(canTransition(f as never, t as never), `${f} → ${t}`).toBe(true);
  });
  it("rejects illegal transitions with E_ILLEGAL_TRANSITION", () => {
    for (const [f, t] of [["draft", "shipped_exworks"], ["submitted", "offer_ready"], ["in_production", "delivered"], ["completed", "delivered"], ["offer_accepted", "in_production"]] as const) {
      expect(() => assertTransition(f, t)).toThrow(IllegalTransition);
      try { assertTransition(f, t); } catch (e) { expect((e as IllegalTransition).code).toBe("E_ILLEGAL_TRANSITION"); expect((e as IllegalTransition).message).toContain(`${f} -> ${t}`); }
    }
  });
  it("reports milestone changes", () => {
    expect(milestoneChanged("in_review", "spec_frozen")).toBe("finding_factory");
    expect(milestoneChanged("rfq_out", "quotes_in")).toBeNull();
    expect(milestoneChanged("negotiating", "offer_ready")).toBe("price_ready");
    expect(milestoneChanged("awaiting_deposit", "awaiting_artwork")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { platformOf, clientInitials, parseQty, perUnit, nextStepFor, addWorkingDays, shortLink, stepperDates, chipLabel, trackingUrl } from "@/components/app/client-format";

const NOW = new Date("2026-09-28T10:00:00Z"); // Monday

describe("client-format (FIX-B)", () => {
  it("platform badge from host", () => {
    expect(platformOf("https://allegro.pl/oferta/x-123").label).toBe("Allegro");
    expect(platformOf("https://www.emag.ro/c/pd/X/").label).toBe("eMAG");
    expect(platformOf("https://www.amazon.de/dp/B0").key).toBe("amazon");
    expect(platformOf("https://detail.1688.com/offer/1.html").label).toBe("1688");
    expect(platformOf("https://www.alibaba.com/product-detail/x.html").label).toBe("Alibaba");
    expect(platformOf("https://vm.tiktok.com/abc").label).toBe("TikTok");
    expect(platformOf("https://shop.example.co.uk/p").key).toBe("other");
    expect(platformOf("not a url").label).toBe("Link");
  });

  it("initials use the first letters of the first two words", () => {
    expect(clientInitials("Anna (KOFF)")).toBe("AK");
    expect(clientInitials("Piotr Nowak")).toBe("PN");
    expect(clientInitials("Piotr")).toBe("P");
    expect(clientInitials("")).toBe("?");
  });

  it("quantity parsing accepts grouping and k/m, keeps decimals for rejection", () => {
    expect(parseQty("50,000")).toBe(50000);
    expect(parseQty("5 000")).toBe(5000);
    expect(parseQty("5k")).toBe(5000);
    expect(parseQty("2.5")).toBe(2.5);
    expect(parseQty("abc")).toBeNull();
    expect(perUnit("pcs")).toBe("pc");
    expect(perUnit("pair")).toBe("pair");
  });

  it("working days skip weekends", () => {
    expect(addWorkingDays("2026-09-25T10:00:00Z", 1).toISOString().slice(0, 10)).toBe("2026-09-28"); // Fri → Mon
    expect(addWorkingDays("2026-09-28T10:00:00Z", 5).toISOString().slice(0, 10)).toBe("2026-10-05");
  });

  it("next step: quotes being compared → price ~2 working days later", () => {
    const s = nextStepFor({ milestone: "finding_factory", state: "quotes_in", sourcing: { reached: 3, priced: 2 }, since: "2026-09-28T09:00:00Z", agentName: "Bogdan", now: NOW });
    expect(s.now).toBe("Bogdan is comparing 2 quotes");
    expect(s.next).toBe("Your price");
    expect(s.short).toBe("Price by ~30 Sep");
  });

  it("next step: an overdue expectation rolls forward, never into the past", () => {
    const s = nextStepFor({ milestone: "finding_factory", state: "rfq_out", sourcing: { reached: 2, priced: 0 }, since: "2026-09-01T09:00:00Z", now: NOW });
    expect(s.short).toBe("Price by ~29 Sep");
  });

  it("next step: the client's move and QA-11 outcomes are truthful", () => {
    expect(nextStepFor({ milestone: "sample", waitingReason: "sample_received", since: NOW, now: NOW }).party).toBe("client");
    const rev = nextStepFor({ milestone: "price_ready", state: "offer_ready", offerOutcome: "changes_requested", since: "2026-09-28T09:00:00Z", agentName: "Bogdan", now: NOW });
    expect(rev.now).toBe("Bogdan is revising your price");
    expect(rev.next).toBe("New price");
    expect(chipLabel({ milestoneLabel: "Price ready", offerOutcome: "changes_requested" })).toBe("New price coming");
    expect(chipLabel({ milestoneLabel: "Price ready", offerOutcome: "declined" })).toBe("Offer declined");
    expect(nextStepFor({ milestone: "delivered", since: NOW, now: NOW }).short).toBeNull();
  });

  it("stepper dates: actual for reached steps, ~expected for the next one", () => {
    const step = nextStepFor({ milestone: "finding_factory", state: "rfq_out", sourcing: { reached: 2, priced: 0 }, since: "2026-09-28T09:00:00Z", now: NOW });
    const d = stepperDates([{ milestone: "received", at: "2026-09-01T09:00:00Z" }, { milestone: "finding_factory", at: "2026-09-03T09:00:00Z" }], "finding_factory", step);
    expect(d.received?.text).toBe("1 Sep");
    expect(d.price_ready).toEqual({ text: "~5 Oct", expected: true });
  });

  it("short links never print the raw URL", () => {
    expect(shortLink("https://allegro.pl/oferta/rekawiczki-robocze-12539547048?x=1")).toBe("allegro.pl › rekawiczki-robocze-12539547048");
    expect(trackingUrl("DHL", "JD01")).toContain("dhl.com");
    expect(trackingUrl(null, null)).toBeNull();
  });
});

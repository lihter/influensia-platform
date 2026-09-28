/**
 * Fix-phase logic flows against a freshly seeded PGlite (FIX-A: QA-04/05/06/07/08/09/10/11/12/13/19 + timeline dedupe).
 * Seeds once into a temp dir (~10 s). Pure-function checks live in the other unit files.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// real db + first-time module imports: generous per-test timeout (the machine may be busy)
vi.setConfig({ testTimeout: 180_000 });
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "fixa-"));
process.env.PGLITE_DIR = path.join(dir, "pglite");
process.env.FILES_DIR = path.join(dir, "files");
process.env.OUTBOX_LOG = path.join(dir, "outbox.log");
process.env.SEED_CLOCK = "2026-09-28T09:00:00Z";
process.env.SEED_SHIFT_DAYS = "0"; // the literal SPEC §7 dates (the seed is today-relative by default)
delete process.env.DATABASE_URL;

type Ctx = import("@/server/shared/authorize").Ctx;
let db: Awaited<ReturnType<typeof import("@/db").getDb>>;
let S: typeof import("@/db/schema/app");
let SUP: typeof import("@/db/schema/supplier");
let D: typeof import("drizzle-orm");
const ctxs: Record<string, Ctx> = {};

async function ctxFor(email: string): Promise<Ctx> {
  const { member } = await import("@/db/schema/auth");
  const [u] = await db.select().from(S.users).where(D.eq(S.users.email, email)).limit(1);
  const [m] = await db.select().from(member).where(D.eq(member.userId, u.id)).limit(1);
  const [o] = await db.select().from(S.organizations).where(D.eq(S.organizations.id, u.orgId)).limit(1);
  return { userId: u.id, email, name: u.name, orgId: o.id, authOrgId: m.organizationId, role: m.role as Ctx["role"], orgType: o.type };
}
async function line(ref: string) { return (await db.select().from(S.requestLines).where(D.eq(S.requestLines.lineRef, ref)).limit(1))[0]; }

beforeAll(async () => {
  const { seed } = await import("@/db/seed");
  await seed();
  db = await (await import("@/db")).getDb();
  S = await import("@/db/schema/app");
  SUP = await import("@/db/schema/supplier");
  D = await import("drizzle-orm");
  for (const [k, e] of [["bogdan", "bogdan@influensia.ro"], ["marko", "marko@influensia.ro"], ["piotr", "piotr@example.pl"], ["anna", "buyer@koff.example"]] as const) ctxs[k] = await ctxFor(e);
}, 600_000);

afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* PGlite may still hold files */ } });

describe("seed quality (UX review)", () => {
  it("no identical consecutive timeline events on the REQ-2026-0312 request page; no 'invoice issued' claims", async () => {
    const { getClientRequest } = await import("@/server/client/requests");
    const page = await getClientRequest(ctxs.piotr, "REQ-2026-0312");
    const texts = page.history.map((h) => h.text);
    expect(texts.filter((t) => t === "Spec confirmed (v1)")).toHaveLength(0);
    const perDay = page.history.map((h) => `${h.at.slice(0, 10)}|${h.text}`);
    expect(perDay.length, "the same sentence twice on one day").toBe(new Set(perDay).size);
    expect(texts.join("|")).not.toMatch(/invoice PI-.* issued/);
  });
  it("Piotr's lines carry his own references, not KOFF's; no ZZLEAKTEST-named file except the canary's price list", async () => {
    const rows = await db.select({ sku: S.requestLines.clientSku }).from(S.requestLines).where(D.eq(S.requestLines.orgId, ctxs.piotr.orgId));
    expect(rows.some((r) => /KOFF/.test(r.sku ?? ""))).toBe(false);
    const docs = await db.select({ f: S.documents.filename, kind: S.documents.kind }).from(S.documents).where(D.ilike(S.documents.filename, "ZZLEAKTEST%"));
    expect(docs.every((d) => d.kind === "price_list")).toBe(true);
  });
});

describe("QA-06 offer port", () => {
  it("prefills a real loading port (never the factory's inland city) and blocks an inland city on send", async () => {
    const { getOpsLine } = await import("@/server/ops/participations");
    const l = await getOpsLine(ctxs.bogdan, "REQ-2026-0301-01");
    expect(l.offerDefaults.port).not.toBe("Linyi");
    expect(["Qingdao", "Ningbo"]).toContain(l.offerDefaults.port);
    const { saveOffer } = await import("@/server/ops/offers");
    const { LeakCheckError } = await import("@/server/shared/leak-check");
    const sel = l.participations.find((p) => p.isSelected)!;
    await expect(saveOffer(ctxs.bogdan, { lineId: l.id, incoterm: "FOB", port: "Linyi", validUntil: "2026-10-20", options: [{ label: "A", participationId: sel.id, priceBreaks: [{ min_qty: 10000, unit_price_minor_e2: 2600 }], feeMinor: 15000, deviationsPlain: "none", sampleRequired: false }] }, { send: true })).rejects.toBeInstanceOf(LeakCheckError);
  });
});

describe("QA-07 quotes logged before 'Mark RFQ sent'", () => {
  it("spec_frozen line + quote → quotes_in with an auto-recorded RFQ; sendOfferBlockedReason clears", async () => {
    const { addParticipation, getOpsLine } = await import("@/server/ops/participations");
    const { logQuote } = await import("@/server/ops/quotes");
    const l0 = await line("REQ-2026-0312-26");
    expect(l0.state).toBe("spec_frozen");
    const [sup] = await db.select().from(SUP.suppliers).where(D.eq(SUP.suppliers.ref, "SUP-0012"));
    const { participationId } = await addParticipation(ctxs.bogdan, { lineId: l0.id, supplierId: sup.id });
    expect((await getOpsLine(ctxs.bogdan, l0.lineRef)).sendOfferBlockedReason).toMatch(/quote/i);
    await logQuote(ctxs.bogdan, { participationId, currency: "USD", unit: "pcs", incoterm: "FOB", port: "Shenzhen", moq: 2000, validUntil: "2026-10-31", breaks: [{ minQty: 2000, unitPriceMinorE2: 60000 }] });
    expect((await line("REQ-2026-0312-26")).state).toBe("quotes_in");
    const rfq = await db.select().from(S.rfqs).where(D.eq(S.rfqs.requestLineId, l0.id));
    expect(rfq.length).toBe(1);
    expect((await getOpsLine(ctxs.bogdan, l0.lineRef)).sendOfferBlockedReason).toBeNull();
  });
  it("rfq_out line + quote → quotes_in; change state without override to an illegal target explains why", async () => {
    const { logQuote } = await import("@/server/ops/quotes");
    const { changeLineState } = await import("@/server/ops/participations");
    const l = await line("REQ-2026-0312-14");
    const [p] = await db.select().from(SUP.supplierParticipations).where(D.eq(SUP.supplierParticipations.requestLineId, l.id)).limit(1);
    await logQuote(ctxs.bogdan, { participationId: p.id, currency: "USD", unit: "pcs", breaks: [{ minQty: 5000, unitPriceMinorE2: 3000 }] });
    expect((await line("REQ-2026-0312-14")).state).toBe("quotes_in");
    await expect(changeLineState(ctxs.bogdan, { lineId: l.id, to: "sampling" })).rejects.toThrow(/Can't move/);
    await expect(changeLineState(ctxs.marko, { lineId: l.id, to: "negotiating", override: true })).rejects.toThrow(/reason/);
  });
});

describe("QA-11 → QA-04: change request, v2, accept, confirm order", () => {
  it("after 'Ask for changes' the client line says a new price is coming", async () => {
    const { requestOfferChanges } = await import("@/server/client/offers");
    const { getClientLine } = await import("@/server/client/lines");
    await requestOfferChanges(ctxs.anna, { ref: "OFR-2026-0301-01-v1", text: "Can you do 12,000 pairs at a better price?" });
    const page = await getClientLine(ctxs.anna, "REQ-2026-0301-01");
    expect(page.line.offerOutcome).toBe("changes_requested");
    expect(page.line.subLabel).toBe("We're revising your price");
    expect(page.line.subLabel).not.toMatch(/ready/i);
  });
  it("v2 sent, accepted, order confirmed: one 'Order confirmed' update, no invoice claim, no due date before the PI", async () => {
    const { getOpsLine } = await import("@/server/ops/participations");
    const { saveOffer } = await import("@/server/ops/offers");
    const { acceptOffer } = await import("@/server/client/offers");
    const { createOrderFromAccepted } = await import("@/server/ops/orders");
    const { getClientOrder } = await import("@/server/client/orders");
    const l = await getOpsLine(ctxs.bogdan, "REQ-2026-0301-01");
    const sel = l.participations.find((p) => p.isSelected)!;
    const sent = await saveOffer(ctxs.bogdan, { lineId: l.id, incoterm: "FOB", port: l.offerDefaults.port, validUntil: "2026-10-20", options: [{ label: "A", participationId: sel.id, priceBreaks: [{ min_qty: 10000, unit_price_minor_e2: 2500 }], feeMinor: 15000, deviationsPlain: "none", sampleRequired: false }] }, { send: true });
    await acceptOffer(ctxs.anna, { ref: sent.offerRef, optionLabel: "A" });
    const ln = await line("REQ-2026-0301-01");
    const { ref } = await createOrderFromAccepted(ctxs.bogdan, { requestId: ln.requestId, lines: [{ requestLineId: ln.id, artworkRequired: false }], commercialMode: "agency_passthrough", pricingDisplay: "factory_plus_fee", incoterm: "FOB", port: "Qingdao", piNumber: null, depositPct: 30, feeMinor: 15000 });
    const page = await getClientOrder(ctxs.anna, ref);
    expect(page.updates.filter((u) => /^Order confirmed/.test(u.text))).toHaveLength(1);
    expect(page.history.filter((u) => /^Order confirmed/.test(u.text))).toHaveLength(1);
    expect(JSON.stringify(page)).not.toMatch(/invoice PI-[^"]* issued/i);
    const pays = await db.select().from(S.payments).where(D.eq(S.payments.orderId, page.order.id));
    expect(pays.every((p) => p.dueOn === null)).toBe(true);
  });
});

describe("QA-12 sample approved ≠ order confirmed", () => {
  it("email subject and chip say the order is being prepared", async () => {
    const { approveSample } = await import("@/server/client/samples");
    const { getClientLine } = await import("@/server/client/lines");
    await approveSample(ctxs.piotr, { ref: "SMP-2026-0312-02-1" });
    const mails = await db.select().from(S.notificationOutbox).where(D.and(D.eq(S.notificationOutbox.template, "client_milestone_changed"), D.eq(S.notificationOutbox.entityRef, "REQ-2026-0312-02"), D.eq(S.notificationOutbox.status, "pending")));
    expect(mails.length).toBeGreaterThan(0);
    for (const m of mails) { expect(m.subject).toMatch(/preparing your order confirmation/); expect(m.subject).not.toMatch(/order confirmed/i); }
    const page = await getClientLine(ctxs.piotr, "REQ-2026-0312-02");
    expect(page.line.milestoneLabel).toBe("Order being prepared");
    expect(page.line.milestoneDates.map((d) => d.milestone)).toContain("received");
  });
});

describe("QA-05 reorder fast path", () => {
  it("valid previous quote → negotiating, supplier selected, draft offer prefilled", async () => {
    const { reorder } = await import("@/server/client/orders");
    const [o] = await db.select().from(S.orders).where(D.eq(S.orders.ref, "ORD-2026-0290"));
    const [ol] = await db.select().from(S.orderLines).where(D.eq(S.orderLines.orderId, o.id));
    const r = await reorder(ctxs.anna, "ORD-2026-0290", { lines: [{ orderLineId: ol.id, qty: 1000 }] });
    const nl = await line(r.lineRefs[0]);
    expect(nl.state).toBe("negotiating");
    expect(nl.selectedParticipationId).toBeTruthy();
    expect(nl.assignedAgentId).toBe(ctxs.bogdan.userId);
    const drafts = await db.select().from(S.offers).where(D.eq(S.offers.requestLineId, nl.id));
    expect(drafts).toHaveLength(1);
    expect(drafts[0].status).toBe("draft");
    const opts = await db.select().from(S.offerOptions).where(D.eq(S.offerOptions.offerId, drafts[0].id));
    expect(opts[0].priceBreaks.length).toBeGreaterThan(0);
    const mail = await db.select().from(S.notificationOutbox).where(D.and(D.eq(S.notificationOutbox.template, "ops_new_request"), D.eq(S.notificationOutbox.entityRef, r.requestRef)));
    expect(mail[0].subject).toMatch(/^Repeat order .* from KOFF \(1 line/);
  });
});

describe("QA-10 range / catalog lines get an owner", () => {
  it("range items are assigned to the agent working that factory for the client", async () => {
    const { requestRangeItems } = await import("@/server/client/ranges");
    const [r] = await db.select().from(S.factoryRanges).where(D.eq(S.factoryRanges.ref, "FR-0001"));
    const items = await db.select().from(S.factoryRangeItems).where(D.eq(S.factoryRangeItems.rangeId, r.id));
    const res = await requestRangeItems(ctxs.piotr, { rangeId: r.id, items: [{ itemId: items[0].id, qty: 100000 }] });
    expect((await line(res.lineRefs[0])).assignedAgentId).toBe(ctxs.bogdan.userId);
  });
  it("catalog requests are assigned and move to in_review", async () => {
    const { requestOffer } = await import("@/server/client/catalog");
    const res = await requestOffer(ctxs.anna, { productRef: "PRD-0002", qty: 20000 });
    const l = await line(res.lineRef);
    expect(l.assignedAgentId).toBeTruthy();
    expect(l.state).toBe("in_review");
  });
});

describe("QA-08 change request + ask on the request", () => {
  it("frozen line → change_request comment + change_requested exception; request question → ops email", async () => {
    const { requestSpecChange, askAboutRequest } = await import("@/server/client/comments");
    await requestSpecChange(ctxs.piotr, { lineRef: "REQ-2026-0312-03", text: "Please make it 62×88 mm instead" });
    const l = await line("REQ-2026-0312-03");
    expect(l.exception).toBe("change_requested");
    await expect(requestSpecChange(ctxs.anna, { lineRef: "REQ-2026-0325-01", text: "Please change the wattage" })).rejects.toThrow(/E_NOT_CHANGEABLE/);
    const r = await askAboutRequest(ctxs.piotr, { requestRef: "REQ-2026-0312", body: "Can all lines ship together?" });
    const mail = await db.select().from(S.notificationOutbox).where(D.and(D.eq(S.notificationOutbox.template, "ops_client_question"), D.eq(S.notificationOutbox.entityRef, "REQ-2026-0312")));
    expect(mail.length).toBeGreaterThan(0);
    expect(r.commentId).toBeTruthy();
  });
});

describe("QA-09 password reset + invite", () => {
  it("forgot password writes a reset email with a token that resets the password", async () => {
    const { requestPasswordReset, resetPasswordWithToken } = await import("@/server/shared/account-password");
    await requestPasswordReset("piotr@example.pl");
    const [mail] = await db.select().from(S.notificationOutbox).where(D.eq(S.notificationOutbox.template, "auth_password_reset"));
    const url = String((mail.payload as { url: string }).url);
    expect(url).toMatch(/\/reset-password\?token=/);
    const token = decodeURIComponent(url.split("token=")[1]);
    expect(await resetPasswordWithToken(token, "NewSecret2026")).toEqual({ ok: true, email: "" });
    expect(await resetPasswordWithToken(token, "NewSecret2026")).toMatchObject({ ok: false });
    const { getAuth } = await import("@/lib/auth/server");
    const signed = await (await getAuth()).api.signInEmail({ body: { email: "piotr@example.pl", password: "NewSecret2026" } });
    expect(signed.user.email).toBe("piotr@example.pl");
    await requestPasswordReset("nobody@example.com"); // no throw, no enumeration
  });
  it("the invite link sets the user's own password", async () => {
    const { inviteUser } = await import("@/server/ops/admin");
    const { inviteLookup, acceptInvite } = await import("@/server/shared/account-password");
    const inv = await inviteUser(ctxs.marko, { email: "new.buyer@example.pl", name: "Nowy Buyer", orgId: ctxs.piotr.orgId });
    expect(await inviteLookup(inv.inviteToken)).toMatchObject({ ok: true, email: "new.buyer@example.pl" });
    expect(await acceptInvite(inv.inviteToken, "MyOwnPass2026")).toMatchObject({ ok: true });
    expect(await inviteLookup(inv.inviteToken)).toMatchObject({ ok: false });
    const [u] = await db.select().from(S.users).where(D.eq(S.users.email, "new.buyer@example.pl"));
    expect(u.passwordSetAt).not.toBeNull();
    const { getAuth } = await import("@/lib/auth/server");
    const signed = await (await getAuth()).api.signInEmail({ body: { email: "new.buyer@example.pl", password: "MyOwnPass2026" } });
    expect(signed.user.email).toBe("new.buyer@example.pl");
  });
});

describe("QA-13 / QA-19 validation", () => {
  it("huge quantity is a field error, not a 500", async () => {
    const { NewRequestSchema } = await import("@/server/client/requests");
    const r = NewRequestSchema.safeParse({ lines: [{ name: "Test item", qty: 99999999999999 }] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/too large/i);
  });
  it("a fake .jpg is rejected as an invalid image (E_VALIDATION on file)", async () => {
    const { storeUpload } = await import("@/server/shared/files");
    const { toActionError } = await import("@/server/shared/http");
    const err = await storeUpload(db, { orgId: ctxs.anna.orgId, userId: ctxs.anna.userId, data: Buffer.from("not an image at all"), mime: "image/jpeg", originalName: "fake.jpg", entity: "order", entityId: ctxs.anna.orgId, visibility: "client" }).catch((e) => e);
    const r = toActionError(err);
    expect(r).toMatchObject({ ok: false, error: "E_VALIDATION" });
    if (!r.ok) expect(r.errors?.file).toMatch(/valid image/);
  });
});

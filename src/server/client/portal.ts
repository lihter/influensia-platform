/**
 * Client portal lists: "Products" (everything we source for this client, picture first, with its price) and "Orders"
 * (newest first, each step as a check mark: deposit · artwork · production · shipping · balance · commission, + invoice).
 * App schema only; every row passes a strict client DTO.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { organizations, orders, orderLines, requestLines, offers, offerOptions, payments, artworks, documents, files } from "@/db/schema/app";
import { type Ctx, isClient, Forbidden } from "@/server/shared/authorize";
import { loadLineContexts, type LineContext } from "@/server/shared/line-context";
import { MILESTONES, isBeforeOrder } from "@/server/shared/state-machine";
import { clientMilestoneLabel } from "@/server/shared/labels";
import { formatDate } from "@/server/shared/dates";
import { clientWaitingReason, etaLabelFor } from "./dashboard";
import { clientDownloadUrl } from "./documents";
import { unitPriceAtQty } from "./lines";
import { offerOutcomeOf } from "./line-extras";
import { lineThumbnails, linkDomain } from "./thumbnails";
import { ClientDocumentDto } from "./dto/document";
import { ClientProductRowDto, ClientProductListDto, ClientOrderRowDto, ClientOrderListDto, type ClientOrderStepDto } from "./dto/portal";

/** The client's company name — the only org attribute a client sees (sidebar group label, page eyebrows). */
export async function companyLabel(orgId: string) {
  const db = await getDb();
  return (await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1))[0]?.name ?? "";
}

/* ───────────────────────── Products ───────────────────────── */

export async function listClientProducts(ctx: Ctx): Promise<ClientProductListDto> {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  const lcs = (await loadLineContexts(db, { orgId: ctx.orgId })).filter((l) => l.exception !== "cancelled");
  const ids = lcs.map((l) => l.id);
  const [lineRows, thumbs, olRows, openOffers] = await Promise.all([
    ids.length ? db.select({ id: requestLines.id, productId: requestLines.productId }).from(requestLines).where(inArray(requestLines.id, ids)) : Promise.resolve([]),
    lineThumbnails(db, ctx.orgId, ids),
    ids.length ? db.select({ lineId: orderLines.requestLineId, productId: orderLines.productId, ref: orders.ref, at: orders.confirmedAt, created: orders.createdAt, incoterm: orders.incoterm, port: orders.port })
      .from(orderLines).innerJoin(orders, eq(orders.id, orderLines.orderId)).where(and(eq(orders.orgId, ctx.orgId), isNull(orders.deletedAt))) : Promise.resolve([]),
    ids.length ? db.select({ lineId: offers.requestLineId, status: offers.status, incoterm: offers.incoterm, port: offers.port, currency: offers.currency, pricingDisplay: offers.pricingDisplay, breaks: offerOptions.priceBreaks, fee: offerOptions.feeMinor })
      .from(offers).innerJoin(offerOptions, eq(offerOptions.offerId, offers.id)).where(and(eq(offers.orgId, ctx.orgId), inArray(offers.requestLineId, ids), isNull(offers.deletedAt))) : Promise.resolve([]),
  ]);
  const productOf = new Map(lineRows.map((r) => [r.id, r.productId]));

  // a repeat product shows once: its most recently updated line, with every order of that product counted
  const groups = new Map<string, LineContext[]>();
  for (const lc of lcs) {
    const key = productOf.get(lc.id) ?? lc.id;
    groups.set(key, [...(groups.get(key) ?? []), lc]);
  }
  const rows = [...groups.values()].map((ls) => {
    const lc = [...ls].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    const pid = productOf.get(lc.id);
    const ords = olRows.filter((o) => (pid ? o.productId === pid : false) || ls.some((l) => l.id === o.lineId))
      .sort((a, b) => (b.at ?? b.created).getTime() - (a.at ?? a.created).getTime());
    const uniqueOrders = [...new Map(ords.map((o) => [o.ref, o])).values()];
    const lastOrder = uniqueOrders[0] ?? null;

    let price: ClientProductRowDto["price"] = null;
    let priceBasis: ClientProductRowDto["priceBasis"] = null;
    let fee: ClientProductRowDto["fee"] = null;
    let incoterm: string | null = lastOrder?.incoterm ?? null;
    let port: string | null = lastOrder?.port ?? null;
    const pd = lc.order?.pricingDisplay ?? lc.offer?.pricingDisplay ?? null;
    if (lc.order?.orderLine) {
      price = { minorE2: lc.order.orderLine.unitPriceMinorE2, currency: lc.offer?.currency ?? "USD", unit: lc.order.orderLine.unit };
      priceBasis = "ordered";
      if (pd === "factory_plus_fee") fee = { minor: lc.order.orderLine.feeMinor, currency: lc.offer?.currency ?? "USD" };
    } else if (lc.offer?.acceptedUnitPriceMinorE2 != null) {
      price = { minorE2: lc.offer.acceptedUnitPriceMinorE2, currency: lc.offer.currency, unit: lc.unit };
      priceBasis = "accepted";
      if (pd === "factory_plus_fee" && lc.offer.acceptedFeeMinor != null) fee = { minor: lc.offer.acceptedFeeMinor, currency: lc.offer.currency };
    } else if (lc.offer && lc.offer.status === "sent") {
      const opts = openOffers.filter((o) => o.lineId === lc.id && o.status === "sent");
      const priced = opts.map((o) => ({ o, e2: unitPriceAtQty(o.breaks, lc.qty) })).filter((x): x is { o: (typeof opts)[number]; e2: number } => x.e2 != null).sort((a, b) => a.e2 - b.e2);
      if (priced[0]) {
        price = { minorE2: priced[0].e2, currency: priced[0].o.currency, unit: lc.unit };
        priceBasis = "offered";
        if (priced[0].o.pricingDisplay === "factory_plus_fee") fee = { minor: priced[0].o.fee, currency: priced[0].o.currency };
        incoterm = incoterm ?? priced[0].o.incoterm; port = port ?? priced[0].o.port;
      }
    }
    if (!incoterm) { const o = openOffers.find((x) => x.lineId === lc.id); incoterm = o?.incoterm ?? null; port = port ?? o?.port ?? null; }

    return ClientProductRowDto.parse({
      id: lc.id, ref: lc.ref, href: lc.order ? `/app/orders/${lc.order.ref}` : `/app/lines/${lc.ref}`, name: lc.name,
      image: thumbs.get(lc.id) ?? ls.map((l) => thumbs.get(l.id)).find(Boolean) ?? null, linkDomain: linkDomain(lc.links),
      qty: lc.qty, unit: lc.unit, state: lc.state, milestone: lc.milestone, milestoneLabel: clientMilestoneLabel(lc.state, lc.milestone),
      exception: lc.exception, waitingReason: clientWaitingReason(lc), offerOutcome: offerOutcomeOf(lc), sourcingProgress: lc.sourcing, etaLabel: etaLabelFor(lc), isRepeat: lc.isRepeat, lastChangeAt: lc.lastStateChangeAt.toISOString(),
      price, priceBasis, fee, incoterm, port,
      orderCount: uniqueOrders.length, lastOrderRef: lastOrder?.ref ?? null, lastOrderedAt: lastOrder ? (lastOrder.at ?? lastOrder.created).toISOString() : null,
      updatedAt: lc.updatedAt.toISOString(),
    });
  });
  rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return ClientProductListDto.parse({ companyLabel: await companyLabel(ctx.orgId), rows });
}

/* ───────────────────────── Orders ───────────────────────── */

const step = (status: ClientOrderStepDto["status"], detail: string | null = null): ClientOrderStepDto => ({ status, detail });

function paymentStep(ps: { status: string; dueOn: string | null; paidAt: Date | null }[], todoDetail: string | null): ClientOrderStepDto {
  if (!ps.length) return step("na");
  if (ps.every((p) => p.status === "paid" || p.status === "waived")) {
    const last = ps.map((p) => p.paidAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
    return step("done", last ? `Paid ${formatDate(last)}` : "Paid");
  }
  const due = ps.find((p) => p.status === "pending" && p.dueOn);
  return due ? step("current", `Due ${formatDate(due.dueOn!)}`) : step("todo", todoDetail);
}

const IDX = (m: string) => (MILESTONES as readonly string[]).indexOf(m);

export async function listClientOrders(ctx: Ctx): Promise<ClientOrderListDto> {
  if (!isClient(ctx)) throw new Forbidden("clients only");
  const db = await getDb();
  const ords = await db.select().from(orders).where(and(eq(orders.orgId, ctx.orgId), isNull(orders.deletedAt))).orderBy(desc(orders.confirmedAt), desc(orders.createdAt));
  if (!ords.length) return ClientOrderListDto.parse({ companyLabel: await companyLabel(ctx.orgId), rows: [] });
  const orderIds = ords.map((o) => o.id);
  const ols = await db.select({ ol: orderLines, name: requestLines.name }).from(orderLines).innerJoin(requestLines, eq(requestLines.id, orderLines.requestLineId)).where(inArray(orderLines.orderId, orderIds)).orderBy(orderLines.lineNo);
  const lineIds = ols.map((r) => r.ol.requestLineId);
  const [lcs, thumbs, pays, arts, invoices] = await Promise.all([
    loadLineContexts(db, { orgId: ctx.orgId, lineIds, includeCancelled: true }),
    lineThumbnails(db, ctx.orgId, lineIds),
    db.select().from(payments).where(and(inArray(payments.orderId, orderIds), isNull(payments.deletedAt))),
    ols.length ? db.select().from(artworks).where(and(inArray(artworks.orderLineId, ols.map((r) => r.ol.id)), isNull(artworks.deletedAt))).orderBy(desc(artworks.version)) : Promise.resolve([]),
    db.select({ d: documents, f: files }).from(documents).innerJoin(files, eq(files.id, documents.fileId))
      .where(and(eq(documents.orgId, ctx.orgId), eq(documents.entityType, "order"), inArray(documents.entityId, orderIds), eq(documents.visibility, "client"), inArray(documents.kind, ["invoice", "pi"]), isNull(documents.deletedAt)))
      .orderBy(desc(documents.createdAt)),
  ]);

  const rows = ords.map((o) => {
    const mine = ols.filter((r) => r.ol.orderId === o.id);
    const lc = lcs.find((l) => l.order?.id === o.id) ?? null;
    const p = pays.filter((x) => x.orderId === o.id);
    const m = IDX(o.milestone);
    const cancelled = o.exception === "cancelled";

    // artwork: n/a when no line needs it; ✓ when every required line has an approved version
    const required = mine.filter((r) => r.ol.artworkRequired);
    const latest = required.map((r) => arts.find((a) => a.orderLineId === r.ol.id) ?? null);
    const artwork = !required.length ? step("na")
      : latest.every((a) => a?.status === "approved") ? step("done", "Approved")
      : latest.some((a) => a?.status === "changes_requested") ? step("current", "Changes requested")
      : latest.some((a) => a) ? step("current", "In review") : step("todo", "Upload needed");

    const exw = lc?.order?.exworksEta ?? null;
    const production = m > IDX("in_production") ? step("done", "Finished") : m === IDX("in_production") ? step("current", exw ? `ETA ${formatDate(exw)}` : "In production") : step("todo", exw ? `ETA ${formatDate(exw)}` : null);
    const etaPort = lc?.order?.etaPort ?? null;
    const shipping = m > IDX("shipping") ? step("done", o.deliveredAt ? `Delivered ${formatDate(o.deliveredAt)}` : "Delivered") : m === IDX("shipping") ? step("current", etaPort ? `ETA ${formatDate(etaPort)}` : "On the way") : step("todo", etaPort ? `ETA ${formatDate(etaPort)}` : null);

    const inv = invoices.find((x) => x.d.entityId === o.id && x.d.kind === "invoice" && x.f.storageKey.split("/")[4] === "client")
      ?? invoices.find((x) => x.d.entityId === o.id && x.f.storageKey.split("/")[4] === "client") ?? null;

    return ClientOrderRowDto.parse({
      id: o.id, ref: o.ref, href: `/app/orders/${o.ref}`, placedAt: (o.confirmedAt ?? o.createdAt).toISOString(),
      items: mine.map((r) => ({ name: r.name, image: thumbs.get(r.ol.requestLineId) ?? null, qty: r.ol.qty, unit: r.ol.unit })),
      total: { minor: o.totalMinor, currency: o.currency },
      milestone: o.milestone, milestoneLabel: clientMilestoneLabel(o.state, o.milestone),
      exception: o.exception, waitingReason: lc ? clientWaitingReason(lc) : null, etaLabel: lc ? etaLabelFor(lc) : null,
      steps: cancelled
        ? { deposit: step("na"), artwork: step("na"), production: step("na"), shipping: step("na"), balance: step("na"), commission: step("na") }
        : {
          deposit: paymentStep(p.filter((x) => x.kind === "deposit"), isBeforeOrder(o.state) ? null : "Not invoiced yet"),
          artwork, production, shipping,
          balance: paymentStep(p.filter((x) => x.kind === "balance"), "On QC pass"),
          commission: paymentStep(p.filter((x) => x.kind === "fee"), null),
        },
      invoice: inv ? ClientDocumentDto.parse({ id: inv.d.id, filename: inv.d.filename, kind: inv.d.kind, bytes: inv.f.bytes, uploadedAt: inv.d.createdAt.toISOString(), downloadUrl: clientDownloadUrl(inv.f.storageKey, inv.d.filename) }) : null,
      deliveredOn: o.deliveredAt ? o.deliveredAt.toISOString().slice(0, 10) : null,
    });
  });
  return ClientOrderListDto.parse({ companyLabel: await companyLabel(ctx.orgId), rows });
}

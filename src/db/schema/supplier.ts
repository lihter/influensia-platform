/**
 * `supplier` schema — never imported by src/server/client/** or src/app/(client)/** (ESLint boundary, mechanism 1).
 * Cross-schema FKs to app.* are fine on both drivers (verified in the spike).
 */
import { pgSchema, text, timestamp, integer, uuid, boolean, jsonb, date, index, real } from "drizzle-orm/pg-core";
import { requestLines, organizations, orders } from "./app";
import { SUPPLIER_TYPE_VERDICTS, VERDICT_SOURCES, SUPPLIER_GRADES, CONTACT_CHANNELS, PARTICIPATION_STATUSES, PO_STATUSES } from "../enums";

export const supplier = pgSchema("supplier");

export const suppliers = supplier.table("suppliers", {
  id: uuid("id").primaryKey(),
  ref: text("ref").notNull().unique(), // SUP-0007
  legalName: text("legal_name").notNull(),
  normalisedName: text("normalised_name").notNull(),
  cnName: text("cn_name"),
  typeVerdict: text("type_verdict", { enum: SUPPLIER_TYPE_VERDICTS }).notNull().default("unchecked"),
  verdictSource: text("verdict_source", { enum: VERDICT_SOURCES }),
  verdictCheckedAt: timestamp("verdict_checked_at", { withTimezone: true }),
  grade: text("grade", { enum: SUPPLIER_GRADES }),
  uscc: text("uscc"),
  registeredAt: date("registered_at"),
  capital: text("capital"),
  city: text("city"),
  province: text("province"),
  country: text("country").notNull().default("CN"),
  ports: jsonb("ports").$type<string[]>().notNull().default([]),
  website: text("website"),
  notes: text("notes"),
  disclosedToOrgIds: jsonb("disclosed_to_org_ids").$type<string[]>().notNull().default([]),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [index("suppliers_normalised_idx").on(t.normalisedName)]);

export const supplierContacts = supplier.table("supplier_contacts", {
  id: uuid("id").primaryKey(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  name: text("name"),
  channel: text("channel", { enum: CONTACT_CHANNELS }).notNull(),
  handle: text("handle"),
  phone: text("phone"),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/** The sourcing-board row: one supplier working one line. */
export const supplierParticipations = supplier.table("supplier_participations", {
  id: uuid("id").primaryKey(),
  requestLineId: uuid("request_line_id").notNull().references(() => requestLines.id),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  contactId: uuid("contact_id").references(() => supplierContacts.id),
  status: text("status", { enum: PARTICIPATION_STATUSES }).notNull().default("contacted"),
  reason: text("reason"),
  notes: text("notes"),
  firstContactAt: timestamp("first_contact_at", { withTimezone: true }),
  lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [index("participations_line_idx").on(t.requestLineId), index("participations_supplier_idx").on(t.supplierId)]);

export const quotes = supplier.table("quotes", {
  id: uuid("id").primaryKey(),
  participationId: uuid("participation_id").notNull().references(() => supplierParticipations.id),
  version: integer("version").notNull().default(1),
  currency: text("currency").notNull().default("USD"),
  unit: text("unit").notNull().default("pcs"),
  packQty: integer("pack_qty"), // per-bag quotes: unit=bag, packQty=100
  incoterm: text("incoterm"),
  incotermUncertain: boolean("incoterm_uncertain").notNull().default(false),
  port: text("port"),
  moq: integer("moq"),
  leadDays: integer("lead_days"),
  leadDaysMax: integer("lead_days_max"),
  validUntil: date("valid_until"),
  paymentTerms: text("payment_terms"),
  deviations: text("deviations"),
  unitWeightG: real("unit_weight_g"),
  carton: text("carton"),
  sourceDocumentId: uuid("source_document_id"),
  normalisedUsdMinorE2: integer("normalised_usd_minor_e2"),
  fxRate: real("fx_rate"),
  fxDate: date("fx_date"),
  flags: jsonb("flags").$type<string[]>().notNull().default([]),
  notes: text("notes"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("quotes_participation_idx").on(t.participationId)]);

export const quotePriceBreaks = supplier.table("quote_price_breaks", {
  id: uuid("id").primaryKey(),
  quoteId: uuid("quote_id").notNull().references(() => quotes.id),
  minQty: integer("min_qty").notNull(),
  unitPriceMinorE2: integer("unit_price_minor_e2").notNull(), // in quote currency, per quote unit
});

export const supplierPriceLists = supplier.table("supplier_price_lists", {
  id: uuid("id").primaryKey(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  documentId: uuid("document_id"),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  validUntil: date("valid_until"),
  currency: text("currency").default("USD"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const supplierCatalogues = supplier.table("supplier_catalogues", {
  id: uuid("id").primaryKey(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  documentId: uuid("document_id"),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  validUntil: date("valid_until"),
  currency: text("currency").default("USD"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const supplierPerformance = supplier.table("supplier_performance", {
  supplierId: uuid("supplier_id").primaryKey().references(() => suppliers.id),
  ordersCount: integer("orders_count").notNull().default(0),
  onTimeRate: real("on_time_rate"),
  defectRate: real("defect_rate"),
  quoteAccuracy: real("quote_accuracy"),
  lastOrderAt: timestamp("last_order_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseOrders = supplier.table("purchase_orders", {
  id: uuid("id").primaryKey(),
  ref: text("ref").notNull().unique(), // PO-2026-0312-01
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  factoryTotalMinor: integer("factory_total_minor").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  terms: text("terms"),
  exworksEta: date("exworks_eta"),
  status: text("status", { enum: PO_STATUSES }).notNull().default("draft"),
  documentId: uuid("document_id"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

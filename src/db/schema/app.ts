/**
 * `app` schema — every tenant table (blueprint §06 + SPEC Appendix A).
 * Conventions (ARCHITECTURE §4.2): uuid PKs (UUIDv7), `org_id` on tenant rows, `created_by`/`actor_id`/`user_id` are TEXT
 * (Better Auth ids), timestamptz, soft delete via `deleted_at`, money as integer minor units + currency,
 * unit prices as `*_minor_e2` (minor units × 100, i.e. 1/10,000 of a dollar) so sub-cent quotes stay exact.
 * Server-only ids (participation/po/supplier) are plain uuid columns WITHOUT a cross-schema FK (avoids an import cycle)
 * and are branded `ServerOnly<string>` so they cannot land in a client DTO.
 */
import { pgSchema, text, timestamp, integer, jsonb, uuid, boolean, primaryKey, date, index, uniqueIndex, real } from "drizzle-orm/pg-core";
import {
  ORG_TYPES, COMMERCIAL_MODES, PRICING_DISPLAYS, REQUEST_SOURCES, REQUEST_STATUSES, LINE_STATES, MILESTONES, LINE_EXCEPTIONS,
  OFFER_STATUSES, SAMPLE_STATUSES, SAMPLE_PAID_BY, PAYMENT_KINDS, PAYMENT_STATUSES, PAYEES, ARTWORK_STATUSES, INSPECTION_RESULTS,
  SHIPMENT_MODES, FORWARDER_PARTIES, CUSTOMS_STATUSES, PRODUCT_VISIBILITIES, IMAGE_KINDS, DOCUMENT_KINDS, VISIBILITIES,
  COMMENT_SOURCES, COMMENT_KINDS, ACTIVITY_TYPES, OUTBOX_STATUSES, NOTIFICATION_CHANNELS, NOTIFICATION_TEMPLATES, ENTITY_TYPES,
} from "../enums";
import type { CostModel, LinkMeta, PriceBreak, ServerOnly, LeakCheckStored } from "../types";

export const app = pgSchema("app");

const tenantCols = () => ({
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/* ───────────────────────── Tenancy and access ───────────────────────── */

/** Human-readable reference counters: REQ / ORD / PRD / SUP / FACTORY_LABEL / FR. */
export const sequences = app.table("sequences", {
  name: text("name").notNull(),
  year: integer("year").notNull(),
  nextValue: integer("next_value").notNull().default(1),
}, (t) => [primaryKey({ columns: [t.name, t.year] })]);

export const organizations = app.table("organizations", {
  id: uuid("id").primaryKey(),
  type: text("type", { enum: ORG_TYPES }).notNull(),
  name: text("name").notNull(),
  country: text("country"),
  vatId: text("vat_id"),
  language: text("language").notNull().default("en"),
  currencyDisplay: text("currency_display").notNull().default("USD"),
  defaultIncoterm: text("default_incoterm").notNull().default("FOB"),
  commercialMode: text("commercial_mode", { enum: COMMERCIAL_MODES }).notNull().default("agency_passthrough"),
  pricingDisplay: text("pricing_display", { enum: PRICING_DISPLAYS }).notNull().default("factory_plus_fee"),
  depositPct: integer("deposit_pct").notNull().default(30),
  timezone: text("timezone").notNull().default("Europe/Warsaw"),
  partnerOrgId: uuid("partner_org_id"),
  authOrgId: text("auth_org_id").unique(), // Better Auth organization.id
  ...tenantCols(),
});

/** App-side user profile. `id` = Better Auth user.id. Roles live on Better Auth `member.role` only. */
export const users = app.table("users", {
  id: text("id").primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  inviteTokenHash: text("invite_token_hash"),
  inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
  passwordSetAt: timestamp("password_set_at", { withTimezone: true }),
  ...tenantCols(),
});

export const apiKeys = app.table("api_keys", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  ...tenantCols(),
});

/* ───────────────────────── Products ───────────────────────── */

export const products = app.table("products", {
  id: uuid("id").primaryKey(),
  ref: text("ref").notNull().unique(),
  ownerOrgId: uuid("owner_org_id").references(() => organizations.id),
  name: text("name").notNull(),
  category: text("category"),
  description: text("description"),
  hsCode: text("hs_code"),
  unit: text("unit").notNull().default("pcs"),
  visibility: text("visibility", { enum: PRODUCT_VISIBILITIES }).notNull().default("private"),
  referencePriceMinorE2: integer("reference_price_minor_e2"),
  referenceCurrency: text("reference_currency").default("USD"),
  referenceMoq: integer("reference_moq"),
  referenceIncoterm: text("reference_incoterm"),
  referencePort: text("reference_port"),
  referenceSpecVersion: integer("reference_spec_version"),
  referenceValidUntil: date("reference_valid_until"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  ...tenantCols(),
});

export const productSpecs = app.table("product_specs", {
  id: uuid("id").primaryKey(),
  productId: uuid("product_id").notNull().references(() => products.id),
  version: integer("version").notNull(),
  fields: jsonb("fields").$type<Record<string, string | number | boolean>>().notNull().default({}),
  frozenAt: timestamp("frozen_at", { withTimezone: true }),
  frozenBy: text("frozen_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("product_specs_product_version_uidx").on(t.productId, t.version)]);

export const productImages = app.table("product_images", {
  id: uuid("id").primaryKey(),
  productId: uuid("product_id").notNull().references(() => products.id),
  fileId: uuid("file_id").notNull(),
  kind: text("kind", { enum: IMAGE_KINDS }).notNull(),
  approvedBy: text("approved_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ───────────────────────── Requests and sourcing ───────────────────────── */

export const requests = app.table("requests", {
  id: uuid("id").primaryKey(),
  ref: text("ref").notNull().unique(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  source: text("source", { enum: REQUEST_SOURCES }).notNull().default("portal"),
  status: text("status", { enum: REQUEST_STATUSES }).notNull().default("draft"),
  clientRef: text("client_ref"),
  note: text("note"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  targetDelivery: date("target_delivery"),
  destination: text("destination"),
  incotermWanted: text("incoterm_wanted"),
  ...tenantCols(),
}, (t) => [index("requests_org_idx").on(t.orgId)]);

export const requestLines = app.table("request_lines", {
  id: uuid("id").primaryKey(),
  requestId: uuid("request_id").notNull().references(() => requests.id),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  lineNo: integer("line_no").notNull(),
  lineRef: text("line_ref").notNull().unique(), // REQ-2026-0312-01
  productId: uuid("product_id").references(() => products.id),
  name: text("name").notNull(),
  qtyFirst: integer("qty_first"),
  unit: text("unit").notNull().default("pcs"),
  reorderInterval: text("reorder_interval"),
  volume12m: integer("volume_12m"),
  customisation: text("customisation"),
  materials: text("materials"),
  clientSku: text("client_sku"),
  clientLinks: jsonb("client_links").$type<string[]>().notNull().default([]),
  linksMeta: jsonb("links_meta").$type<LinkMeta[]>().notNull().default([]),
  state: text("state", { enum: LINE_STATES }).notNull().default("draft"),
  milestone: text("milestone", { enum: MILESTONES }).notNull().default("received"),
  exception: text("exception", { enum: LINE_EXCEPTIONS }),
  exceptionReason: text("exception_reason"),
  specVersion: integer("spec_version"),
  costModel: jsonb("cost_model").$type<CostModel>(),
  upliftPct: real("uplift_pct"),
  targetPriceMinorE2: integer("target_price_minor_e2"),
  targetConfirmedBy: text("target_confirmed_by"),
  targetConfirmedAt: timestamp("target_confirmed_at", { withTimezone: true }),
  assignedAgentId: text("assigned_agent_id"),
  selectedParticipationId: uuid("selected_participation_id").$type<ServerOnly<string>>(),
  backupParticipationId: uuid("backup_participation_id").$type<ServerOnly<string>>(),
  artworkRequired: boolean("artwork_required").notNull().default(false),
  sampleRequired: boolean("sample_required").notNull().default(true),
  isRepeat: boolean("is_repeat").notNull().default(false),
  fromCatalog: boolean("from_catalog").notNull().default(false),
  fromRangeId: uuid("from_range_id"),
  cancelReason: text("cancel_reason"),
  staleSince: timestamp("stale_since", { withTimezone: true }),
  lastStateChangeAt: timestamp("last_state_change_at", { withTimezone: true }).notNull().defaultNow(),
  ...tenantCols(),
}, (t) => [index("request_lines_org_idx").on(t.orgId), index("request_lines_request_idx").on(t.requestId), index("request_lines_state_idx").on(t.state)]);

export const rfqs = app.table("rfqs", {
  id: uuid("id").primaryKey(),
  requestId: uuid("request_id").notNull().references(() => requests.id),
  requestLineId: uuid("request_line_id").references(() => requestLines.id),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  version: integer("version").notNull().default(1),
  fileId: uuid("file_id"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  recipientsCount: integer("recipients_count").notNull().default(0),
  ...tenantCols(),
});

/* ───────────────────────── Offers, samples, factory ranges ───────────────────────── */

export const offers = app.table("offers", {
  id: uuid("id").primaryKey(),
  ref: text("ref").notNull().unique(), // OFR-2026-0312-01-v1
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  requestLineId: uuid("request_line_id").notNull().references(() => requestLines.id),
  version: integer("version").notNull().default(1),
  status: text("status", { enum: OFFER_STATUSES }).notNull().default("draft"),
  pricingDisplay: text("pricing_display", { enum: PRICING_DISPLAYS }).notNull().default("factory_plus_fee"),
  currency: text("currency").notNull().default("USD"),
  incoterm: text("incoterm"),
  port: text("port"),
  noteToClient: text("note_to_client"),
  validUntil: date("valid_until"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decidedBy: text("decided_by"),
  acceptedOptionId: uuid("accepted_option_id"),
  declineReason: text("decline_reason"),
  changesText: text("changes_text"),
  ...tenantCols(),
}, (t) => [index("offers_line_idx").on(t.requestLineId)]);

export const offerOptions = app.table("offer_options", {
  id: uuid("id").primaryKey(),
  offerId: uuid("offer_id").notNull().references(() => offers.id),
  label: text("label", { enum: ["A", "B", "C"] }).notNull(),
  participationId: uuid("participation_id").$type<ServerOnly<string>>(),
  unit: text("unit").notNull().default("pcs"),
  moq: integer("moq"),
  leadDays: integer("lead_days"),
  priceBreaks: jsonb("price_breaks").$type<PriceBreak[]>().notNull().default([]),
  feeMinor: integer("fee_minor").notNull().default(0), // flat per order
  factoryPriceMinorE2: integer("factory_price_minor_e2"), // ops-only: per unit at line qty
  deviationsPlain: text("deviations_plain"),
  sampleCostMinor: integer("sample_cost_minor"),
  samplePaidBy: text("sample_paid_by", { enum: SAMPLE_PAID_BY }),
  sampleRequired: boolean("sample_required").notNull().default(true),
  paymentTermsClient: text("payment_terms_client"),
  marginRuleId: uuid("margin_rule_id"),
  internalNote: text("internal_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const samples = app.table("samples", {
  id: uuid("id").primaryKey(),
  ref: text("ref").notNull().unique(), // SMP-2026-0312-01-1
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  requestLineId: uuid("request_line_id").references(() => requestLines.id),
  orderId: uuid("order_id"),
  participationId: uuid("participation_id").$type<ServerOnly<string>>(),
  status: text("status", { enum: SAMPLE_STATUSES }).notNull().default("ordered"),
  costMinor: integer("cost_minor"),
  currency: text("currency").notNull().default("USD"),
  paidBy: text("paid_by", { enum: SAMPLE_PAID_BY }),
  courier: text("courier"),
  tracking: text("tracking"),
  orderedAt: timestamp("ordered_at", { withTimezone: true }),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decidedBy: text("decided_by"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectReason: text("reject_reason"),
  deviationsVsSpec: text("deviations_vs_spec"),
  ...tenantCols(),
});

export const factoryRanges = app.table("factory_ranges", {
  id: uuid("id").primaryKey(),
  ref: text("ref").notNull().unique(), // FR-0001
  orgId: uuid("org_id").notNull().references(() => organizations.id), // the client it is shown to
  supplierId: uuid("supplier_id").$type<ServerOnly<string>>().notNull(),
  label: text("label"), // "F-0042", assigned at first publish, never changed
  displayName: text("display_name"), // client-facing catalogue name ("Oil filters"); leak-checked on publish
  pdfSourceFileId: uuid("pdf_source_file_id"),
  pdfFileId: uuid("pdf_file_id"),
  approvedBy: text("approved_by"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  leakCheckResult: jsonb("leak_check_result").$type<LeakCheckStored>(),
  ...tenantCols(),
});

export const factoryRangeItems = app.table("factory_range_items", {
  id: uuid("id").primaryKey(),
  rangeId: uuid("range_id").notNull().references(() => factoryRanges.id),
  productId: uuid("product_id").references(() => products.id),
  name: text("name").notNull(),
  cleanImageFileId: uuid("clean_image_file_id"),
  moq: integer("moq"),
  priceMinorE2: integer("price_minor_e2"),
  currency: text("currency").notNull().default("USD"),
  unit: text("unit").notNull().default("pcs"),
  madeHere: boolean("made_here"), // null = unknown
  note: text("note"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ───────────────────────── Orders and execution ───────────────────────── */

export const orders = app.table("orders", {
  id: uuid("id").primaryKey(),
  ref: text("ref").notNull().unique(), // ORD-2026-0312
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  requestId: uuid("request_id").notNull().references(() => requests.id),
  offerId: uuid("offer_id").references(() => offers.id),
  commercialMode: text("commercial_mode", { enum: COMMERCIAL_MODES }).notNull(),
  pricingDisplay: text("pricing_display", { enum: PRICING_DISPLAYS }).notNull(),
  incoterm: text("incoterm"),
  port: text("port"),
  piNumber: text("pi_number"),
  state: text("state", { enum: LINE_STATES }).notNull().default("order_confirmed"),
  milestone: text("milestone", { enum: MILESTONES }).notNull().default("order_confirmed"),
  exception: text("exception", { enum: LINE_EXCEPTIONS }),
  exceptionReason: text("exception_reason"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  totalMinor: integer("total_minor").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  depositPct: integer("deposit_pct").notNull().default(30),
  assignedAgentId: text("assigned_agent_id"),
  staleSince: timestamp("stale_since", { withTimezone: true }),
  lastStateChangeAt: timestamp("last_state_change_at", { withTimezone: true }).notNull().defaultNow(),
  ...tenantCols(),
}, (t) => [index("orders_org_idx").on(t.orgId)]);

export const orderLines = app.table("order_lines", {
  id: uuid("id").primaryKey(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  requestLineId: uuid("request_line_id").notNull().references(() => requestLines.id),
  productId: uuid("product_id").references(() => products.id),
  specVersion: integer("spec_version"),
  lineNo: integer("line_no").notNull().default(1),
  qty: integer("qty").notNull(),
  unit: text("unit").notNull().default("pcs"),
  unitPriceMinorE2: integer("unit_price_minor_e2").notNull(),
  feeMinor: integer("fee_minor").notNull().default(0),
  factoryUnitPriceMinorE2: integer("factory_unit_price_minor_e2"),
  participationId: uuid("participation_id").$type<ServerOnly<string>>(),
  poId: uuid("po_id").$type<ServerOnly<string>>(),
  artworkRequired: boolean("artwork_required").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payments = app.table("payments", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  orderId: uuid("order_id").references(() => orders.id),
  requestLineId: uuid("request_line_id").references(() => requestLines.id), // sample payments before an order exists
  kind: text("kind", { enum: PAYMENT_KINDS }).notNull(),
  pct: integer("pct"),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull().default("USD"),
  payee: text("payee", { enum: PAYEES }).notNull().default("agency"),
  status: text("status", { enum: PAYMENT_STATUSES }).notNull().default("pending"),
  dueOn: date("due_on"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  reference: text("reference"),
  recordedBy: text("recorded_by"),
  ...tenantCols(),
});

export const artworks = app.table("artworks", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  orderLineId: uuid("order_line_id").notNull().references(() => orderLines.id),
  version: integer("version").notNull().default(1),
  fileId: uuid("file_id"),
  dielineFileId: uuid("dieline_file_id"),
  status: text("status", { enum: ARTWORK_STATUSES }).notNull().default("submitted"),
  clientNote: text("client_note"),
  internalNote: text("internal_note"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decidedBy: text("decided_by"),
  approvedBy: text("approved_by"),
  ...tenantCols(),
});

export const inspections = app.table("inspections", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  poId: uuid("po_id").$type<ServerOnly<string>>(),
  inspector: text("inspector"),
  scheduledFor: date("scheduled_for"),
  inspectedAt: timestamp("inspected_at", { withTimezone: true }),
  aql: text("aql"),
  sampleSize: integer("sample_size"),
  result: text("result", { enum: INSPECTION_RESULTS }),
  defectsNote: text("defects_note"),
  reportDocumentId: uuid("report_document_id"),
  visibleToClient: boolean("visible_to_client").notNull().default(false),
  ...tenantCols(),
});

export const shipments = app.table("shipments", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  forwarder: text("forwarder"),
  forwarderParty: text("forwarder_party", { enum: FORWARDER_PARTIES }),
  forwarderContact: text("forwarder_contact"),
  bookingRef: text("booking_ref"),
  factoryPickupAddress: text("factory_pickup_address"),
  mode: text("mode", { enum: SHIPMENT_MODES }),
  containerOrAwb: text("container_or_awb"),
  blDocumentId: uuid("bl_document_id"),
  packingListDocumentId: uuid("packing_list_document_id"),
  cargoReady: date("cargo_ready"),
  exworksShippedAt: timestamp("exworks_shipped_at", { withTimezone: true }),
  etd: date("etd"),
  etaPort: date("eta_port"),
  portOfDischarge: text("port_of_discharge"),
  arrivedPortAt: timestamp("arrived_port_at", { withTimezone: true }),
  customsStatus: text("customs_status", { enum: CUSTOMS_STATUSES }).notNull().default("not_started"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  ...tenantCols(),
});

/* ───────────────────────── Files, communication, audit, rules ───────────────────────── */

export const files = app.table("files", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  storageKey: text("storage_key").notNull().unique(),
  mime: text("mime").notNull(),
  bytes: integer("bytes").notNull(),
  sha256: text("sha256").notNull(),
  originalName: text("original_name").notNull(),
  exifStripped: boolean("exif_stripped").notNull().default(false),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documents = app.table("documents", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  entityType: text("entity_type", { enum: ENTITY_TYPES }).notNull(),
  entityId: uuid("entity_id").notNull(),
  fileId: uuid("file_id").notNull().references(() => files.id),
  filename: text("filename").notNull(),
  kind: text("kind", { enum: DOCUMENT_KINDS }).notNull(),
  visibility: text("visibility", { enum: VISIBILITIES }).notNull().default("internal"),
  uploadedBy: text("uploaded_by"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedBy: text("published_by"),
  leakCheckResult: jsonb("leak_check_result").$type<LeakCheckStored>(),
  ...tenantCols(),
}, (t) => [index("documents_entity_idx").on(t.entityType, t.entityId)]);

export const comments = app.table("comments", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  entityType: text("entity_type", { enum: ENTITY_TYPES }).notNull(),
  entityId: uuid("entity_id").notNull(),
  authorId: text("author_id"),
  authorName: text("author_name"),
  body: text("body").notNull(),
  kind: text("kind", { enum: COMMENT_KINDS }).notNull().default("update"),
  visibility: text("visibility", { enum: VISIBILITIES }).notNull().default("internal"),
  source: text("source", { enum: COMMENT_SOURCES }).notNull().default("app"),
  counterparty: text("counterparty"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  attachments: jsonb("attachments").$type<string[]>().notNull().default([]), // document ids
  ...tenantCols(),
}, (t) => [index("comments_entity_idx").on(t.entityType, t.entityId)]);

export const activityEvents = app.table("activity_events", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  entityType: text("entity_type", { enum: ENTITY_TYPES }).notNull(),
  entityId: uuid("entity_id").notNull(),
  actorId: text("actor_id"),
  actorName: text("actor_name"),
  type: text("type", { enum: ACTIVITY_TYPES }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  visibility: text("visibility", { enum: VISIBILITIES }).notNull().default("internal"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("activity_entity_idx").on(t.entityType, t.entityId), index("activity_org_idx").on(t.orgId)]);

export const notificationOutbox = app.table("notification_outbox", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull(),
  toEmail: text("to_email"),
  channel: text("channel", { enum: NOTIFICATION_CHANNELS }).notNull().default("email"),
  template: text("template", { enum: NOTIFICATION_TEMPLATES }).notNull(),
  subject: text("subject"),
  entityRef: text("entity_ref"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  status: text("status", { enum: OUTBOX_STATUSES }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  sendAfter: timestamp("send_after", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("outbox_status_idx").on(t.status, t.sendAfter)]);

export const pricingRules = app.table("pricing_rules", {
  id: uuid("id").primaryKey(),
  scope: text("scope", { enum: ["category", "value_band"] }).notNull().default("category"),
  category: text("category").notNull().unique(),
  minValueMinor: integer("min_value_minor"),
  marginPct: real("margin_pct").notNull(),
  feePct: real("fee_pct").notNull(),
  upliftPct: real("uplift_pct").notNull(),
  rounding: integer("rounding").notNull().default(2), // decimals
  ...tenantCols(),
});

export const fxRates = app.table("fx_rates", {
  id: uuid("id").primaryKey(),
  date: date("date").notNull(),
  base: text("base").notNull(),
  quote: text("quote").notNull(),
  rate: real("rate").notNull(),
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("fx_rates_uidx").on(t.date, t.base, t.quote)]);

/**
 * Every enum from SPEC §3.6, verbatim. Stored as `text(col, { enum })` (TS-checked), not pgEnum (ARCHITECTURE §4.2).
 * Import these anywhere (db schema, server modules, UI). Keep this file free of runtime dependencies.
 */

export const ORG_TYPES = ["agency", "client", "partner"] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export const ROLES = ["admin", "agent", "client_owner", "client_member"] as const;
export type Role = (typeof ROLES)[number];

export const COMMERCIAL_MODES = ["principal", "agency_passthrough", "agency_direct"] as const;
export type CommercialMode = (typeof COMMERCIAL_MODES)[number];

export const PRICING_DISPLAYS = ["all_in", "factory_plus_fee"] as const;
export type PricingDisplay = (typeof PRICING_DISPLAYS)[number];

export const REQUEST_SOURCES = ["portal", "import", "agent_on_behalf"] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];

export const REQUEST_STATUSES = ["draft", "submitted", "active", "closed"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** SPEC §3.2 — the 24 internal states, in lane order. */
export const LINE_STATES = [
  "draft", "submitted", "in_review", "spec_frozen", "cost_target_price", "rfq_out", "quotes_in", "shortlisted", "negotiating",
  "offer_ready", "sampling", "offer_accepted",
  "order_confirmed", "awaiting_deposit", "awaiting_artwork", "in_production", "qc_inspection", "awaiting_balance",
  "forwarder_booked", "shipped_exworks", "departed_origin", "eu_port_customs", "delivered", "completed",
] as const;
export type LineState = (typeof LINE_STATES)[number];

/** SPEC §3.3 — the 9 client milestones (D-05). */
export const MILESTONES = ["received", "finding_factory", "price_ready", "sample", "order_confirmed", "in_production", "quality_check", "shipping", "delivered"] as const;
export type Milestone = (typeof MILESTONES)[number];

export const LINE_EXCEPTIONS = ["needs_input", "change_requested", "sample_rejected", "quote_expired", "qc_failed", "on_hold", "cancelled"] as const;
export type LineException = (typeof LINE_EXCEPTIONS)[number];

export const PARTICIPATION_STATUSES = ["contacted", "quoted", "shortlisted", "negotiating", "selected", "backup", "dropped", "cannot_make"] as const;
export type ParticipationStatus = (typeof PARTICIPATION_STATUSES)[number];

export const OFFER_STATUSES = ["draft", "sent", "accepted", "changes_requested", "declined", "expired"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const SAMPLE_STATUSES = ["ordered", "shipped", "received", "approved", "rejected"] as const;
export type SampleStatus = (typeof SAMPLE_STATUSES)[number];

export const SAMPLE_PAID_BY = ["client", "agency", "factory"] as const;
export type SamplePaidBy = (typeof SAMPLE_PAID_BY)[number];

export const PAYMENT_KINDS = ["deposit", "fee", "balance", "sample"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const PAYMENT_STATUSES = ["pending", "paid", "waived"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYEES = ["agency", "factory"] as const;
export type Payee = (typeof PAYEES)[number];

export const ARTWORK_STATUSES = ["submitted", "changes_requested", "approved"] as const;
export type ArtworkStatus = (typeof ARTWORK_STATUSES)[number];

export const PO_STATUSES = ["draft", "issued", "in_production", "completed", "cancelled"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const INSPECTION_RESULTS = ["pass", "fail", "rework"] as const;
export type InspectionResult = (typeof INSPECTION_RESULTS)[number];

export const SHIPMENT_MODES = ["sea", "air", "rail"] as const;
export type ShipmentMode = (typeof SHIPMENT_MODES)[number];

export const FORWARDER_PARTIES = ["client", "agency", "supplier"] as const;
export type ForwarderParty = (typeof FORWARDER_PARTIES)[number];

export const CUSTOMS_STATUSES = ["not_started", "in_progress", "cleared", "held"] as const;
export type CustomsStatus = (typeof CUSTOMS_STATUSES)[number];

export const PRODUCT_VISIBILITIES = ["private", "catalog", "proposed"] as const;
export type ProductVisibility = (typeof PRODUCT_VISIBILITIES)[number];

export const IMAGE_KINDS = ["client_reference", "supplier_facing", "clean"] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

export const SUPPLIER_TYPE_VERDICTS = ["manufacturer", "trading", "hybrid", "unknown", "unchecked"] as const;
export type SupplierTypeVerdict = (typeof SUPPLIER_TYPE_VERDICTS)[number];

export const VERDICT_SOURCES = ["baidu", "qcc", "alibaba_profile", "site_visit", "sheet_import", "other"] as const;
export type VerdictSource = (typeof VERDICT_SOURCES)[number];

export const SUPPLIER_GRADES = ["A", "B", "C", "D", "E"] as const;
export type SupplierGrade = (typeof SUPPLIER_GRADES)[number];

/** TS identifier for `1688` is `p1688` in code; the stored string is `1688`. */
export const CONTACT_CHANNELS = ["alibaba", "1688", "wechat", "email", "global_sources", "web", "whatsapp", "phone"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export const DOCUMENT_KINDS = [
  "pi", "invoice", "qc_report", "bill_of_lading", "packing_list", "certificate", "artwork", "dieline", "reference_image",
  "production_photo", "sample_photo", "price_list", "catalogue", "factory_range_pdf", "comparison", "rfq", "quote_file", "other",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Kinds that inherently name the factory: never publishable (SPEC F-23). */
export const INTERNAL_ONLY_DOCUMENT_KINDS: readonly DocumentKind[] = ["quote_file", "price_list", "catalogue", "comparison", "rfq"];

export const VISIBILITIES = ["client", "internal"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const COMMENT_SOURCES = ["app", "whatsapp_log", "email"] as const;
export type CommentSource = (typeof COMMENT_SOURCES)[number];

export const COMMENT_KINDS = ["update", "question", "answer", "note", "change_request", "decline_reason", "reject_reason"] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

export const ACTIVITY_TYPES = [
  "request_submitted", "line_created", "line_updated", "line_assigned", "state_changed", "exception_set", "exception_cleared",
  "spec_frozen", "cost_model_saved", "target_confirmed", "rfq_sent", "participation_added", "participation_status_changed",
  "quote_logged", "offer_sent", "offer_decided", "sample_created", "sample_status_changed", "sample_decided", "order_confirmed",
  "payment_recorded", "artwork_submitted", "artwork_decided", "po_updated", "inspection_recorded", "shipment_updated", "eta_changed",
  "document_uploaded", "document_published", "document_unpublished", "leak_check_blocked", "comment_posted", "whatsapp_logged",
  "product_published", "range_published", "range_renamed", "user_invited", "state_overridden", "delivery_confirmed", "reorder_created",
  // admin / master-data events (added in the integration pass)
  "org_updated", "user_deactivated", "user_reactivated", "pricing_rule_saved", "profile_updated",
  "supplier_created", "supplier_updated", "contact_added", "product_updated", "product_unpublished", "image_approved_clean",
  "range_created", "range_item_added", "range_unpublished",
  "product_created", "product_image_added", "product_image_removed", "supplier_deleted", "contact_updated", "contact_removed", "range_item_updated", "range_item_removed",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const OUTBOX_STATUSES = ["pending", "sent", "failed"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ["email"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** SPEC §6 — every notification template (N-01…N-22). */
export const NOTIFICATION_TEMPLATES = [
  "auth_invite", "auth_password_reset",
  "client_request_received", "ops_new_request", "client_milestone_changed", "client_offer_ready", "client_sample_shipped",
  "client_sample_ready", "client_order_confirmed", "client_payment_due", "client_artwork_requested", "client_artwork_changes",
  "client_artwork_approved", "client_qc_result", "client_eta_changed", "client_delivery_confirm", "client_new_update",
  "client_document_published", "client_input_needed", "client_offer_expired", "ops_client_action", "ops_client_question",
  "ops_daily_digest", "ops_leak_blocked",
] as const;
export type NotificationTemplate = (typeof NOTIFICATION_TEMPLATES)[number];

export const ENTITY_TYPES = [
  "organization", "request", "request_line", "product", "offer", "sample", "order", "order_line", "payment", "artwork",
  "purchase_order", "inspection", "shipment", "document", "comment", "factory_range", "supplier", "user",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const PRODUCT_CATEGORIES = ["packaging", "fitness", "garden", "lighting", "safety", "seasonal", "furniture", "tools", "other"] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const UNITS = ["pcs", "set", "pair", "bag", "pack", "m"] as const;

export const INCOTERMS = ["EXW", "FOB", "CIF", "DDP", "DAP"] as const;
export type Incoterm = (typeof INCOTERMS)[number];

export const REORDER_INTERVALS = ["none", "monthly", "quarterly", "yearly"] as const;

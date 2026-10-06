/**
 * ONE human label map for every enum a user can see (FIX_PHASE contract b).
 *
 *   import { label, labelOptions, specKeyLabel, formatBool, humanizeKey } from "@/lib/labels";
 *   label("state", "rfq_out")               // "RFQ out"
 *   label("role", "client_owner")           // "Owner"
 *   label("commercialMode", "agency_passthrough") // "Agency pass-through"
 *   label("boolean", true)                  // "Yes"
 *   label("specKey", "pvc_free")            // "PVC-free"
 *   labelOptions("paymentKind")             // [{ value: "deposit", label: "Deposit" }, …] for <Select>
 *
 * Rules: never render an enum value raw; if a kind or value is missing, `label()` falls back to `humanizeKey()`
 * ("snake_case" → "Snake case") so the screen never shows snake_case — but add the real label here (small append).
 * Words already in messages/en.json (states, milestones, …) are read from it so chips (next-intl) and this map agree.
 * `tests/unit/labels.test.ts` fails when any value of an enum in src/db/enums.ts has no label.
 * Pure module (no React, no server imports): safe in client components, server components, emails and tests.
 */
import en from "../../messages/en.json";
import * as E from "@/db/enums";

type Dict = Record<string, string>;
const M = en as unknown as Record<string, Record<string, unknown>>;
const pick = (o: unknown): Dict => Object.fromEntries(Object.entries((o ?? {}) as Record<string, unknown>).filter(([, v]) => typeof v === "string")) as Dict;

/** `snake_case` / `kebab-case` / `camelCase` → "Sentence case". The last-resort fallback, never the plan. */
export function humanizeKey(key: string): string {
  const s = String(key).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export const formatBool = (v: boolean | null | undefined) => (v === null || v === undefined ? "—" : v ? "Yes" : "No");

/** Spec-field keys (free-form in `spec_version.fields`): the known ones, then humanizeKey. */
export const SPEC_KEY_LABELS: Dict = {
  size: "Size", material: "Material", thickness: "Thickness", finish: "Finish", steel: "Steel", shelves: "Shelves",
  pvc_free: "PVC-free", pack: "Packing", load_per_shelf: "Load per shelf", load_total: "Total load", closure: "Closure",
  uv: "UV resistance", tips: "Tips", style: "Style", standard: "Standard", stand: "Stand", roof: "Roof", pull: "Pull",
  pockets: "Pockets", plug: "Plug", panel: "Panel", palm: "Palm coating", pages: "Pages", modes: "Modes", liner: "Liner",
  length: "Length", leds: "LEDs", ip: "IP rating", height: "Height", width: "Width", depth: "Depth", weight: "Weight",
  door: "Door", carton: "Carton", colour: "Colour", color: "Colour", capacity: "Capacity", voltage: "Voltage",
  power: "Power", certification: "Certification", certifications: "Certifications", hs_code: "HS code", moq: "MOQ",
  print: "Print", printing: "Printing", logo: "Logo", packaging: "Packaging", quantity: "Quantity", dimensions: "Dimensions",
  gsm: "GSM", cable: "Cable", battery: "Battery", plug_type: "Plug type", lead_time: "Lead time", incoterm: "Incoterm",
};

/** Every enum kind → value → label. Keys of this object are the `kind` argument of `label()`. */
export const LABELS = {
  orgType: { agency: "Agency", client: "Client", partner: "Partner" },
  role: pick(M.roles) as Record<E.Role, string>,
  commercialMode: { principal: "Principal", agency_passthrough: "Agency pass-through", agency_direct: "Agency direct" },
  pricingDisplay: { all_in: "All-in price", factory_plus_fee: "Factory + fee" },
  requestSource: { portal: "Portal", import: "Import", agent_on_behalf: "Entered by an agent" },
  requestStatus: { draft: "Draft", submitted: "Submitted", active: "Active", closed: "Closed" },
  state: pick(M.state) as Record<E.LineState, string>,
  milestone: pick(M.milestone) as Record<E.Milestone, string>,
  exception: pick(M.exception) as Record<E.LineException, string>,
  participation: pick(M.participation_status) as Record<E.ParticipationStatus, string>,
  offerStatus: pick(M.offer_status) as Record<E.OfferStatus, string>,
  sampleStatus: pick(M.sample_status) as Record<E.SampleStatus, string>,
  samplePaidBy: { client: "Client", agency: "Influensia", factory: "Factory" },
  paymentKind: pick(M.payment_kind) as Record<E.PaymentKind, string>,
  paymentStatus: pick(M.payment_status) as Record<E.PaymentStatus, string>,
  payee: { agency: "Influensia", factory: "Factory" },
  artworkStatus: { submitted: "Submitted", changes_requested: "Changes requested", approved: "Approved" },
  poStatus: { draft: "Draft", issued: "Issued", in_production: "In production", completed: "Completed", cancelled: "Cancelled" },
  inspectionResult: { pass: "Passed", fail: "Failed", rework: "Rework" },
  /** An inspection with no result yet. Use `label("inspectionResult", null)` → "Not inspected yet". */
  shipmentMode: { sea: "Sea", air: "Air", rail: "Rail" },
  forwarderParty: { client: "Arranged by the client", agency: "Arranged by Influensia", supplier: "Arranged by the factory" },
  customsStatus: { not_started: "Not started", in_progress: "In progress", cleared: "Cleared", held: "Held" },
  productVisibility: { private: "Private", catalog: "In catalog", proposed: "Proposed" },
  imageKind: { client_reference: "Client reference", supplier_facing: "Supplier-facing", clean: "Clean" },
  supplierVerdict: { manufacturer: "Manufacturer", trading: "Trading company", hybrid: "Hybrid", unknown: "Unknown", unchecked: "Not checked" },
  verdictSource: { baidu: "Baidu", qcc: "企查查 (QCC)", alibaba_profile: "Alibaba profile", site_visit: "Site visit", sheet_import: "Sheet import", other: "Other" },
  supplierGrade: { A: "A — verified factory", B: "B — factory, checks pass", C: "C — gaps to verify", D: "D — trader or weak record", E: "E — do not use" },
  channel: { alibaba: "Alibaba", "1688": "1688", wechat: "WeChat", email: "Email", global_sources: "Global Sources", web: "Web", whatsapp: "WhatsApp", phone: "Phone" },
  documentKind: pick(M.document_kind) as Record<E.DocumentKind, string>,
  visibility: pick(M.visibility) as Record<E.Visibility, string>,
  commentSource: { app: "Portal", whatsapp_log: "WhatsApp", email: "Email" },
  commentKind: { update: "Update", question: "Question", answer: "Answer", note: "Internal note", change_request: "Change request", decline_reason: "Decline reason", reject_reason: "Reject reason" },
  activityType: {
    request_submitted: "Request submitted", line_created: "Line added", line_updated: "Line updated", line_assigned: "Line assigned",
    state_changed: "State changed", exception_set: "Flag set", exception_cleared: "Flag cleared", spec_frozen: "Spec frozen",
    cost_model_saved: "Cost model saved", target_confirmed: "Target price confirmed", rfq_sent: "RFQ sent",
    participation_added: "Supplier added", participation_status_changed: "Supplier status changed", quote_logged: "Quote logged",
    offer_sent: "Offer sent", offer_decided: "Offer decided", sample_created: "Sample ordered", sample_status_changed: "Sample updated",
    sample_decided: "Sample decided", order_confirmed: "Order confirmed", payment_recorded: "Payment recorded",
    artwork_submitted: "Artwork submitted", artwork_decided: "Artwork decided", po_updated: "PO updated",
    inspection_recorded: "Inspection recorded", shipment_updated: "Shipment updated", eta_changed: "ETA changed",
    document_uploaded: "Document uploaded", document_published: "Document published", document_unpublished: "Document unpublished",
    leak_check_blocked: "Leak check blocked", comment_posted: "Comment posted", whatsapp_logged: "WhatsApp logged",
    product_published: "Product published", range_published: "Range published", user_invited: "User invited",
    state_overridden: "State overridden", delivery_confirmed: "Delivery confirmed", reorder_created: "Reorder created",
    org_updated: "Client updated", user_deactivated: "User deactivated", user_reactivated: "User reactivated",
    pricing_rule_saved: "Pricing rule saved", profile_updated: "Profile updated", supplier_created: "Supplier created",
    supplier_updated: "Supplier updated", contact_added: "Contact added", product_updated: "Product updated",
    product_unpublished: "Product unpublished", image_approved_clean: "Image approved as clean", range_created: "Range created",
    range_item_added: "Range item added", range_unpublished: "Range unpublished", range_renamed: "Catalogue renamed", product_created: "Product created",
    product_image_added: "Product image added", product_image_removed: "Product image removed", supplier_deleted: "Supplier deleted",
    contact_updated: "Contact updated", contact_removed: "Contact removed", range_item_updated: "Range item updated",
    range_item_removed: "Range item removed",
  },
  outboxStatus: { pending: "Queued", sent: "Sent", failed: "Failed" },
  notificationChannel: { email: "Email" },
  notificationTemplate: {
    auth_invite: "Invitation", auth_password_reset: "Password reset", client_request_received: "Request received",
    ops_new_request: "New request (ops)", client_milestone_changed: "Milestone changed", client_offer_ready: "Price ready",
    client_sample_shipped: "Sample shipped", client_sample_ready: "Sample ready", client_order_confirmed: "Order confirmed",
    client_payment_due: "Payment due", client_artwork_requested: "Artwork requested", client_artwork_changes: "Artwork changes",
    client_artwork_approved: "Artwork approved", client_qc_result: "QC result", client_eta_changed: "ETA changed",
    client_delivery_confirm: "Confirm delivery", client_new_update: "New update", client_document_published: "Document published",
    client_input_needed: "Input needed", client_offer_expired: "Price expired", ops_client_action: "Client action (ops)",
    ops_client_question: "Client question (ops)", ops_daily_digest: "Daily digest (ops)", ops_leak_blocked: "Leak check blocked (ops)",
  },
  entityType: {
    organization: "Client", request: "Request", request_line: "Line", product: "Product", offer: "Offer", sample: "Sample",
    order: "Order", order_line: "Order line", payment: "Payment", artwork: "Artwork", purchase_order: "Purchase order",
    inspection: "Inspection", shipment: "Shipment", document: "Document", comment: "Comment", factory_range: "Factory range",
    supplier: "Supplier", user: "User",
  },
  productCategory: { packaging: "Packaging", fitness: "Fitness", garden: "Garden", lighting: "Lighting", safety: "Safety", seasonal: "Seasonal", furniture: "Furniture", tools: "Tools", other: "Other" },
  unit: { pcs: "pcs", set: "sets", pair: "pairs", bag: "bags", pack: "packs", m: "m" },
  incoterm: { EXW: "EXW", FOB: "FOB", CIF: "CIF", DDP: "DDP", DAP: "DAP" },
  reorderInterval: { none: "No reminder", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" },
  /** Factory range item provenance (range_item.provenance, free text in schema). */
  provenance: { made_here: "Made in-house", sourced_by_them: "Sourced by the factory", unknown: "Unconfirmed", "made here": "Made in-house", "sourced by them": "Sourced by the factory" },
  boolean: { true: "Yes", false: "No" },
  specKey: SPEC_KEY_LABELS,
} as const satisfies Record<string, Dict>;

export type LabelKind = keyof typeof LABELS;

/** Which enum array in src/db/enums.ts each kind covers (the unit test walks this). */
export const ENUM_KIND: Partial<Record<keyof typeof E, LabelKind>> = {
  ORG_TYPES: "orgType", ROLES: "role", COMMERCIAL_MODES: "commercialMode", PRICING_DISPLAYS: "pricingDisplay",
  REQUEST_SOURCES: "requestSource", REQUEST_STATUSES: "requestStatus", LINE_STATES: "state", MILESTONES: "milestone",
  LINE_EXCEPTIONS: "exception", PARTICIPATION_STATUSES: "participation", OFFER_STATUSES: "offerStatus",
  SAMPLE_STATUSES: "sampleStatus", SAMPLE_PAID_BY: "samplePaidBy", PAYMENT_KINDS: "paymentKind", PAYMENT_STATUSES: "paymentStatus",
  PAYEES: "payee", ARTWORK_STATUSES: "artworkStatus", PO_STATUSES: "poStatus", INSPECTION_RESULTS: "inspectionResult",
  SHIPMENT_MODES: "shipmentMode", FORWARDER_PARTIES: "forwarderParty", CUSTOMS_STATUSES: "customsStatus",
  PRODUCT_VISIBILITIES: "productVisibility", IMAGE_KINDS: "imageKind", SUPPLIER_TYPE_VERDICTS: "supplierVerdict",
  VERDICT_SOURCES: "verdictSource", SUPPLIER_GRADES: "supplierGrade", CONTACT_CHANNELS: "channel", DOCUMENT_KINDS: "documentKind",
  INTERNAL_ONLY_DOCUMENT_KINDS: "documentKind", VISIBILITIES: "visibility", COMMENT_SOURCES: "commentSource",
  COMMENT_KINDS: "commentKind", ACTIVITY_TYPES: "activityType", OUTBOX_STATUSES: "outboxStatus",
  NOTIFICATION_CHANNELS: "notificationChannel", NOTIFICATION_TEMPLATES: "notificationTemplate", ENTITY_TYPES: "entityType",
  PRODUCT_CATEGORIES: "productCategory", UNITS: "unit", INCOTERMS: "incoterm", REORDER_INTERVALS: "reorderInterval",
};

/** Empty-value wording per kind (null / undefined). Default is "—". */
const EMPTY: Partial<Record<LabelKind, string>> = { inspectionResult: "Not inspected yet", supplierVerdict: "Not checked", supplierGrade: "Not graded" };

/** The one helper. `label(kind, value)` → human text; unknown values fall back to `humanizeKey`, never raw snake_case. */
export function label(kind: LabelKind, value: string | boolean | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return EMPTY[kind] ?? "—";
  if (kind === "boolean" || typeof value === "boolean") return formatBool(value === true || value === "true");
  const dict = LABELS[kind] as Dict;
  const key = String(value);
  return dict[key] ?? (kind === "incoterm" || kind === "supplierGrade" ? key : humanizeKey(key));
}

/** Spec key → label ("pvc_free" → "PVC-free", "load_total" → "Total load"). */
export const specKeyLabel = (key: string) => SPEC_KEY_LABELS[key] ?? SPEC_KEY_LABELS[key.toLowerCase().replace(/[\s-]+/g, "_")] ?? humanizeKey(key);

/** Spec value for display: booleans (and "true"/"false" strings) → Yes/No, everything else as entered. */
export function specValueLabel(v: unknown): string {
  if (typeof v === "boolean") return formatBool(v);
  if (v === "true" || v === "false") return formatBool(v === "true");
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

/** Options for a Select / radio group, in enum order: `labelOptions("paymentKind")`. Pass `values` to subset/reorder. */
export function labelOptions<K extends LabelKind>(kind: K, values?: readonly string[]): { value: string; label: string }[] {
  return (values ?? Object.keys(LABELS[kind])).map((value) => ({ value, label: label(kind, value) }));
}

/** Plural-aware unit: `unitLabel("pair", 10000)` → "pairs", `unitLabel("pair", 1)` → "pair". */
export function unitLabel(unit: string | null | undefined, qty?: number): string {
  if (!unit) return "";
  const plural = (LABELS.unit as Dict)[unit] ?? unit;
  if (qty === 1) return unit === "pcs" ? "pc" : unit;
  return plural;
}

/** Two-letter initials that ignore "(KOFF)"-style suffixes: "Anna (KOFF)" → "AN", "Piotr Nowak" → "PN". */
export function initials(name: string | null | undefined): string {
  const words = String(name ?? "").replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return (words[0].match(/\p{L}/gu) ?? []).slice(0, 2).join("").toUpperCase() || "?";
  return words.map((p) => p.match(/\p{L}/u)?.[0] ?? "").filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
}

/** Alias of `label` (the name used in UX_REVIEW). */
export const labelFor = label;

/**
 * Ops "Next step" wording for a waiting reason (dashboard, queue): the action, not a repeat of the state chip.
 * Keys are WaitingReason values (waiting-on reasons + line states).
 */
export const NEXT_STEP: Record<string, string> = {
  needs_input: "Waiting for the client's answer", offer_sent: "Client is reviewing the offer", offer_followup: "Follow up on the offer",
  sample_received: "Client is checking the sample", sample_in_progress: "Get the sample to the client", deposit_due: "Chase deposit + fee",
  advance_state: "Move the line to its next step", artwork_due: "Client uploads artwork", artwork_review: "Review the artwork",
  balance_due: "Chase the balance", delivery_confirm: "Client confirms delivery",
  draft: "Client finishes the draft", submitted: "Claim and review", in_review: "Freeze the spec", spec_frozen: "Build the cost model",
  cost_target_price: "Confirm target, send RFQ", rfq_out: "Chase quotes", quotes_in: "Compare and shortlist", shortlisted: "Negotiate",
  negotiating: "Build and send the offer", offer_ready: "Send the offer", sampling: "Run the sample", offer_accepted: "Confirm the order",
  order_confirmed: "Issue the PI", awaiting_deposit: "Chase deposit + fee", awaiting_artwork: "Get artwork approved",
  in_production: "Book the inspection", qc_inspection: "Record the QC result", awaiting_balance: "Chase the balance",
  forwarder_booked: "Hand over to the forwarder", shipped_exworks: "Confirm departure", departed_origin: "Track to EU port",
  eu_port_customs: "Clear customs, deliver", delivered: "Close the order", completed: "Done", none: "—",
};
export const nextStepLabel = (reason: string | null | undefined) => (reason ? NEXT_STEP[reason] ?? humanizeKey(reason) : "—");

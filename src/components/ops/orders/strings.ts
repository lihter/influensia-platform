/** Local strings for the orders feature (ops side). Kept here instead of messages/en.json (foundation-owned file). */

export const ERRORS: Record<string, string> = {
  E_ILLEGAL_TRANSITION: "That step is not allowed from the current state.",
  E_LEAK_CHECK: "Blocked: the text names a supplier.",
  E_KIND_NOT_PUBLISHABLE: "This document kind can never be shared with a client.",
  E_VALIDATION: "Please check the highlighted fields.",
  E_NOT_FOUND: "Not found.",
  E_FORBIDDEN: "You are not allowed to do that.",
  E_UNAUTHORIZED: "Please sign in again.",
  E_BALANCE_NOT_PAID: "Balance not paid — an admin can override with a reason.",
  E_ARTWORK_NOT_APPROVED: "Every line's artwork must be approved first.",
  E_PAYMENTS_PENDING: "Deposit and fee must be paid first.",
  E_ARTWORK_REQUIRED: "This order needs artwork — wait for the client's upload.",
  E_NOTE_REQUIRED: "Add a note (at least 5 characters).",
  E_NO_ELIGIBLE_LINES: "No accepted lines selected.",
  E_NOT_DELIVERED: "The order is not delivered yet.",
  E_NOT_REORDERABLE: "Only delivered orders can be reordered.",
  E_NO_LINES: "Choose at least one line.",
  E_INTERNAL: "Something went wrong.",
};

export const PAYEE: Record<string, string> = { agency: "Influensia", factory: "Factory" };
export const PO_STATUS: Record<string, string> = { draft: "Draft", issued: "Issued", in_production: "In production", completed: "Completed", cancelled: "Cancelled" };
export const INSPECTION_RESULT: Record<string, string> = { pass: "Pass", fail: "Fail", rework: "Rework" };
export const SHIP_MODE: Record<string, string> = { sea: "Sea", air: "Air", rail: "Rail" };
export const FORWARDER_PARTY: Record<string, string> = { client: "Client's forwarder", agency: "Influensia", supplier: "Factory arranges" };
export const CUSTOMS: Record<string, string> = { not_started: "Not started", in_progress: "In progress", cleared: "Cleared", held: "Held" };
export const COMMERCIAL_MODE: Record<string, string> = { principal: "Principal", agency_passthrough: "Agency pass-through", agency_direct: "Agency direct" };
export const PRICING_DISPLAY: Record<string, string> = { all_in: "All-in", factory_plus_fee: "Factory + fee" };
export const ARTWORK_STATUS: Record<string, string> = { submitted: "Submitted", changes_requested: "Changes requested", approved: "Approved" };

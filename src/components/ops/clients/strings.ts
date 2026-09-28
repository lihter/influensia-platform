/** Local strings for the clients admin (messages/en.json is foundation-owned during the feature phase). */
export const COMMERCIAL_MODE_LABEL: Record<string, string> = { principal: "Principal", agency_passthrough: "Agency pass-through", agency_direct: "Agency direct" };
export const PRICING_DISPLAY_LABEL: Record<string, string> = { all_in: "All-in", factory_plus_fee: "Factory + fee" };
export const LANGUAGE_LABEL: Record<string, string> = { en: "English", pl: "Polish", hr: "Croatian", ro: "Romanian", de: "German" };
export const USER_STATUS_LABEL: Record<string, string> = { invited: "Invited", active: "Active", deactivated: "Deactivated" };
export const ROLE_LABEL: Record<string, string> = { admin: "Admin", agent: "Agent", client_owner: "Owner", client_member: "Member" };

export const COMMERCIAL_MODE_OPTIONS = Object.entries(COMMERCIAL_MODE_LABEL).map(([value, label]) => ({ value, label }));
export const PRICING_DISPLAY_OPTIONS = Object.entries(PRICING_DISPLAY_LABEL).map(([value, label]) => ({ value, label }));
export const LANGUAGE_OPTIONS = Object.entries(LANGUAGE_LABEL).map(([value, label]) => ({ value, label }));
export const INCOTERM_OPTIONS = ["EXW", "FOB", "CIF", "DDP", "DAP"].map((v) => ({ value: v, label: v }));
export const TIMEZONE_OPTIONS = ["Europe/Warsaw", "Europe/Zagreb", "Europe/Bucharest", "Europe/Berlin", "Europe/London", "Europe/Paris", "Europe/Madrid", "Europe/Rome", "Europe/Prague", "Europe/Vienna", "Europe/Amsterdam", "Asia/Shanghai"].map((v) => ({ value: v, label: v }));

export const S = {
  eyebrow: "Clients",
  title: "Clients",
  count: (n: number) => `${n} client${n === 1 ? "" : "s"}`,
  newClient: "Client",
  settingsLink: "Pricing rules",
  search: "Search clients…",
  col: { name: "Client", country: "Country", users: "Users", mode: "Mode", display: "Display", language: "Lang", currency: "Cur", incoterm: "Incoterm", openLines: "Active lines", openOrders: "Orders", last: "Last activity", partner: "Partner" },
  empty: { title: "No clients yet", body: "Create the first client account — the invite writes an outbox row you can inspect under Outbox." },
  sheet: {
    title: "New client",
    description: "Creates the client account and invites its first user in one step.",
    submit: "Create & invite",
    org: "Company details",
    user: "First user",
    commercial: "Commercial settings",
    orgName: "Client name",
    country: "Country (ISO-2)",
    vatId: "VAT id",
    userName: "Contact name",
    email: "Email",
    role: "Role",
    roleFixed: "Owner (fixed in v1)",
    commercialMode: "Commercial mode",
    pricingDisplay: "Pricing display",
    incoterm: "Default incoterm",
    language: "Language",
    modeHint: "Affects new offers and orders only.",
  },
  invited: {
    title: "Invite created",
    body: "Local mode — no email was sent. The invite row is in the outbox; hand over the temporary password once. It is not shown again.",
    email: "Email",
    tempPassword: "Temporary password",
    inviteUrl: "Invite link",
    copy: "Copy",
    copied: "Copied",
    open: "Open client",
    done: "Done",
  },
  detail: {
    settings: "Settings",
    edit: "Edit settings",
    save: "Save settings",
    readOnly: "Read-only — settings are edited by an admin.",
    users: "Users",
    addUser: "Invite user",
    resend: "Resend invite",
    deactivate: "Deactivate",
    reactivate: "Reactivate",
    lines: "Lines",
    orders: "Orders",
    forecast: "Forecast accuracy",
    forecastBody: "Promised vs actual lead time per order lands here once the first orders deliver. Nothing to measure yet.",
    activity: "Activity",
    activityEmpty: "No activity yet.",
    lastSeen: "Last seen",
    never: "never",
    expires: "expires",
    linesEmpty: "No lines yet.",
    ordersEmpty: "No orders yet.",
    colUser: { name: "Name", email: "Email", role: "Role", status: "Status", lastSeen: "Last seen" },
    colLine: { ref: "Line", name: "Product", qty: "Qty", state: "State", agent: "Agent", last: "Last" },
    colOrder: { ref: "Order", state: "State", total: "Total", confirmed: "Confirmed", last: "Last" },
  },
  toast: {
    saved: "Settings saved",
    noChange: "Nothing changed",
    deactivated: "User deactivated — sessions revoked",
    reactivated: "User reactivated",
    resent: "Invite resent — new outbox row written",
    created: (name: string) => `Client ${name} created`,
    invited: (email: string) => `Invite created for ${email}`,
  },
  errors: { E_FORBIDDEN: "Admin only", E_VALIDATION: "Check the highlighted fields", E_INTERNAL: "Something went wrong", E_NOT_FOUND: "Not found", E_UNAUTHORIZED: "Sign in again" } as Record<string, string>,
};

export const errorText = (code: string) => S.errors[code] ?? code;

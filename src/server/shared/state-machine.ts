/**
 * SPEC §3 — 24 internal states → 9 client milestones (D-05) and the transition table of §3.4.
 * Pure module (no db). `transition()` in ./transition.ts applies it inside a transaction.
 * The state/milestone strings live in src/db/enums.ts; this module is the source of truth for their semantics.
 */
import { LINE_STATES, MILESTONES, type LineState, type Milestone } from "@/db/enums";

export const STATES = LINE_STATES;
export { MILESTONES };
export type State = LineState;
export type { Milestone };

/** SPEC §3.2 column "Milestone". */
export const MILESTONE_OF: Record<State, Milestone> = {
  draft: "received",
  submitted: "received",
  in_review: "received",
  spec_frozen: "finding_factory",
  cost_target_price: "finding_factory",
  rfq_out: "finding_factory",
  quotes_in: "finding_factory",
  shortlisted: "finding_factory",
  negotiating: "finding_factory",
  offer_ready: "price_ready",
  sampling: "sample",
  offer_accepted: "order_confirmed",
  order_confirmed: "order_confirmed",
  awaiting_deposit: "order_confirmed",
  awaiting_artwork: "order_confirmed",
  in_production: "in_production",
  qc_inspection: "quality_check",
  awaiting_balance: "quality_check",
  forwarder_booked: "shipping",
  shipped_exworks: "shipping",
  departed_origin: "shipping",
  eu_port_customs: "shipping",
  delivered: "delivered",
  completed: "delivered",
};

/** B.1 — throws on unknown state. */
export function milestoneFor(state: string): Milestone {
  const m = MILESTONE_OF[state as State];
  if (!m) throw new Error(`unknown state: ${state}`);
  return m;
}

export const milestoneIndex = (m: Milestone) => MILESTONES.indexOf(m); // 0-based
export const milestoneStep = (m: Milestone) => milestoneIndex(m) + 1; // 1..9 for "7 of 9"

/** Milestones that carry a client action (▲, D-06). */
export const ACTION_MILESTONES: readonly Milestone[] = ["price_ready", "sample", "order_confirmed", "quality_check", "delivered"];
export const isActionMilestone = (m: Milestone) => ACTION_MILESTONES.includes(m);

export type Lane = "sourcing" | "execution";
export const LANE_OF: Record<State, Lane> = Object.fromEntries(
  STATES.map((s, i) => [s, i < STATES.indexOf("order_confirmed") ? "sourcing" : "execution"]),
) as Record<State, Lane>;

/** States a client may still cancel from (before `order_confirmed`, SPEC §1.4 footnote 2). */
export const isBeforeOrder = (s: State) => STATES.indexOf(s) < STATES.indexOf("order_confirmed");
export const isActiveState = (s: State) => s !== "completed";
export const isDeliveredOrCompleted = (s: State) => s === "delivered" || s === "completed";

/**
 * SPEC §3.4 — every legal `from → to` pair (self-transitions are not state changes and are not listed).
 * Admin "Override state" is the only bypass (`transition(..., { override: true })`).
 */
export const TRANSITIONS: Record<State, readonly State[]> = {
  draft: ["submitted"],
  submitted: ["in_review", "spec_frozen"],
  in_review: ["spec_frozen"],
  spec_frozen: ["cost_target_price", "rfq_out"],
  cost_target_price: ["rfq_out"],
  rfq_out: ["quotes_in"],
  quotes_in: ["shortlisted", "negotiating", "offer_ready"],
  shortlisted: ["negotiating", "offer_ready"],
  negotiating: ["offer_ready"],
  offer_ready: ["negotiating", "rfq_out", "shortlisted", "sampling", "offer_accepted"],
  sampling: ["offer_accepted", "negotiating", "shortlisted"],
  offer_accepted: ["sampling", "order_confirmed"],
  order_confirmed: ["awaiting_deposit"],
  awaiting_deposit: ["awaiting_artwork", "in_production"],
  awaiting_artwork: ["in_production"],
  in_production: ["qc_inspection"],
  qc_inspection: ["awaiting_balance", "in_production"],
  awaiting_balance: ["forwarder_booked"],
  forwarder_booked: ["shipped_exworks"],
  shipped_exworks: ["departed_origin"],
  departed_origin: ["eu_port_customs", "delivered"],
  eu_port_customs: ["delivered"],
  delivered: ["completed"],
  completed: [],
};

export class IllegalTransition extends Error {
  code = "E_ILLEGAL_TRANSITION" as const;
  status = 409;
  constructor(public from: State, public to: State) {
    super(`E_ILLEGAL_TRANSITION ${from} -> ${to}`);
  }
}

export function canTransition(from: State, to: State): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: State, to: State): void {
  if (!canTransition(from, to)) throw new IllegalTransition(from, to);
}

export function isState(s: string): s is State {
  return (STATES as readonly string[]).includes(s);
}

/** Returns the new milestone when `from → to` crosses a milestone boundary, else null. */
export function milestoneChanged(from: State, to: State): Milestone | null {
  return MILESTONE_OF[from] === MILESTONE_OF[to] ? null : MILESTONE_OF[to];
}

/** Default owner of the next move per SPEC §3.2 (before exceptions/offer/sample status refine it — see derived.ts). */
export const DEFAULT_OWNER: Record<State, "client" | "agency" | "none"> = {
  draft: "client", submitted: "agency", in_review: "agency", spec_frozen: "agency", cost_target_price: "agency", rfq_out: "agency",
  quotes_in: "agency", shortlisted: "agency", negotiating: "agency", offer_ready: "client", sampling: "agency", offer_accepted: "agency",
  order_confirmed: "agency", awaiting_deposit: "client", awaiting_artwork: "client", in_production: "agency", qc_inspection: "agency",
  awaiting_balance: "client", forwarder_booked: "agency", shipped_exworks: "agency", departed_origin: "agency", eu_port_customs: "agency",
  delivered: "client", completed: "none",
};

/**
 * States whose `state_changed` event appears in the client "Updates" feed (SPEC 7.12). Milestone crossings that are
 * always accompanied by a more specific event (spec_frozen, offer_sent, sample_decided, inspection_recorded…) are not
 * repeated; every client-visible event still shows in the History tab.
 */
export const FEED_STATES: readonly State[] = ["in_review", "order_confirmed", "in_production", "qc_inspection", "forwarder_booked", "departed_origin", "eu_port_customs", "delivered", "completed"];
export const isFeedState = (s: State) => FEED_STATES.includes(s);

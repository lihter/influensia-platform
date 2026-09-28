/**
 * SPEC Appendix B.2 / B.3 — derived values that drive both dashboards. Pure functions over plain inputs.
 */
import type { LineException, LineState, OfferStatus, SampleStatus, PaymentKind, PaymentStatus, ArtworkStatus } from "@/db/enums";
import { now } from "./clock";
import { workingDaysBetween, addWorkingDays } from "./dates";

export type WaitingParty = "client" | "agency" | "none";
export type WaitingReason =
  | "needs_input" | "offer_sent" | "offer_followup" | "sample_received" | "sample_in_progress" | "deposit_due" | "advance_state"
  | "artwork_due" | "artwork_review" | "balance_due" | "delivery_confirm" | LineState | "none";

export type WaitingOn = { party: WaitingParty; reason: WaitingReason; detail?: "artwork_changes_requested" };

/** Everything waitingOn() needs, in app-schema terms (no supplier data). */
export type WaitingInput = {
  state: LineState;
  exception?: LineException | null;
  /** latest offer on the line */
  offerStatus?: OfferStatus | null;
  /** latest sample on the line */
  sampleStatus?: SampleStatus | null;
  payments?: { kind: PaymentKind; status: PaymentStatus }[];
  /** latest artwork per order line; `null` entries mean "no artwork uploaded yet" */
  artworks?: ({ status: ArtworkStatus } | null)[];
};

export function waitingOn(e: WaitingInput): WaitingOn {
  if (e.exception === "cancelled" || e.exception === "on_hold") return { party: "none", reason: "none" };
  if (e.exception === "needs_input") return { party: "client", reason: "needs_input" };
  switch (e.state) {
    case "draft": return { party: "none", reason: "none" };
    case "offer_ready": return e.offerStatus === "sent" ? { party: "client", reason: "offer_sent" } : { party: "agency", reason: "offer_followup" };
    case "sampling": return e.sampleStatus === "received" ? { party: "client", reason: "sample_received" } : { party: "agency", reason: "sample_in_progress" };
    case "awaiting_deposit": {
      const pending = (e.payments ?? []).some((p) => (p.kind === "deposit" || p.kind === "fee") && p.status === "pending");
      return pending ? { party: "client", reason: "deposit_due" } : { party: "agency", reason: "advance_state" };
    }
    case "awaiting_artwork": {
      const arts = e.artworks ?? [];
      const due = arts.length === 0 || arts.some((a) => a === null || a.status === "changes_requested");
      if (due) return { party: "client", reason: "artwork_due", detail: arts.some((a) => a?.status === "changes_requested") ? "artwork_changes_requested" : undefined };
      return { party: "agency", reason: "artwork_review" };
    }
    case "awaiting_balance": {
      const pending = (e.payments ?? []).some((p) => p.kind === "balance" && p.status === "pending");
      return pending ? { party: "client", reason: "balance_due" } : { party: "agency", reason: "advance_state" };
    }
    case "delivered": return { party: "client", reason: "delivery_confirm" };
    case "completed": return { party: "none", reason: "none" };
    default: return { party: "agency", reason: e.state };
  }
}

export const STALE_WORKING_DAYS = 5;

/** B.3 — waiting on agency and > 5 working days since the last state change. on_hold/cancelled never stale. */
export function isStale(e: WaitingInput & { lastStateChangeAt: Date | string }, at: Date = now()): boolean {
  const w = waitingOn(e);
  if (w.party !== "agency") return false;
  return workingDaysBetween(e.lastStateChangeAt, at) > STALE_WORKING_DAYS;
}

/** The instant an entity became stale (`last_state_change_at + 5 working days`) or null. Stored on `stale_since`. */
export function staleSince(e: WaitingInput & { lastStateChangeAt: Date | string }, at: Date = now()): Date | null {
  return isStale(e, at) ? addWorkingDays(e.lastStateChangeAt, STALE_WORKING_DAYS) : null;
}

import type { LineState, Milestone, ParticipationStatus, OfferStatus, SampleStatus, PaymentStatus, LineException } from "@/db/enums";

export type Tone = "neutral" | "info" | "warning" | "success" | "danger" | "outline" | "dashed" | "green";

/** DESIGN §5.3-B: internal state chip tone by state group. */
export const STATE_TONE: Record<LineState, Tone> = {
  draft: "neutral", submitted: "neutral", in_review: "neutral", spec_frozen: "neutral",
  cost_target_price: "warning", rfq_out: "info", quotes_in: "info", shortlisted: "info", negotiating: "warning",
  offer_ready: "outline", sampling: "outline", offer_accepted: "info",
  order_confirmed: "info", awaiting_deposit: "outline", awaiting_artwork: "outline", in_production: "info", qc_inspection: "info",
  awaiting_balance: "outline", forwarder_booked: "info", shipped_exworks: "info", departed_origin: "info", eu_port_customs: "info",
  delivered: "success", completed: "success",
};

/** DESIGN §5.3-C */
export const PARTICIPATION_TONE: Record<ParticipationStatus, Tone> = {
  contacted: "neutral", quoted: "info", shortlisted: "green", negotiating: "warning", selected: "success", backup: "outline", dropped: "neutral", cannot_make: "danger",
};

export const OFFER_TONE: Record<OfferStatus, Tone> = { draft: "neutral", sent: "outline", accepted: "success", changes_requested: "warning", declined: "danger", expired: "neutral" };
export const SAMPLE_TONE: Record<SampleStatus, Tone> = { ordered: "neutral", shipped: "info", received: "outline", approved: "success", rejected: "danger" };
export const PAYMENT_TONE: Record<PaymentStatus, Tone> = { pending: "warning", paid: "success", waived: "neutral" };
export const EXCEPTION_TONE: Record<LineException, Tone> = { needs_input: "info", change_requested: "warning", sample_rejected: "danger", quote_expired: "warning", qc_failed: "danger", on_hold: "dashed", cancelled: "neutral" };

export const MILESTONE_TONE = (m: Milestone, waitingOnClient: boolean): Tone => (m === "delivered" ? "success" : waitingOnClient ? "green" : "neutral");

/**
 * Text resolution for client-visible strings outside React (repositories, seed, emails). Reads messages/en.json directly
 * so it works in tsx scripts and Vitest; UI components use next-intl for the same keys.
 */
import en from "../../../messages/en.json";
import type { LineState, Milestone, LineException, ActivityType } from "@/db/enums";
import { formatDate } from "./dates";

const M = en as unknown as Record<string, Record<string, unknown>>;
const fill = (tpl: string, vars: Record<string, string | number | null | undefined>) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));

export const milestoneLabel = (m: Milestone) => (M.milestone as Record<string, string>)[m];
export const stateLabel = (s: LineState) => (M.state as Record<string, string>)[s];
export const exceptionClientText = (e: LineException | null | undefined) => (e ? (M.exception.client as Record<string, string>)[e] : null);

/** SPEC §3.2 last column — the client sub-label for a state. */
export function subLabelFor(state: LineState, v: { agentName?: string | null; reached?: number; priced?: number; isRepeat?: boolean } = {}): string {
  const sub = M.milestone.sub as Record<string, string>;
  if (v.isRepeat && (state === "negotiating" || state === "quotes_in" || state === "shortlisted")) return sub.repeat;
  return fill(sub[state] ?? stateLabel(state), { agent: v.agentName ?? "Influensia", reached: v.reached ?? 0, priced: v.priced ?? 0 });
}

/** Renders a client-visible activity event to one line of text. Seed/actions may pre-render into payload.text. */
export function eventText(type: ActivityType, payload: Record<string, unknown>): string {
  if (typeof payload.text === "string" && payload.text) return payload.text;
  const p = payload as Record<string, string | undefined>;
  switch (type) {
    case "request_submitted": return "Received";
    case "line_created": return "Line added";
    case "line_updated": return "Request updated";
    case "state_changed": {
      const to = p.to as LineState | undefined;
      if (!to) return "Status changed";
      const base = stateLabel(to);
      if (to === "in_review" && p.agentName) return `In review — your contact is ${p.agentName}`;
      if (to === "in_production" && p.eta) return `In production — ex-works ETA ${formatDate(p.eta)}`;
      if (to === "order_confirmed" && p.piNumber) return `Order confirmed — invoice ${p.piNumber} issued`;
      return p.note ? `${base} — ${p.note}` : base;
    }
    case "spec_frozen": return p.summary ? `Spec confirmed: ${p.summary} — Finding factory` : `Spec confirmed (v${p.version ?? 1})`;
    case "offer_sent": return `Price ready — offer v${p.version ?? 1}`;
    case "offer_decided": return p.decision === "accepted" ? `Offer accepted (Option ${p.option ?? "A"})` : p.decision === "declined" ? "Offer declined" : "Changes requested on the offer";
    case "sample_created": return "Sample ordered";
    case "sample_status_changed": return p.status === "shipped" ? `Sample shipped${p.courier ? ` — ${p.courier} ${p.tracking ?? ""}`.trimEnd() : ""}` : p.status === "received" ? "Sample received" : "Sample updated";
    case "sample_decided": return p.decision === "approved" ? "Sample approved" : "Sample rejected";
    case "order_confirmed": return `Order confirmed — ${p.ref ?? ""}`.trim();
    case "payment_recorded": return `Payment received — ${p.kind ?? ""}`.trim();
    case "artwork_submitted": return "Artwork uploaded";
    case "artwork_decided": return p.decision === "approved" ? "Artwork approved" : "Artwork changes requested";
    case "inspection_recorded": return p.result === "pass" ? "Quality check passed" : "Quality check: rework in progress";
    case "shipment_updated": return "Shipping update";
    case "eta_changed": return `ETA updated — ${p.eta ? formatDate(p.eta) : ""}`.trim();
    case "document_published": return `New document: ${p.kindLabel ?? p.kind ?? "document"}`;
    case "document_uploaded": return `Document added: ${p.filename ?? ""}`.trim();
    case "exception_set": return exceptionClientText(p.exception as LineException) ?? "Status flag set";
    case "exception_cleared": return "Status flag cleared";
    case "comment_posted": return "New update";
    case "range_published": return "More from this factory is available";
    case "delivery_confirmed": return "Delivery confirmed";
    case "reorder_created": return "Reorder created";
    case "line_assigned": return p.agentName ? `Your contact is ${p.agentName}` : "Assigned";
    default: return type.replace(/_/g, " ");
  }
}

/** True when a client-visible event belongs in the "Updates" feed (SPEC 7.12); History shows every client-visible event. */
export function isFeedEvent(type: ActivityType, payload: Record<string, unknown>): boolean {
  if (type === "state_changed") return payload.feed === true;
  return (MILESTONE_EVENT_TYPES as readonly string[]).includes(type) || type === "range_published" || type === "document_published" || type === "artwork_decided" || type === "eta_changed";
}

/** Activity types that mark a milestone in the client feed (filled dot). */
export const MILESTONE_EVENT_TYPES: readonly ActivityType[] = ["request_submitted", "state_changed", "spec_frozen", "offer_sent", "offer_decided", "sample_status_changed", "sample_decided", "order_confirmed", "inspection_recorded", "delivery_confirmed", "state_overridden"];

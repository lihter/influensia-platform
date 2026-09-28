import { z } from "zod";
import { MoneyDto, UnitPriceDto, MilestoneDto, LineStateDto, isoDateTime, isoDate } from "./common";
import { ClientRequestLineDto } from "./request";
import { ClientTimelineDto } from "./comment";
import { ClientDocumentDto } from "./document";
import { ClientPreviousOrderDto } from "./order";

/** Offer summary card on the line page (F-07 region 8). */
export const ClientLineOfferCardDto = z.object({
  ref: z.string(),
  href: z.string(),
  version: z.number().int(),
  status: z.enum(["sent", "accepted", "changes_requested", "declined", "expired"]),
  validUntil: isoDate.nullable(),
  acceptedOptionLabel: z.enum(["A", "B", "C"]).nullable(),
  unitPrice: UnitPriceDto.nullable(),
  fee: MoneyDto.nullable(),
  moq: z.number().int().nullable(),
  leadDays: z.number().int().nullable(),
  decidedAt: isoDateTime.nullable(),
}).strict();
export type ClientLineOfferCardDto = z.infer<typeof ClientLineOfferCardDto>;

/** Sample card on the line page. */
export const ClientLineSampleCardDto = z.object({
  ref: z.string(),
  href: z.string(),
  status: z.enum(["ordered", "shipped", "received", "approved", "rejected"]),
  courier: z.string().nullable(),
  tracking: z.string().nullable(),
  receivedAt: isoDateTime.nullable(),
  decidedAt: isoDateTime.nullable(),
}).strict();
export type ClientLineSampleCardDto = z.infer<typeof ClientLineSampleCardDto>;

export const ClientLineOrderCardDto = z.object({
  ref: z.string(),
  href: z.string(),
  state: LineStateDto,
  milestone: MilestoneDto,
  etaLabel: z.string().nullable(),
}).strict();
export type ClientLineOrderCardDto = z.infer<typeof ClientLineOrderCardDto>;

/** Everything the client line page renders (SPEC F-07). Strict at every level; no supplier data by construction. */
export const ClientLinePageDto = z.object({
  companyLabel: z.string(),
  line: ClientRequestLineDto,
  waitingReasonDetail: z.string().nullable(),
  openQuestion: z.string().nullable(),
  timeline: ClientTimelineDto,
  documents: z.array(ClientDocumentDto),
  previousOrders: z.array(ClientPreviousOrderDto),
  offer: ClientLineOfferCardDto.nullable(),
  sample: ClientLineSampleCardDto.nullable(),
  order: ClientLineOrderCardDto.nullable(),
  /** "More from this factory" link when a published range exists for this line and company */
  factoryRange: z.object({ label: z.string(), href: z.string() }).strict().nullable(),
  /** the ▲ primary action (Accept price / Approve sample / …) */
  primaryAction: z.object({ label: z.string(), href: z.string() }).strict().nullable(),
}).strict();
export type ClientLinePageDto = z.infer<typeof ClientLinePageDto>;

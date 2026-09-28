import { z } from "zod";
import { MoneyDto, PricingDisplayDto, isoDateTime, isoDate } from "./common";

export const ClientPriceBreakDto = z.object({ minQty: z.number().int(), unitPriceMinorE2: z.number().int() }).strict();

export const ClientOfferOptionDto = z.object({
  id: z.uuid(),
  label: z.enum(["A", "B", "C"]),
  unit: z.string(),
  currency: z.string(),
  moq: z.number().int().nullable(),
  leadDays: z.number().int().nullable(),
  priceBreaks: z.array(ClientPriceBreakDto),
  /** unit price at the line quantity, from the ladder */
  unitPriceMinorE2: z.number().int().nullable(),
  fee: MoneyDto.nullable(),           // shown only when factory_plus_fee
  deviations: z.string().nullable(),
  sampleCost: MoneyDto.nullable(),
  samplePaidBy: z.enum(["client", "agency", "factory"]).nullable(),
  sampleRequired: z.boolean(),
  paymentTerms: z.string().nullable(),
  recommended: z.boolean(),
}).strict();
export type ClientOfferOptionDto = z.infer<typeof ClientOfferOptionDto>;

/** Only status ∈ {sent, accepted, changes_requested, declined, expired} are readable (never draft). */
export const ClientOfferDto = z.object({
  id: z.uuid(),
  ref: z.string(),
  lineRef: z.string(),
  lineName: z.string(),
  qty: z.number().int().nullable(),
  version: z.number().int(),
  status: z.enum(["sent", "accepted", "changes_requested", "declined", "expired"]),
  pricingDisplay: PricingDisplayDto,
  incoterm: z.string().nullable(),
  port: z.string().nullable(),
  noteFromUs: z.string().nullable(),
  validUntil: isoDate.nullable(),
  sentAt: isoDateTime.nullable(),
  decidedAt: isoDateTime.nullable(),
  acceptedOptionLabel: z.enum(["A", "B", "C"]).nullable(),
  options: z.array(ClientOfferOptionDto),
  canDecide: z.boolean(),
}).strict();
export type ClientOfferDto = z.infer<typeof ClientOfferDto>;

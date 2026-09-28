import { z } from "zod";
import { MoneyDto, isoDateTime } from "./common";
import { ClientDocumentDto } from "./document";

export const ClientSampleDto = z.object({
  id: z.uuid(),
  ref: z.string(),
  lineRef: z.string(),
  lineName: z.string(),
  status: z.enum(["ordered", "shipped", "received", "approved", "rejected"]),
  cost: MoneyDto.nullable(),
  paidBy: z.enum(["client", "agency", "factory"]).nullable(),
  courier: z.string().nullable(),
  tracking: z.string().nullable(),
  orderedAt: isoDateTime.nullable(),
  shippedAt: isoDateTime.nullable(),
  receivedAt: isoDateTime.nullable(),
  decidedAt: isoDateTime.nullable(),
  rejectReason: z.string().nullable(),
  photos: z.array(ClientDocumentDto),
  canDecide: z.boolean(),
}).strict();
export type ClientSampleDto = z.infer<typeof ClientSampleDto>;

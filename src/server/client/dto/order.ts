import { z } from "zod";
import { MoneyDto, UnitPriceDto, MilestoneDto, LineStateDto, ExceptionDto, PricingDisplayDto, WaitingReasonDto, isoDateTime, isoDate } from "./common";
import { ClientDocumentDto } from "./document";

/** Client sees due/paid + date. Never `reference`, never `recorded_by`. */
export const ClientPaymentDto = z.object({
  id: z.uuid(),
  kind: z.enum(["deposit", "fee", "balance", "sample"]),
  pct: z.number().int().nullable(),
  amount: MoneyDto,
  status: z.enum(["pending", "paid", "waived"]),
  dueOn: isoDate.nullable(),
  dueLabel: z.string().nullable(),   // "on QC pass" when due_on is null for balance
  paidAt: isoDateTime.nullable(),
}).strict();
export type ClientPaymentDto = z.infer<typeof ClientPaymentDto>;

export const ClientArtworkDto = z.object({
  id: z.uuid(),
  lineRef: z.string(),
  version: z.number().int(),
  status: z.enum(["submitted", "changes_requested", "approved"]),
  file: ClientDocumentDto.nullable(),
  dieline: ClientDocumentDto.nullable(),
  note: z.string().nullable(),       // client_note only
  decidedAt: isoDateTime.nullable(),
}).strict();
export type ClientArtworkDto = z.infer<typeof ClientArtworkDto>;

/** Inspection projection: {scheduled_for, inspected_at, result, report if visible_to_client} (SPEC 5.1). */
export const ClientInspectionDto = z.object({
  scheduledFor: isoDate.nullable(),
  inspectedAt: isoDateTime.nullable(),
  result: z.enum(["pass", "fail", "rework"]).nullable(),
  report: ClientDocumentDto.nullable(),
}).strict();
export type ClientInspectionDto = z.infer<typeof ClientInspectionDto>;

/** Shipment projection (SPEC 5.2): forwarder name only when forwarder_party=client. */
export const ClientShipmentDto = z.object({
  forwarderName: z.string().nullable(),
  mode: z.enum(["sea", "air", "rail"]).nullable(),
  containerOrAwb: z.string().nullable(),
  cargoReady: isoDate.nullable(),
  etd: isoDate.nullable(),
  etaPort: isoDate.nullable(),
  portOfDischarge: z.string().nullable(),
  arrivedPortAt: isoDateTime.nullable(),
  customsStatus: z.enum(["not_started", "in_progress", "cleared", "held"]),
  deliveredAt: isoDateTime.nullable(),
  billOfLading: ClientDocumentDto.nullable(),
  packingList: ClientDocumentDto.nullable(),
}).strict();
export type ClientShipmentDto = z.infer<typeof ClientShipmentDto>;

export const ClientOrderLineDto = z.object({
  id: z.uuid(),
  lineRef: z.string(),
  name: z.string(),
  qty: z.number().int(),
  unit: z.string(),
  unitPrice: UnitPriceDto,
  fee: MoneyDto.nullable(),
  specVersion: z.number().int().nullable(),
  artworkRequired: z.boolean(),
  clientSku: z.string().nullable(),
}).strict();
export type ClientOrderLineDto = z.infer<typeof ClientOrderLineDto>;

export const ClientOrderDto = z.object({
  id: z.uuid(),
  ref: z.string(),
  requestRef: z.string(),
  name: z.string(),                   // first line's name
  state: LineStateDto,
  milestone: MilestoneDto,
  milestoneStep: z.number().int().min(1).max(9),
  subLabel: z.string(),
  exception: ExceptionDto,
  exceptionText: z.string().nullable(),
  waitingReason: WaitingReasonDto.nullable(),
  pricingDisplay: PricingDisplayDto,
  incoterm: z.string().nullable(),
  port: z.string().nullable(),
  piNumber: z.string().nullable(),
  total: MoneyDto,
  confirmedAt: isoDateTime.nullable(),
  exworksEta: isoDate.nullable(),
  etaLabel: z.string().nullable(),
  deliveredAt: isoDateTime.nullable(),
  completedAt: isoDateTime.nullable(),
  lines: z.array(ClientOrderLineDto),
  payments: z.array(ClientPaymentDto),
  artworks: z.array(ClientArtworkDto),
  inspection: ClientInspectionDto.nullable(),
  shipment: ClientShipmentDto.nullable(),
  documents: z.array(ClientDocumentDto),
  hasFactoryRange: z.boolean(),
  canConfirmDelivery: z.boolean(),
  canReorder: z.boolean(),
  sampleSkipped: z.boolean(),
  lastChangeAt: isoDateTime,
}).strict();
export type ClientOrderDto = z.infer<typeof ClientOrderDto>;

/** D-19 client history panel: "Your previous orders of this product". */
export const ClientPreviousOrderDto = z.object({
  orderRef: z.string(),
  qty: z.number().int(),
  unit: z.string(),
  unitPrice: UnitPriceDto,
  fee: MoneyDto.nullable(),
  deliveredAt: isoDateTime.nullable(),
}).strict();
export type ClientPreviousOrderDto = z.infer<typeof ClientPreviousOrderDto>;

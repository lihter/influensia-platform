/**
 * Client portal lists (Products, Orders): image-first rows for the client tables. Strict + denylist-tested like every
 * other client shape — prices are the client's own (accepted / ordered / offered), never a factory figure.
 */
import { z } from "zod";
import { MilestoneDto, LineStateDto, ExceptionDto, WaitingReasonDto, UnitPriceDto, MoneyDto, SourcingProgressDto, isoDateTime, isoDate } from "./common";
import { ClientProductImageDto } from "./product";
import { ClientDocumentDto } from "./document";

/** One product the client asked us to source (a request line, or the latest line of a repeat product). */
export const ClientProductRowDto = z.object({
  id: z.uuid(),
  ref: z.string(),
  href: z.string(),
  name: z.string(),
  image: ClientProductImageDto.nullable(),
  /** shown under the placeholder when there is no photo yet ("allegro.pl") */
  linkDomain: z.string().nullable(),
  qty: z.number().int().nullable(),
  unit: z.string(),
  state: LineStateDto,
  milestone: MilestoneDto,
  milestoneLabel: z.string(),
  exception: ExceptionDto,
  waitingReason: WaitingReasonDto.nullable(),
  /** inputs for "what's next and when" (client-format nextStepFor) */
  offerOutcome: z.enum(["changes_requested", "declined", "expired"]).nullable(),
  sourcingProgress: SourcingProgressDto,
  etaLabel: z.string().nullable(),
  isRepeat: z.boolean(),
  lastChangeAt: isoDateTime,
  /** the client's unit price: from the order, the accepted offer, or the lowest option of an open offer */
  price: UnitPriceDto.nullable(),
  priceBasis: z.enum(["ordered", "accepted", "offered"]).nullable(),
  /** per-order service fee shown next to the factory price (factory + fee pricing) */
  fee: MoneyDto.nullable(),
  incoterm: z.string().nullable(),
  port: z.string().nullable(),
  orderCount: z.number().int().nonnegative(),
  lastOrderRef: z.string().nullable(),
  lastOrderedAt: isoDateTime.nullable(),
  updatedAt: isoDateTime,
}).strict();
export type ClientProductRowDto = z.infer<typeof ClientProductRowDto>;

export const ClientProductListDto = z.object({
  companyLabel: z.string(),
  rows: z.array(ClientProductRowDto),
}).strict();
export type ClientProductListDto = z.infer<typeof ClientProductListDto>;

/** One step of an order as a check mark: done ✓ · current (in progress / due) · todo · n/a. */
export const ClientOrderStepDto = z.object({
  status: z.enum(["done", "current", "todo", "na"]),
  /** short detail under the mark: "Paid 22 Sep", "Due 30 Sep", "ETA 25 Oct" */
  detail: z.string().nullable(),
}).strict();
export type ClientOrderStepDto = z.infer<typeof ClientOrderStepDto>;

export const ClientOrderItemDto = z.object({
  name: z.string(),
  image: ClientProductImageDto.nullable(),
  qty: z.number().int(),
  unit: z.string(),
}).strict();

export const ClientOrderRowDto = z.object({
  id: z.uuid(),
  ref: z.string(),
  href: z.string(),
  placedAt: isoDateTime,
  items: z.array(ClientOrderItemDto),
  total: MoneyDto,
  milestone: MilestoneDto,
  milestoneLabel: z.string(),
  exception: ExceptionDto,
  waitingReason: WaitingReasonDto.nullable(),
  etaLabel: z.string().nullable(),
  steps: z.object({
    deposit: ClientOrderStepDto,
    artwork: ClientOrderStepDto,
    production: ClientOrderStepDto,
    shipping: ClientOrderStepDto,
    balance: ClientOrderStepDto,
    commission: ClientOrderStepDto,
  }).strict(),
  invoice: ClientDocumentDto.nullable(),
  deliveredOn: isoDate.nullable(),
}).strict();
export type ClientOrderRowDto = z.infer<typeof ClientOrderRowDto>;

export const ClientOrderListDto = z.object({
  companyLabel: z.string(),
  rows: z.array(ClientOrderRowDto),
}).strict();
export type ClientOrderListDto = z.infer<typeof ClientOrderListDto>;

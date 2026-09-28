/**
 * Client DTOs for the intake + list feature (SPEC F-04 / F-05 / F-06). Strict, denylist-tested like every other client shape.
 */
import { z } from "zod";
import { MilestoneDto, LineStateDto, ExceptionDto, SourcingProgressDto, WaitingReasonDto, isoDateTime } from "./common";
import { ClientRequestDto } from "./request";
import { ClientDocumentDto } from "./document";
import { ClientUpdateDto, ClientEventDto } from "./comment";

export const ClientListTabDto = z.enum(["active", "waiting", "delivered", "drafts"]);
export type ClientListTabDto = z.infer<typeof ClientListTabDto>;

/** One row of Requests & orders (F-05): a line, or an order line shown once per line with the order ref. */
export const ClientListRowDto = z.object({
  id: z.uuid(),
  ref: z.string(),                 // line ref, e.g. REQ-2026-0312-01
  requestRef: z.string(),
  orderRef: z.string().nullable(), // ORD-2026-0312 when an order exists
  /** what to print in the Ref column: `ORD-2026-0312 · line 01` or the line ref */
  displayRef: z.string(),
  href: z.string(),
  name: z.string(),
  qty: z.number().int().nullable(),
  unit: z.string(),
  state: LineStateDto,
  milestone: MilestoneDto,
  milestoneStep: z.number().int().min(1).max(9),
  subLabel: z.string(),
  exception: ExceptionDto,
  exceptionText: z.string().nullable(),
  waitingReason: WaitingReasonDto.nullable(),
  sourcingProgress: SourcingProgressDto,
  etaLabel: z.string().nullable(),
  isRepeat: z.boolean(),
  isDraft: z.boolean(),
  isClosed: z.boolean(),           // cancelled → "Closed" sub-heading of Delivered
  updatedAt: isoDateTime,
}).strict();
export type ClientListRowDto = z.infer<typeof ClientListRowDto>;

export const ClientRequestListDto = z.object({
  companyLabel: z.string(),
  rows: z.array(ClientListRowDto),
  counts: z.object({ active: z.number().int(), waiting: z.number().int(), delivered: z.number().int(), drafts: z.number().int() }).strict(),
}).strict();
export type ClientRequestListDto = z.infer<typeof ClientRequestListDto>;

/** Request page (F-06): the request with its lines + request-level documents, updates and history. */
export const ClientRequestPageDto = z.object({
  companyLabel: z.string(),
  request: ClientRequestDto,
  /** true while every line is ≤ in_review (client may still edit / send a draft) */
  editable: z.boolean(),
  documents: z.array(ClientDocumentDto),
  updates: z.array(ClientUpdateDto),
  history: z.array(ClientEventDto),
}).strict();
export type ClientRequestPageDto = z.infer<typeof ClientRequestPageDto>;

/** Result of "Send request" / "Save draft". */
export const ClientRequestCreatedDto = z.object({
  id: z.uuid(),
  ref: z.string(),
  lineCount: z.number().int().positive(),
  draft: z.boolean(),
  href: z.string(),
}).strict();
export type ClientRequestCreatedDto = z.infer<typeof ClientRequestCreatedDto>;

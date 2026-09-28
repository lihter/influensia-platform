import { z } from "zod";
import { MoneyDto, UnitPriceDto, MilestoneDto, LineStateDto, ExceptionDto, SourcingProgressDto, WaitingReasonDto, isoDateTime, isoDate } from "./common";

export const ClientRequestLineDto = z.object({
  id: z.uuid(),
  ref: z.string(),           // REQ-2026-0312-01
  requestRef: z.string(),
  lineNo: z.number().int(),
  name: z.string(),
  qty: z.number().int().nullable(),
  unit: z.string(),
  clientSku: z.string().nullable(),
  links: z.array(z.string()),
  note: z.string().nullable(),
  state: LineStateDto,
  milestone: MilestoneDto,
  milestoneStep: z.number().int().min(1).max(9),
  /** the state's client sub-label, already resolved (SPEC 3.2 last column) */
  subLabel: z.string(),
  exception: ExceptionDto,
  exceptionText: z.string().nullable(),
  sourcingProgress: SourcingProgressDto,
  agentName: z.string().nullable(),
  specVersion: z.number().int().nullable(),
  specSummary: z.string().nullable(),
  isRepeat: z.boolean(),
  fromCatalog: z.boolean(),
  factoryLabel: z.string().nullable(),   // "F-0042" when the line came from a published range
  /** waiting_on for the client, null when the agency owes the move */
  waitingReason: WaitingReasonDto.nullable(),
  price: UnitPriceDto.nullable(),
  fee: MoneyDto.nullable(),
  etaDate: isoDate.nullable(),
  etaLabel: z.string().nullable(),       // "ETA Gdańsk 18 Nov 2026"
  offerRef: z.string().nullable(),
  sampleRef: z.string().nullable(),
  orderRef: z.string().nullable(),
  sampleSkipped: z.boolean(),
  lastChangeAt: isoDateTime,
  updatedAt: isoDateTime,
  canEdit: z.boolean(),
  canCancel: z.boolean(),
}).strict();
export type ClientRequestLineDto = z.infer<typeof ClientRequestLineDto>;

export const ClientRequestDto = z.object({
  id: z.uuid(),
  ref: z.string(),
  status: z.enum(["draft", "submitted", "active", "closed"]),
  source: z.enum(["portal", "import", "agent_on_behalf"]),
  clientRef: z.string().nullable(),
  note: z.string().nullable(),
  submittedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  lines: z.array(ClientRequestLineDto),
}).strict();
export type ClientRequestDto = z.infer<typeof ClientRequestDto>;

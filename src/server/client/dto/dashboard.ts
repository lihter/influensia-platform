import { z } from "zod";
import { MilestoneDto, ExceptionDto, SourcingProgressDto, WaitingReasonDto, MoneyDto, isoDateTime, isoDate } from "./common";
import { ClientUpdateDto } from "./comment";

/** One "Waiting on you" card (SPEC F-03 table). */
export const ClientWaitingItemDto = z.object({
  id: z.string(),
  reason: WaitingReasonDto,
  entityRef: z.string(),             // line ref or order ref
  name: z.string(),
  href: z.string(),
  dueOn: isoDate.nullable(),
  /** deposit + fee, or balance */
  amounts: z.array(MoneyDto),
  questionExcerpt: z.string().nullable(),
  artworkChangesRequested: z.boolean(),
  since: isoDateTime,
}).strict();
export type ClientWaitingItemDto = z.infer<typeof ClientWaitingItemDto>;

export const ClientActiveLineDto = z.object({
  id: z.uuid(),
  ref: z.string(),
  href: z.string(),
  name: z.string(),
  qty: z.number().int().nullable(),
  unit: z.string(),
  milestone: MilestoneDto,
  milestoneStep: z.number().int().min(1).max(9),
  subLabel: z.string(),
  exception: ExceptionDto,
  exceptionText: z.string().nullable(),
  waitingReason: WaitingReasonDto.nullable(),
  sourcingProgress: SourcingProgressDto,
  etaLabel: z.string().nullable(),
  orderRef: z.string().nullable(),
  isRepeat: z.boolean(),
  updatedAt: isoDateTime,
}).strict();
export type ClientActiveLineDto = z.infer<typeof ClientActiveLineDto>;

export const ClientDashboardDto = z.object({
  companyLabel: z.string(),          // eyebrow, e.g. "KOFF" — the org name is the only org attribute exposed
  userName: z.string(),
  waiting: z.array(ClientWaitingItemDto),
  active: z.array(ClientActiveLineDto),
  deliveredCount: z.number().int().nonnegative(),
  recentUpdates: z.array(ClientUpdateDto),
}).strict();
export type ClientDashboardDto = z.infer<typeof ClientDashboardDto>;

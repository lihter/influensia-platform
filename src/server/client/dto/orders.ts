import { z } from "zod";
import { ClientOrderDto, ClientPreviousOrderDto } from "./order";
import { ClientUpdateDto, ClientEventDto } from "./comment";

/**
 * F-10 order page payload: the order projection plus its Updates / History feeds and the D-19 history panel.
 * Strict at every level; keys are denylist-tested with every other DTO in this folder.
 */
export const ClientOrderPageDto = z.object({
  order: ClientOrderDto,
  companyLabel: z.string(),
  agentName: z.string().nullable(),
  updates: z.array(ClientUpdateDto),
  history: z.array(ClientEventDto),
  previousOrders: z.array(ClientPreviousOrderDto),
  /** lines that still need an artwork upload from the client (artwork_required and no submitted/approved version) */
  artworkDue: z.array(z.object({ orderLineId: z.uuid(), lineRef: z.string(), name: z.string() }).strict()),
}).strict();
export type ClientOrderPageDto = z.infer<typeof ClientOrderPageDto>;

/** Result of "Reorder" — the new request the client is sent to. */
export const ClientReorderResultDto = z.object({
  requestRef: z.string(),
  lineRefs: z.array(z.string()),
  href: z.string(),
}).strict();
export type ClientReorderResultDto = z.infer<typeof ClientReorderResultDto>;

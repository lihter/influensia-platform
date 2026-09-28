import { z } from "zod";
import { isoDateTime } from "./common";
import { ClientDocumentDto } from "./document";

/** Client-visible comments (update/question/answer/change_request/decline_reason/reject_reason). Never notes or WhatsApp logs. */
export const ClientCommentDto = z.object({
  id: z.uuid(),
  kind: z.enum(["update", "question", "answer", "change_request", "decline_reason", "reject_reason"]),
  body: z.string(),
  authorName: z.string().nullable(),
  /** true when written by someone in the client's own company */
  byYou: z.boolean(),
  at: isoDateTime,
  attachments: z.array(ClientDocumentDto),
}).strict();
export type ClientCommentDto = z.infer<typeof ClientCommentDto>;

/** A client-visible activity event, already rendered to text. Payload keys must pass the denylist (payload is a client DTO). */
export const ClientEventDto = z.object({
  id: z.uuid(),
  type: z.string(),
  text: z.string(),
  actorName: z.string().nullable(),
  at: isoDateTime,
  isMilestone: z.boolean(),
  isActionMilestone: z.boolean(),
}).strict();
export type ClientEventDto = z.infer<typeof ClientEventDto>;

/** Merged "Updates" feed: comments + milestone events, newest first. */
export const ClientUpdateDto = z.object({
  id: z.uuid(),
  kind: z.enum(["event", "comment"]),
  at: isoDateTime,
  text: z.string(),
  authorName: z.string().nullable(),
  byYou: z.boolean(),
  isActionMilestone: z.boolean(),
  attachments: z.array(ClientDocumentDto),
}).strict();
export type ClientUpdateDto = z.infer<typeof ClientUpdateDto>;

export const ClientTimelineDto = z.object({
  updates: z.array(ClientUpdateDto),
  history: z.array(ClientEventDto),
}).strict();
export type ClientTimelineDto = z.infer<typeof ClientTimelineDto>;

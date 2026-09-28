import { z } from "zod";
import { ClientDocumentDto } from "./document";

/** Documents tab of a client page: client-visible rows of client kinds, grouped by kind label in the UI. */
export const ClientDocumentListDto = z.object({
  items: z.array(ClientDocumentDto),
  /** kind → count, for the grouped rendering when > 6 documents */
  counts: z.record(z.string(), z.number().int().nonnegative()),
}).strict();
export type ClientDocumentListDto = z.infer<typeof ClientDocumentListDto>;

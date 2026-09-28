import { z } from "zod";
import { DOCUMENT_KINDS, INTERNAL_ONLY_DOCUMENT_KINDS } from "@/db/enums";
import { isoDateTime } from "./common";

const CLIENT_KINDS = DOCUMENT_KINDS.filter((k) => !INTERNAL_ONLY_DOCUMENT_KINDS.includes(k)) as [string, ...string[]];

/** Only `visibility=client` rows of client kinds are ever mapped here; `storage_key` never leaves the server. */
export const ClientDocumentDto = z.object({
  id: z.uuid(),
  filename: z.string(),
  kind: z.enum(CLIENT_KINDS),
  bytes: z.number().int().nonnegative(),
  uploadedAt: isoDateTime,
  /** always the foundation route: /api/files/{key}?filename=… (see clientDownloadUrl in server/client/documents.ts) */
  downloadUrl: z.string(),
}).strict();
export type ClientDocumentDto = z.infer<typeof ClientDocumentDto>;

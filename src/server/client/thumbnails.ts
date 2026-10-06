/**
 * Client-audience pictures: the shared media module under the client policy, parsed into the strict client DTO.
 * (Policy and source order live in @/server/shared/media.)
 */
import type { DbOrTx } from "@/db";
import { lineThumbs } from "@/server/shared/media";
import { ClientProductImageDto } from "./dto/product";

export { linkDomain } from "@/lib/media";

/** line id → its best client-visible picture. Lines of other orgs are ignored. */
export async function lineThumbnails(db: DbOrTx, orgId: string, lineIds: string[]): Promise<Map<string, ClientProductImageDto>> {
  const thumbs = await lineThumbs(db, lineIds, { kind: "client", orgId });
  return new Map([...thumbs].map(([lineId, t]) => [lineId, ClientProductImageDto.parse(t)]));
}

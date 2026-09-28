import { NextResponse } from "next/server";
import { authorize } from "@/server/shared/authorize";
import { getStorage, assertValidKey } from "@/server/shared/storage";
import { canReadKey, agencyOrgId, downloadNameFor } from "@/server/shared/files";
import { getDbHandle } from "@/server/shared/db-handle";
import { route } from "@/server/shared/http";

export const runtime = "nodejs";

/**
 * Presign-less download (mechanism 5). Key = org/{orgId}/{entity}/{entityId}/{client|internal}/{uuid}.ext
 * - clients: orgId must equal ctx.orgId (or the agency's shared catalog assets) AND the segment must be `client`;
 *   an `/internal/` key is 404 for clients even if a documents row somehow said `client` (SPEC 5.6)
 * - ops: any valid key
 */
export const GET = route(async (req: Request, { params }: { params: Promise<{ key: string[] }> }) => {
  const ctx = await authorize();
  const key = (await params).key.join("/");
  try { assertValidKey(key); } catch { return new NextResponse("bad key", { status: 400 }); }
  if (!canReadKey(ctx, key, await agencyOrgId(await getDbHandle()))) return new NextResponse("not found", { status: 404 });
  const obj = await getStorage().get(key);
  if (!obj) return new NextResponse("not found", { status: 404 });
  const url = new URL(req.url);
  // QA-46: the download name comes from the database record, never from the (spoofable) `filename` query
  const filename = await downloadNameFor(await getDbHandle(), key, ctx);
  const disposition = url.searchParams.get("dl") ? "attachment" : "inline";
  return new NextResponse(obj.body as ReadableStream, {
    headers: {
      "content-type": obj.contentType,
      "content-length": String(obj.bytes),
      "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "private, no-store",
    },
  });
});

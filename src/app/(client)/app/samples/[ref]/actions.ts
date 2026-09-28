"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, CLIENT_ROLES } from "@/server/shared/authorize";
import { toActionError, type ActionResult } from "@/server/shared/http";
import { approveSample, rejectSample } from "@/server/client/samples";

const refresh = (ref: string, lineRef: string) => { revalidatePath(`/app/samples/${ref}`); revalidatePath(`/app/lines/${lineRef}`); revalidatePath("/app"); revalidatePath(`/ops/lines/${lineRef}`); revalidatePath("/ops"); };

export async function approveSampleAction(raw: { ref: string; note?: string | null }): Promise<ActionResult<{ lineRef: string }>> {
  try { const ctx = await authorize({ roles: CLIENT_ROLES }); const i = z.object({ ref: z.string().min(1), note: z.string().trim().max(2000).nullish() }).parse(raw); const r = await approveSample(ctx, i); refresh(i.ref, r.lineRef); return { ok: true, data: r }; } catch (e) { return toActionError(e); }
}

/** Reject with reason (≥ 10 chars) and up to 5 photos — FormData because of the files. */
export async function rejectSampleAction(fd: FormData): Promise<ActionResult<{ lineRef: string; photos: number }>> {
  try {
    const ctx = await authorize({ roles: CLIENT_ROLES });
    const i = z.object({ ref: z.string().min(1), reason: z.string().trim().min(10, "At least 10 characters").max(2000) }).parse({ ref: fd.get("ref"), reason: fd.get("reason") });
    const photos: { data: Buffer; mime: string; filename: string }[] = [];
    for (const f of fd.getAll("photos")) if (f instanceof File && f.size > 0 && /^image\//.test(f.type) && f.size <= 25 * 1024 * 1024) photos.push({ data: Buffer.from(await f.arrayBuffer()), mime: f.type, filename: f.name });
    const r = await rejectSample(ctx, { ...i, photos: photos.slice(0, 5) });
    refresh(i.ref, r.lineRef);
    return { ok: true, data: r };
  } catch (e) { return toActionError(e); }
}

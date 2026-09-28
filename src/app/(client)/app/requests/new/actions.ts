"use server";
import { revalidatePath } from "next/cache";
import { authorize, CLIENT_ROLES } from "@/server/shared/authorize";
import { createClientRequest, parseNewRequestForm } from "@/server/client/requests";
import { toActionError, type ActionResult } from "@/server/shared/http";
import type { ClientRequestCreatedDto } from "@/server/client/dto/requests";

/**
 * F-04 "Send request" / "Save draft". Multipart body: `payload` (JSON, zod-validated by NewRequestSchema in the
 * repository module) + `line-{i}-file-{j}` reference images. Org and actor always come from the session.
 */
export async function createRequestAction(fd: FormData): Promise<ActionResult<ClientRequestCreatedDto>> {
  try {
    const ctx = await authorize({ roles: CLIENT_ROLES });
    const { input, files } = await parseNewRequestForm(fd);
    const created = await createClientRequest(ctx, input, files);
    revalidatePath("/app");
    revalidatePath("/app/requests");
    revalidatePath("/ops/queue");
    revalidatePath("/ops/requests");
    return { ok: true, data: created };
  } catch (e) {
    return toActionError(e);
  }
}

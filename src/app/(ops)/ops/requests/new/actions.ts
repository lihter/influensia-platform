"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, OPS_ROLES } from "@/server/shared/authorize";
import { parseNewRequestForm } from "@/server/client/requests";
import { createRequestOnBehalf } from "@/server/ops/requests";
import { toActionError, type ActionResult } from "@/server/shared/http";
import type { ClientRequestCreatedDto } from "@/server/client/dto/requests";

const Extra = z.object({
  orgId: z.uuid("Choose a client"),
  notifyClient: z.enum(["0", "1"]).default("0"),
  whatsapp: z.string().trim().max(8000).default(""),
  whatsappDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).default(""),
});

/** F-04 ops variant: org picker + source `agent_on_behalf` + optional "received via WhatsApp" note + optional client email. */
export async function createOnBehalfAction(fd: FormData): Promise<ActionResult<ClientRequestCreatedDto>> {
  try {
    const ctx = await authorize({ roles: OPS_ROLES });
    const extra = Extra.parse({ orgId: fd.get("orgId") ?? "", notifyClient: fd.get("notifyClient") ?? "0", whatsapp: fd.get("whatsapp") ?? "", whatsappDate: fd.get("whatsappDate") ?? "" });
    const { input, files } = await parseNewRequestForm(fd);
    const created = await createRequestOnBehalf(ctx, { orgId: extra.orgId, input, files, notifyClient: extra.notifyClient === "1", whatsappNote: extra.whatsapp ? { text: extra.whatsapp, receivedOn: extra.whatsappDate || null } : null });
    for (const p of ["/ops", "/ops/queue", "/ops/requests", "/app", "/app/requests"]) revalidatePath(p);
    return { ok: true, data: created };
  } catch (e) {
    return toActionError(e);
  }
}

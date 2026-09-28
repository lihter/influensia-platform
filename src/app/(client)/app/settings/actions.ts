"use server";
import { revalidatePath } from "next/cache";
import { authorize, CLIENT_ROLES } from "@/server/shared/authorize";
import { updateClientProfile, markPasswordSet } from "@/server/client/settings";
import type { ProfileInput } from "@/server/client/dto/settings";
import { toActionError, type ActionResult } from "@/server/shared/http";

/** F-01: own name. */
export async function updateProfileAction(input: ProfileInput): Promise<ActionResult<{ name: string }>> {
  try {
    const ctx = await authorize({ roles: CLIENT_ROLES });
    const r = await updateClientProfile(ctx, input);
    revalidatePath("/app/settings");
    revalidatePath("/app");
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

/** Called after the Better Auth client changed the password successfully; clears the invite state. */
export async function passwordChangedAction(): Promise<ActionResult<undefined>> {
  try {
    const ctx = await authorize({ roles: CLIENT_ROLES });
    await markPasswordSet(ctx);
    revalidatePath("/app/settings");
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}

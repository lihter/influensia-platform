"use server";
import { revalidatePath } from "next/cache";
import { authorize } from "@/server/shared/authorize";
import { inviteUser, type InviteUserInput } from "@/server/ops/admin";
import { toActionError, type ActionResult } from "@/server/shared/http";

/**
 * Admin creates accounts (D-02): org (when new) + membership + user with a temporary password + `auth_invite` outbox row.
 * Returns the temp password in local mode so the admin can hand it over (no email is sent).
 */
export async function inviteUserAction(input: InviteUserInput): Promise<ActionResult<{ userId: string; orgId: string; tempPassword: string; inviteToken: string }>> {
  try {
    const ctx = await authorize({ roles: ["admin"] });
    const r = await inviteUser(ctx, input);
    revalidatePath("/ops/clients");
    return { ok: true, data: { userId: r.userId, orgId: r.orgId, tempPassword: r.tempPassword, inviteToken: r.inviteToken } };
  } catch (e) {
    return toActionError(e);
  }
}

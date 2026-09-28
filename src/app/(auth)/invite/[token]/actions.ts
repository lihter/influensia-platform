"use server";
import { z } from "zod";
import { acceptInvite } from "@/server/shared/account-password";
import { NewPasswordSchema } from "@/server/client/dto/settings";

const Input = z.object({ token: z.string().min(16).max(200), password: NewPasswordSchema });

/** QA-09: the invitation link sets the user's own password (token consumed; the temporary password stops working). */
export async function acceptInviteAction(raw: { token: string; password: string }): Promise<{ ok: true } | { ok: false; message: string }> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the password" };
  const r = await acceptInvite(parsed.data.token, parsed.data.password);
  return r.ok ? { ok: true } : { ok: false, message: "This invitation link has expired or was already used. Ask your Influensia contact for a new one." };
}

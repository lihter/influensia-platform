"use server";
import { z } from "zod";
import { resetPasswordWithToken } from "@/server/shared/account-password";
import { NewPasswordSchema } from "@/server/client/dto/settings";

const Input = z.object({ token: z.string().min(10).max(200), password: NewPasswordSchema });

/** QA-09: Better Auth `resetPassword` (token consumed, sessions revoked); passwordSetAt stamped by the onPasswordReset hook. */
export async function resetPasswordAction(raw: { token: string; password: string }): Promise<{ ok: true } | { ok: false; message: string }> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the password" };
  const r = await resetPasswordWithToken(parsed.data.token, parsed.data.password);
  return r.ok ? { ok: true } : { ok: false, message: "This reset link has expired or was already used. Ask for a new one." };
}

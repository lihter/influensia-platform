"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requestPasswordReset } from "@/server/shared/account-password";

const Input = z.object({ email: z.string().trim().min(3).max(200) });

/** F-01 / QA-09: real reset — Better Auth issues a 1-hour token and we email `/reset-password?token=…` through the outbox. Never discloses whether the address exists. */
export async function forgotPasswordAction(formData: FormData) {
  const parsed = Input.safeParse({ email: formData.get("email") });
  if (parsed.success) await requestPasswordReset(parsed.data.email);
  redirect("/forgot-password?sent=1");
}

"use server";
import { redirect } from "next/navigation";
import { z } from "zod";

const Input = z.object({ email: z.string().trim().min(1) });

/** Stub (F-01): validates, never discloses whether the address exists, writes nothing. */
export async function forgotPasswordAction(formData: FormData) {
  Input.parse({ email: formData.get("email") });
  redirect("/forgot-password?sent=1");
}

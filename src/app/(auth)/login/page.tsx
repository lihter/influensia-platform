import { redirect } from "next/navigation";
import { currentCtx, doorFor } from "@/server/shared/authorize";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; password?: string }> }) {
  const ctx = await currentCtx();
  const { next, password } = await searchParams;
  if (ctx) redirect(next && next.startsWith(doorFor(ctx.role)) ? next : doorFor(ctx.role));
  return <LoginForm next={next ?? null} notice={password === "set" ? "Password saved — sign in with your new password." : null} />;
}

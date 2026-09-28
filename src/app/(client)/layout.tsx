import { redirect } from "next/navigation";
import { currentCtx, isClient, isOps } from "@/server/shared/authorize";
import { AppShell } from "@/components/app/app-shell";

export const dynamic = "force-dynamic";

/** Client door: clients only. Agents/admins are redirected to /ops (SPEC 1.2); no session → /login. */
export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const ctx = await currentCtx();
  if (!ctx) redirect("/login?next=%2Fapp");
  if (isOps(ctx)) redirect("/ops");
  if (!isClient(ctx)) redirect("/login");
  return <AppShell user={{ name: ctx.name, email: ctx.email }}>{children}</AppShell>;
}

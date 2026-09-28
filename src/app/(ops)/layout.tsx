import { notFound, redirect } from "next/navigation";
import { currentCtx, isOps } from "@/server/shared/authorize";
import { getOpsDashboard } from "@/server/ops/dashboard";
import { OpsShell } from "@/components/ops/ops-shell";

export const dynamic = "force-dynamic";

/** Ops door: agent|admin only. A client hitting /ops gets 404 — the existence of ops is not disclosed (SPEC 1.2). */
export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await currentCtx();
  if (!ctx) redirect("/login?next=%2Fops");
  if (!isOps(ctx)) notFound();
  const dash = await getOpsDashboard(ctx).catch(() => null);
  return (
    <OpsShell user={{ name: ctx.name, email: ctx.email, role: ctx.role }} counts={{ stale: dash?.counts.stale, queue: dash?.counts.unassigned }}>
      {children}
    </OpsShell>
  );
}

import { redirect } from "next/navigation";
import { currentCtx, doorFor } from "@/server/shared/authorize";

export const dynamic = "force-dynamic";

/** SPEC §2.1 `/`: no session → /login; client → /app; agent/admin → /ops. */
export default async function Root() {
  const ctx = await currentCtx();
  redirect(ctx ? doorFor(ctx.role) : "/login");
}

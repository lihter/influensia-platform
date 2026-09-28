import { NextResponse } from "next/server";
import { drain, localSender } from "@/server/shared/outbox";
import { route } from "@/server/shared/http";

export const runtime = "nodejs";

/** Vercel Cron (every minute) → drain(). Locally: `curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/outbox`. */
export const GET = route(async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "E_UNAUTHORIZED" }, { status: 401 });
  const r = await drain(localSender); // resendSender when RESEND_API_KEY is set — known gap, see FOUNDATION.md
  return NextResponse.json(r);
});

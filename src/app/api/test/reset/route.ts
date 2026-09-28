import { NextResponse } from "next/server";
import { resetToSnapshot, testResetEnabled } from "@/server/shared/test-reset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** E2E-only (E2E_RESET=1): restore the seeded snapshot. 404 in every other environment. */
export async function POST() {
  if (!testResetEnabled()) return new NextResponse("not found", { status: 404 });
  await resetToSnapshot();
  return NextResponse.json({ ok: true });
}

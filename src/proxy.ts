import { NextResponse, type NextRequest } from "next/server";

/**
 * Next 16 proxy (was middleware): optimistic cookie check only — no db, edge-safe.
 * Real authorization happens in (client)/layout, (ops)/layout and every action/repository (ARCHITECTURE §5.5).
 */
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const protectedPath = pathname === "/app" || pathname.startsWith("/app/") || pathname === "/ops" || pathname.startsWith("/ops/");
  if (!protectedPath) return NextResponse.next();
  const hasSession = req.cookies.getAll().some((c) => c.name.includes("better-auth.session_token") && c.value.length > 0);
  if (hasSession) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/app/:path*", "/ops/:path*"] };

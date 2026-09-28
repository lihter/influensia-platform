import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/server";

export const runtime = "nodejs";

/** SPEC §2.1 `/logout`: clears the session and returns to /login. GET (link) and POST (form) both work. */
async function handler(req: Request) {
  const auth = await getAuth();
  const res = await auth.api.signOut({ headers: req.headers, asResponse: true }).catch(() => null);
  const redirect = NextResponse.redirect(new URL("/login", req.url), 303);
  for (const c of res?.headers.getSetCookie() ?? []) redirect.headers.append("set-cookie", c);
  // belt and braces: expire the session cookie even if sign-out failed (already signed out)
  if (!res) redirect.cookies.set("better-auth.session_token", "", { maxAge: 0, path: "/" });
  return redirect;
}
export { handler as GET, handler as POST };

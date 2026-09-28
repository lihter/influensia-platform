import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth/server";

export const runtime = "nodejs";

// auth is created lazily (db is async), so wrap each verb.
async function handler(req: Request) {
  const auth = await getAuth();
  const { GET, POST } = toNextJsHandler(auth);
  return req.method === "POST" ? POST(req) : GET(req);
}
export { handler as GET, handler as POST };

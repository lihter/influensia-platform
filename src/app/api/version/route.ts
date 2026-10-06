/**
 * GET /api/version → { sha } — the git commit this server runs (baked into the image by deploy/update.sh).
 * Public on purpose: GitHub Actions polls it through Cloudflare to confirm a release went live. Reveals nothing else.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ sha: process.env.GIT_SHA ?? "dev" }, { headers: { "cache-control": "no-store" } });
}

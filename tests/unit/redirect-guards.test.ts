import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Behind Cloudflare Tunnel `req.url` is the bind address (http://0.0.0.0:3000) — never build redirect targets from it. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

describe("redirect guards", () => {
  it("no redirect is built from req.url / request.url", () => {
    const offenders = files(path.join(__dirname, "../../src")).filter((f) =>
      /NextResponse\.redirect\(\s*new URL\([^)]*\b(req|request)\.url/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

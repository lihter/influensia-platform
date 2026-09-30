import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Tailwind/Lightning CSS compiles `[border-image:none]` to an empty declaration (`border-image: ;`), which browsers
 *  drop — so a rail's full-bleed band keeps painting over the main column (content "disappears"). Use
 *  `[border-image-source:none]` instead. Regression guard for the 2026-09-29 "empty spec / supplier page" bug. */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}

describe("css guards", () => {
  it("never uses the [border-image:none] arbitrary utility", () => {
    const offenders = walk(path.resolve(__dirname, "../../src")).filter((f) => readFileSync(f, "utf8").includes("[border-image:none]"));
    expect(offenders).toEqual([]);
  });
});

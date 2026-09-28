import { describe, it, expect } from "vitest";
import en from "../../messages/en.json";

/** SPEC 5.3 messages test: no client-facing string mentions organisation/supplier/factory (allowlisted keys aside). */
const ALLOW = new Set(["app.range.label", "milestone.finding_factory", "common.factory", "common.factoryTooltip"]);
const FORBIDDEN = /organisation|organization|supplier|factory/i;

function walk(obj: unknown, path: string, out: [string, string][]) {
  if (typeof obj === "string") out.push([path, obj]);
  else if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj)) walk(v, path ? `${path}.${k}` : k, out);
}

describe("messages/en.json vocabulary", () => {
  it("app.*, waiting.*, milestone.* and nav.app.* never say organisation/supplier/factory", () => {
    const out: [string, string][] = [];
    walk({ app: en.app, waiting: en.waiting, milestone: en.milestone, nav: { app: en.nav.app }, common: { factory: en.common.factory, factoryTooltip: en.common.factoryTooltip } }, "", out);
    const bad = out.filter(([k, v]) => FORBIDDEN.test(v) && !ALLOW.has(k) && !/^waiting\.ops\./.test(k));
    expect(bad).toEqual([]);
  });
  it("has every state, milestone and exception label", () => {
    expect(Object.keys(en.state).length).toBe(24);
    expect(Object.keys(en.milestone.sub).length).toBeGreaterThanOrEqual(24);
    expect(Object.keys(en.exception.client).length).toBe(7);
  });
});

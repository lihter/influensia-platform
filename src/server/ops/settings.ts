/**
 * Ops settings (/ops/settings): agency profile, pricing rules (margin/fee/uplift by category) and the FX rate viewer.
 * Reads for every ops role; edits admin-only (SPEC §1.4 — pricing_rules CRU admin, R agent).
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { getDb } from "@/db";
import { organizations, pricingRules, fxRates } from "@/db/schema/app";
import { PRODUCT_CATEGORIES, type ActivityType } from "@/db/enums";
import { type Ctx, isOps, isAdmin, Forbidden, NotFound } from "@/server/shared/authorize";
import { logActivity } from "@/server/shared/activity";
import { now } from "@/server/shared/clock";
import { agencyOrg } from "@/server/shared/users";

export const RULE_CATEGORIES = [...PRODUCT_CATEGORIES, "default"] as const;

export const PricingRuleInput = z.object({
  category: z.enum(RULE_CATEGORIES),
  marginPct: z.coerce.number().min(0, "0–100").max(100, "0–100"),
  feePct: z.coerce.number().min(0, "0–100").max(100, "0–100"),
  upliftPct: z.coerce.number().min(0, "0–100").max(100, "0–100"),
  rounding: z.coerce.number().int().min(0).max(6).default(2),
});
export type PricingRuleInput = z.input<typeof PricingRuleInput>;

export const AgencyProfileInput = z.object({
  name: z.string().trim().min(1, "Required").max(120),
  country: z.string().trim().length(2, "Use a 2-letter country code").transform((s) => s.toUpperCase()),
  timezone: z.string().trim().min(1, "Required").max(64),
  defaultIncoterm: z.string().trim().min(3).max(3).transform((s) => s.toUpperCase()),
});
export type AgencyProfileInput = z.input<typeof AgencyProfileInput>;

export type PricingRuleRow = { id: string; category: string; marginPct: number; feePct: number; upliftPct: number; rounding: number; updatedAt: string };
export type FxRateRow = { id: string; date: string; base: string; quote: string; rate: number; source: string | null };
export type AgencySettings = {
  org: { id: string; name: string; country: string | null; timezone: string; defaultIncoterm: string; currencyDisplay: string };
  /** Local mode: no email is transmitted; the sender identity is env-configured (EMAIL_FROM) and read-only here. */
  emailSender: string;
  localMode: boolean;
  pricingRules: PricingRuleRow[];
  fxRates: FxRateRow[];
};

/** Pure: the worked example shown next to the rule editor (factory $1.00 → what the client sees). */
export function ruleExample(rule: { marginPct: number; feePct: number; upliftPct: number }, factoryUnitMinorE2 = 10000) {
  const uplifted = factoryUnitMinorE2 * (1 + rule.upliftPct / 100); // internal target buffer
  const allIn = Math.round(factoryUnitMinorE2 * (1 + rule.marginPct / 100)); // all_in display: factory + margin
  const fee = Math.round(factoryUnitMinorE2 * (rule.feePct / 100)); // factory_plus_fee display: fee on top
  return { upliftedE2: Math.round(uplifted), allInE2: allIn, feeE2: fee };
}

const EVENT_PRICING: ActivityType = "pricing_rule_saved";
const EVENT_ORG: ActivityType = "org_updated";

export async function getAgencySettings(ctx: Ctx): Promise<AgencySettings> {
  if (!isOps(ctx)) throw new Forbidden("ops only");
  const db = await getDb();
  const org = await agencyOrg(db);
  if (!org) throw new NotFound("agency organisation missing");
  const [rules, fx] = await Promise.all([
    db.select().from(pricingRules).where(isNull(pricingRules.deletedAt)).orderBy(pricingRules.category),
    db.select().from(fxRates).orderBy(desc(fxRates.date), fxRates.base, fxRates.quote).limit(100),
  ]);
  const sorted = [...rules].sort((a, b) => (a.category === "default" ? 1 : b.category === "default" ? -1 : a.category.localeCompare(b.category)));
  return {
    org: { id: org.id, name: org.name, country: org.country, timezone: org.timezone, defaultIncoterm: org.defaultIncoterm, currencyDisplay: org.currencyDisplay },
    emailSender: process.env.EMAIL_FROM ?? "Influensia <notifications@influensia.ro>",
    localMode: !process.env.RESEND_API_KEY,
    pricingRules: sorted.map((r) => ({ id: r.id, category: r.category, marginPct: r.marginPct, feePct: r.feePct, upliftPct: r.upliftPct, rounding: r.rounding, updatedAt: r.updatedAt.toISOString() })),
    fxRates: fx.map((r) => ({ id: r.id, date: r.date, base: r.base, quote: r.quote, rate: r.rate, source: r.source })),
  };
}

export async function updateAgencyProfile(ctx: Ctx, raw: AgencyProfileInput): Promise<void> {
  if (!isAdmin(ctx)) throw new Forbidden("admin only");
  const input = AgencyProfileInput.parse(raw);
  const db = await getDb();
  const org = await agencyOrg(db);
  if (!org) throw new NotFound("agency organisation missing");
  const at = now();
  await db.transaction(async (tx) => {
    await tx.update(organizations).set({ name: input.name, country: input.country, timezone: input.timezone, defaultIncoterm: input.defaultIncoterm, updatedAt: at }).where(eq(organizations.id, org.id));
    await logActivity(tx, { orgId: org.id, entityType: "organization", entityId: org.id, type: EVENT_ORG, actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { text: `Agency profile updated — ${input.name} (${input.country}), ${input.timezone}, ${input.defaultIncoterm}` } });
  });
}

/** Upsert by category (unique). Changing a rule affects new offers only. */
export async function savePricingRule(ctx: Ctx, raw: PricingRuleInput): Promise<{ id: string; created: boolean }> {
  if (!isAdmin(ctx)) throw new Forbidden("admin only");
  const input = PricingRuleInput.parse(raw);
  const db = await getDb();
  const org = await agencyOrg(db);
  if (!org) throw new NotFound("agency organisation missing");
  const at = now();
  const [existing] = await db.select().from(pricingRules).where(eq(pricingRules.category, input.category)).limit(1);
  return db.transaction(async (tx) => {
    let id: string;
    if (existing) {
      id = existing.id;
      await tx.update(pricingRules).set({ marginPct: input.marginPct, feePct: input.feePct, upliftPct: input.upliftPct, rounding: input.rounding, deletedAt: null, updatedAt: at }).where(eq(pricingRules.id, id));
    } else {
      id = uuidv7();
      await tx.insert(pricingRules).values({ id, scope: "category", category: input.category, marginPct: input.marginPct, feePct: input.feePct, upliftPct: input.upliftPct, rounding: input.rounding, createdBy: ctx.userId, createdAt: at, updatedAt: at });
    }
    const before = existing && !existing.deletedAt ? `${existing.marginPct}/${existing.feePct}/${existing.upliftPct}` : "—";
    await logActivity(tx, { orgId: org.id, entityType: "organization", entityId: org.id, type: EVENT_PRICING, actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { category: input.category, marginPct: input.marginPct, feePct: input.feePct, upliftPct: input.upliftPct, text: `Pricing rule ${input.category}: margin/fee/uplift ${before} → ${input.marginPct}/${input.feePct}/${input.upliftPct} %` } });
    return { id, created: !existing || !!existing.deletedAt };
  });
}

/** Soft-delete a category rule; `default` cannot be removed (it is the fallback for every uncategorised product). */
export async function deletePricingRule(ctx: Ctx, id: string): Promise<void> {
  if (!isAdmin(ctx)) throw new Forbidden("admin only");
  const db = await getDb();
  const org = await agencyOrg(db);
  if (!org) throw new NotFound("agency organisation missing");
  const [r] = await db.select().from(pricingRules).where(and(eq(pricingRules.id, id), isNull(pricingRules.deletedAt))).limit(1);
  if (!r) throw new NotFound("pricing rule not found");
  if (r.category === "default") throw new Forbidden("the default rule cannot be removed");
  const at = now();
  await db.transaction(async (tx) => {
    await tx.update(pricingRules).set({ deletedAt: at, updatedAt: at }).where(eq(pricingRules.id, id));
    await logActivity(tx, { orgId: org.id, entityType: "organization", entityId: org.id, type: EVENT_PRICING, actorId: ctx.userId, actorName: ctx.name, visibility: "internal", at, payload: { category: r.category, removed: true, text: `Pricing rule ${r.category} removed — products in this category now use "default"` } });
  });
}

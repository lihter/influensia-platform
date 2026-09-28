"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/server/shared/authorize";
import { updateAgencyProfile, savePricingRule, deletePricingRule, type AgencyProfileInput, type PricingRuleInput } from "@/server/ops/settings";
import { toActionError, type ActionResult } from "@/server/shared/http";

export async function updateAgencyProfileAction(input: AgencyProfileInput): Promise<ActionResult<undefined>> {
  try {
    const ctx = await authorize({ roles: ["admin"] });
    await updateAgencyProfile(ctx, input);
    revalidatePath("/ops/settings");
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}

/** Upsert a pricing rule by category (admin). Affects new offers only. */
export async function savePricingRuleAction(input: PricingRuleInput): Promise<ActionResult<{ id: string; created: boolean }>> {
  try {
    const ctx = await authorize({ roles: ["admin"] });
    const r = await savePricingRule(ctx, input);
    revalidatePath("/ops/settings");
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

const Id = z.object({ id: z.uuid() });

export async function deletePricingRuleAction(raw: { id: string }): Promise<ActionResult<undefined>> {
  try {
    const ctx = await authorize({ roles: ["admin"] });
    const { id } = Id.parse(raw);
    await deletePricingRule(ctx, id);
    revalidatePath("/ops/settings");
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}

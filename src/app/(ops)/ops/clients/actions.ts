"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/server/shared/authorize";
import type { InviteUserInput } from "@/server/ops/admin";
import {
  createClient, addClientUser, updateClientSettings, deactivateUser, reactivateUser, resendInvite, inviteAsAdmin,
  type CreateClientInput, type AddClientUserInput, type ClientSettingsInput,
} from "@/server/ops/clients";
import { toActionError, type ActionResult } from "@/server/shared/http";

const clientPaths = (orgId?: string) => { revalidatePath("/ops/clients"); if (orgId) revalidatePath(`/ops/clients/${orgId}`); };

/**
 * Admin creates accounts (D-02): org (when new) + membership + user with a temporary password + `auth_invite` outbox row.
 * Returns the temp password in local mode so the admin can hand it over (no email is sent).
 */
export async function inviteUserAction(input: InviteUserInput): Promise<ActionResult<{ userId: string; orgId: string; tempPassword: string; inviteToken: string }>> {
  try {
    const ctx = await authorize({ roles: ["admin"] });
    const r = await inviteAsAdmin(ctx, input);
    clientPaths(r.orgId);
    return { ok: true, data: { userId: r.userId, orgId: r.orgId, tempPassword: r.tempPassword, inviteToken: r.inviteToken } };
  } catch (e) {
    return toActionError(e);
  }
}

export type CreatedClient = { orgId: string; userId: string; email: string; tempPassword: string; inviteToken: string };

/** F-26 "+ Client": new org + first client_owner in one form (AC-CLI-04). */
export async function createClientAction(input: CreateClientInput): Promise<ActionResult<CreatedClient>> {
  try {
    const ctx = await authorize({ roles: ["admin"] });
    const r = await createClient(ctx, input);
    clientPaths(r.orgId);
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

/** F-26 "Invite user" on an existing client (AC-CLI-02); role is fixed client_owner. */
export async function addClientUserAction(input: AddClientUserInput): Promise<ActionResult<Omit<CreatedClient, "orgId">>> {
  try {
    const ctx = await authorize({ roles: ["admin"] });
    const r = await addClientUser(ctx, input);
    clientPaths(input.orgId);
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

const OrgId = z.object({ orgId: z.uuid() });

export async function updateClientSettingsAction(raw: { orgId: string } & ClientSettingsInput): Promise<ActionResult<{ changed: string[] }>> {
  try {
    const ctx = await authorize({ roles: ["admin"] });
    const { orgId } = OrgId.parse(raw);
    const r = await updateClientSettings(ctx, orgId, raw);
    clientPaths(orgId);
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

const UserRef = z.object({ orgId: z.uuid(), userId: z.string().min(1) });

export async function deactivateUserAction(raw: { orgId: string; userId: string }): Promise<ActionResult<undefined>> {
  try {
    const ctx = await authorize({ roles: ["admin"] });
    const { orgId, userId } = UserRef.parse(raw);
    await deactivateUser(ctx, userId);
    clientPaths(orgId);
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}

export async function reactivateUserAction(raw: { orgId: string; userId: string }): Promise<ActionResult<undefined>> {
  try {
    const ctx = await authorize({ roles: ["admin"] });
    const { orgId, userId } = UserRef.parse(raw);
    await reactivateUser(ctx, userId);
    clientPaths(orgId);
    return { ok: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}

export async function resendInviteAction(raw: { orgId: string; userId: string }): Promise<ActionResult<{ inviteToken: string; expiresAt: string }>> {
  try {
    const ctx = await authorize({ roles: ["admin"] });
    const { orgId, userId } = UserRef.parse(raw);
    const r = await resendInvite(ctx, userId);
    clientPaths(orgId);
    revalidatePath("/ops/outbox");
    return { ok: true, data: r };
  } catch (e) {
    return toActionError(e);
  }
}

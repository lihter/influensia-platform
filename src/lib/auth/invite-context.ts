import { AsyncLocalStorage } from "node:async_hooks";
import type { Role, OrgType } from "@/db/enums";

/**
 * D-02: there is no public sign-up. `auth.api.signUpEmail` only succeeds when it runs inside
 * `inviteContext.run(...)` — the seed and `inviteUser()` set it; a raw POST /api/auth/sign-up/email never has it,
 * so the `user.create.before` hook rejects it. The context also tells the org hook WHICH org to attach the user to.
 */
export type InviteContext = {
  role: Role;
  /** Attach to an existing app organization (by app org id). When absent a new org is created. */
  orgId?: string;
  /** For a new organization. */
  newOrg?: { name: string; type: OrgType; country?: string | null; timezone?: string | null };
  /** Timestamp for created_at (seeding). */
  at?: Date;
};

/**
 * Lives on globalThis: under Turbopack HMR this module can be re-evaluated while `getAuth()` (and its hooks) stay cached,
 * which would otherwise leave the hooks reading a different AsyncLocalStorage instance than the caller writes to.
 */
type G = { __influensiaInviteContext?: AsyncLocalStorage<InviteContext> };
const g = globalThis as unknown as G;
export const inviteContext: AsyncLocalStorage<InviteContext> = (g.__influensiaInviteContext ??= new AsyncLocalStorage<InviteContext>());

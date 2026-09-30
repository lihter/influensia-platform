import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { Db } from "@/db";
import * as authSchema from "@/db/schema/auth";
import { organizations, users } from "@/db/schema/app";
import { inviteContext } from "./invite-context";

/**
 * Better Auth needs a db instance at construction time. Because our db is async (PGlite create + migrations)
 * we build the auth instance lazily and cache it on globalThis (see getAuth()).
 */
export function createAuth(db: Db) {
  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    secret: process.env.BETTER_AUTH_SECRET ?? "dev-only-secret-change-me-0123456789abcdef0123456789",
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
    emailAndPassword: {
      enabled: true, minPasswordLength: 8, autoSignIn: false, // invites must never switch the admin's session
      // QA-09: real reset flow — token in `verification`, email through the outbox (local mode: .data/outbox.log)
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        const { enqueuePasswordResetEmail } = await import("@/server/shared/account-password");
        await enqueuePasswordResetEmail(user, token);
      },
      onPasswordReset: async ({ user }) => {
        const { markPasswordSetById } = await import("@/server/shared/account-password");
        await markPasswordSetById(db, user.id, "reset");
      },
    },
    // Better Auth's built-in limiter is on in production by default (sign-in: 3 / 10 s per IP). The e2e suite signs in
    // dozens of times from one IP, so playwright.config.ts sets AUTH_RATE_LIMIT=off; never set it in a real deployment.
    ...(process.env.AUTH_RATE_LIMIT === "off" ? { rateLimit: { enabled: false } } : {}),
    // Behind a proxy the client IP arrives in a header. AUTH_IP_HEADERS="cf-connecting-ip" behind Cloudflare Tunnel
    // (the app has no public port, so only Cloudflare can set it). Unset = Better Auth default (x-forwarded-for).
    ...(process.env.AUTH_IP_HEADERS ? { advanced: { ipAddress: { ipAddressHeaders: process.env.AUTH_IP_HEADERS.split(",").map((h) => h.trim().toLowerCase()) } } } : {}),
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days (D-02)
      updateAge: 60 * 60 * 24,
    },
    databaseHooks: {
      user: {
        create: {
          // Invite-only (D-02): a user row can only be created from inside inviteContext.run(...).
          before: async (user) => {
            const inv = inviteContext.getStore();
            if (!inv) throw new APIError("FORBIDDEN", { message: "Sign-up is invite-only. Ask your Influensia contact for an invitation." });
            return { data: { ...user, ...(inv.at ? { createdAt: inv.at, updatedAt: inv.at } : {}) } };
          },
          // D-03: membership + app.users profile; a new organisation when the invite says so. The UI never shows the org.
          after: async (user) => {
            const inv = inviteContext.getStore();
            if (!inv) return;
            const at = inv.at ?? new Date();
            let appOrgId = inv.orgId;
            let authOrgId: string | null = null;
            if (appOrgId) {
              const [o] = await db.select({ authOrgId: organizations.authOrgId }).from(organizations).where(eq(organizations.id, appOrgId)).limit(1);
              if (!o) throw new Error(`organization ${appOrgId} not found`);
              authOrgId = o.authOrgId;
            }
            if (!authOrgId) {
              authOrgId = crypto.randomUUID();
              const name = inv.newOrg?.name ?? user.email.split("@")[1] ?? "New client";
              const slug = `org-${authOrgId.slice(0, 8)}`;
              await db.insert(authSchema.organization).values({ id: authOrgId, name, slug, createdAt: at });
              if (appOrgId) {
                await db.update(organizations).set({ authOrgId }).where(eq(organizations.id, appOrgId));
              } else {
                appOrgId = uuidv7();
                await db.insert(organizations).values({
                  id: appOrgId, type: inv.newOrg?.type ?? "client", name, country: inv.newOrg?.country ?? null,
                  timezone: inv.newOrg?.timezone ?? "Europe/Warsaw", authOrgId, createdBy: user.id, createdAt: at, updatedAt: at,
                });
              }
            }
            await db.insert(authSchema.member).values({ id: crypto.randomUUID(), organizationId: authOrgId, userId: user.id, role: inv.role, createdAt: at });
            await db.insert(users).values({ id: user.id, orgId: appOrgId!, email: user.email, name: user.name, passwordSetAt: null, createdBy: user.id, createdAt: at, updatedAt: at });
          },
        },
      },
    },
    plugins: [organization(), nextCookies()], // nextCookies must be last
  });
}

export type Auth = ReturnType<typeof createAuth>;

type AuthGlobal = { __influensiaAuth?: Promise<Auth> };
const g = globalThis as unknown as AuthGlobal;

export async function getAuth(): Promise<Auth> {
  if (!g.__influensiaAuth) {
    g.__influensiaAuth = (async () => {
      const { getDb } = await import("@/db");
      return createAuth(await getDb());
    })();
  }
  return g.__influensiaAuth;
}

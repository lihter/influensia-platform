/**
 * Fresh 7-day set-password link for ANY existing user (agents and admins included) — the fallback while email is off:
 *   docker compose … exec -T app npm run -s user:link -- bogdan@influensia.ro
 * Opening the link lets the person choose a new password (existing sessions are signed out).
 */
import { randomBytes, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema/app";

async function main() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!email) { console.error("usage: npm run -s user:link -- <email>"); process.exit(2); }
  const db = await getDb();
  const [u] = await db.select({ id: users.id, deactivatedAt: users.deactivatedAt }).from(users).where(eq(users.email, email)).limit(1);
  if (!u) { console.error(`no user ${email}`); process.exit(1); }
  if (u.deactivatedAt) { console.error(`${email} is deactivated`); process.exit(1); }
  const token = randomBytes(24).toString("base64url");
  const expires = new Date(Date.now() + 7 * 86_400_000);
  await db.update(users).set({ inviteTokenHash: createHash("sha256").update(token).digest("hex"), inviteExpiresAt: expires, updatedAt: new Date() }).where(eq(users.id, u.id));
  const origin = (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  console.log(`${email}  ${origin}/invite/${token}  (valid until ${expires.toISOString().slice(0, 10)})`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

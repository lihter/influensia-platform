/**
 * Config used ONLY by `npx @better-auth/cli generate`.
 * The CLI needs a synchronous `auth` export; it never queries the db, so an
 * in-memory PGlite instance (sync constructor, lazy init) is enough.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";

const db = drizzle(new PGlite());

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: { enabled: true },
  plugins: [organization()],
});

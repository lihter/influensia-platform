import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/db/schema/app.ts", "./src/db/schema/supplier.ts", "./src/db/schema/auth.ts"],
  out: "./drizzle",
  // Only drizzle-kit's migrate/push/studio need a live connection; `generate` does not.
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://unused:unused@localhost:5432/unused" },
  schemaFilter: ["public", "app", "supplier"],
  strict: true,
  verbose: true,
});

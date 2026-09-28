import path from "node:path";
import type { Db } from "./index";

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/**
 * Applies pending drizzle-kit migrations for whichever driver is active.
 * Both migrators read the same ./drizzle folder (meta/_journal.json + *.sql).
 */
export async function runMigrations(db: Db): Promise<void> {
  if (process.env.DATABASE_URL) {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  }
}

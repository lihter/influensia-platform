import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import * as appSchema from "./schema/app";
import * as supplierSchema from "./schema/supplier";
import * as authSchema from "./schema/auth";

export const schema = { ...appSchema, ...supplierSchema, ...authSchema };
export type Schema = typeof schema;

/** One type for both drivers: everything the app uses is on PgDatabase. */
export type Db = PostgresJsDatabase<Schema> | PgliteDatabase<Schema>;

export const PGLITE_DIR = process.env.PGLITE_DIR ?? "./.data/pglite";

type DbGlobal = {
  __influensiaDb?: Db;
  __influensiaDbReady?: Promise<Db>;
};
const g = globalThis as unknown as DbGlobal;

async function createDb(): Promise<Db> {
  if (process.env.DATABASE_URL) {
    const { default: postgres } = await import("postgres");
    const client = postgres(process.env.DATABASE_URL, { max: 10, prepare: false });
    return drizzlePg(client, { schema });
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(PGLITE_DIR, { recursive: true }); // PGlite's nodefs mkdir is not recursive
  const client = await PGlite.create({ dataDir: PGLITE_DIR });
  return drizzlePglite(client, { schema });
}

/**
 * Singleton that survives Next.js HMR (module re-evaluation) via globalThis.
 * Also runs pending migrations once per process (see ./migrate).
 */
export async function getDb(): Promise<Db> {
  if (g.__influensiaDb) return g.__influensiaDb;
  if (!g.__influensiaDbReady) {
    g.__influensiaDbReady = (async () => {
      const db = await createDb();
      const { runMigrations } = await import("./migrate");
      await runMigrations(db);
      g.__influensiaDb = db;
      return db;
    })();
  }
  return g.__influensiaDbReady;
}

/** A transaction handle from `db.transaction(async (tx) => …)` on either driver. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything you can run queries on. Repositories accept this so they compose inside transactions. */
export type DbOrTx = Db | Tx;

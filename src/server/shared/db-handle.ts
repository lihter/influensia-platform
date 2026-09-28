/** Thin re-export so route files (which may not import "@/db" — lint rule) can hand a db to shared helpers. */
import { getDb } from "@/db";
export const getDbHandle = getDb;

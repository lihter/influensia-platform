/**
 * E2E-only: restore the freshly seeded data dir so every Playwright spec file starts from the SPEC §7 seed.
 * Enabled only when the server was started with E2E_RESET=1 and E2E_SNAPSHOT_DIR (see playwright.config.ts); the
 * route returns 404 otherwise. PGlite only: closes the live instance, swaps the data dir (pglite + files + outbox.log)
 * for a copy of the snapshot, and drops every globalThis singleton that holds the old handle (db, Better Auth).
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { PGLITE_DIR } from "@/db";
import { invalidateLeakSources } from "./leak-check";
import { OUTBOX_LOG } from "./outbox";

type G = { __influensiaDb?: unknown; __influensiaDbReady?: Promise<unknown>; __influensiaAuth?: unknown };

export const testResetEnabled = () => process.env.E2E_RESET === "1" && !!process.env.E2E_SNAPSHOT_DIR && !process.env.DATABASE_URL;

let running: Promise<void> | null = null;

export async function resetToSnapshot(): Promise<void> {
  if (!testResetEnabled()) throw new Error("test reset disabled");
  running ??= (async () => {
    const g = globalThis as unknown as G;
    const current = (await g.__influensiaDbReady?.catch(() => null)) as { $client?: { close?: () => Promise<void> } } | null | undefined;
    delete g.__influensiaDb;
    delete g.__influensiaDbReady;
    delete g.__influensiaAuth;
    await current?.$client?.close?.().catch(() => {});
    const snap = path.resolve(process.env.E2E_SNAPSHOT_DIR!);
    const targets: Array<[string, string]> = [
      [path.join(snap, "pglite"), path.resolve(PGLITE_DIR)],
      [path.join(snap, "files"), path.resolve(/*turbopackIgnore: true*/ process.env.FILES_DIR ?? path.join(process.cwd(), ".data", "files"))],
      [path.join(snap, "outbox.log"), path.resolve(OUTBOX_LOG())],
    ];
    // runtime-only paths (E2E): keep Turbopack's output tracing from pulling in the whole project
    for (const [from, to] of targets) {
      rmSync(/*turbopackIgnore: true*/ to, { recursive: true, force: true });
      if (existsSync(/*turbopackIgnore: true*/ from)) cpSync(/*turbopackIgnore: true*/ from, /*turbopackIgnore: true*/ to, { recursive: true });
    }
    invalidateLeakSources();
  })().finally(() => { running = null; });
  return running;
}

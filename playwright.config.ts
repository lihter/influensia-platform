import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3100);
const dataDir = ".data/e2e";
const snapshotDir = ".data/e2e-snapshot";

/**
 * E2E runs against a dedicated, freshly seeded PGlite dir so the developer's ./.data/pglite is untouched.
 * The seed runs first (PGlite is single-process), is copied to a snapshot, then the server starts on the live dir.
 * Every spec file calls `resetDb()` (tests/e2e/helpers.ts) in `beforeAll` → POST /api/test/reset restores the snapshot
 * in-process (E2E_RESET=1 only), so spec files never see each other's mutations and can run in any order.
 */
const seedAndSnapshot = `npm run db:seed && node -e "const fs=require('fs');fs.rmSync('${snapshotDir}',{recursive:true,force:true});fs.cpSync('${dataDir}','${snapshotDir}',{recursive:true})"`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 }, // first Turbopack compile of a page in dev can exceed 5 s
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  webServer: {
    command: process.env.CI
      ? `${seedAndSnapshot} && npx next build && npx next start -p ${port}`
      : `${seedAndSnapshot} && npx next dev -p ${port}`,
    url: `http://localhost:${port}/login`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      BETTER_AUTH_URL: `http://localhost:${port}`,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-secret-0123456789abcdef0123456789abcdef",
      PGLITE_DIR: `${dataDir}/pglite`,
      FILES_DIR: `${dataDir}/files`,
      OUTBOX_LOG: `${dataDir}/outbox.log`,
      E2E_RESET: "1",
      AUTH_RATE_LIMIT: "off", // `next start` (CI=1) enables Better Auth's per-IP sign-in limiter; the suite logs in ~100×
      E2E_SNAPSHOT_DIR: snapshotDir,
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers",
    },
  },
});

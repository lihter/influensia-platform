import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3100);
const dataDir = ".data/e2e";

/**
 * E2E runs against a dedicated, freshly seeded PGlite dir so the developer's ./.data/pglite is untouched.
 * The seed runs first (PGlite is single-process), then the server starts on the same dir.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 }, // first Turbopack compile of a page in dev can exceed 5 s
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  webServer: {
    command: process.env.CI
      ? `npm run db:seed && npx next build && npx next start -p ${port}`
      : `npm run db:seed && npx next dev -p ${port}`,
    url: `http://localhost:${port}/login`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      BETTER_AUTH_URL: `http://localhost:${port}`,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-secret-0123456789abcdef0123456789abcdef",
      PGLITE_DIR: `${dataDir}/pglite`,
      FILES_DIR: `${dataDir}/files`,
      OUTBOX_LOG: `${dataDir}/outbox.log`,
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers",
    },
  },
});

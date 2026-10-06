# Influensia Sourcing Platform — Engineering Architecture

Version 1.0 · 28 Sep 2026 · Derived from `docs/blueprint.html` (decisions D-01…D-23, T-01…T-14) and a verified spike in `/home/claude/spike`.

Everything in this document was executed, not assumed. Where the spike disagreed with the blueprint, the spike wins and the deviation is called out. Build agents follow this document; the blueprint stays the product source of truth.

---

## 0. Summary of the spike (what was proven)

| # | Goal | Result |
|---|------|--------|
| 1 | `create-next-app@latest` → Next.js 16.3.6, App Router, TS, Tailwind 4, ESLint, `src/`, Turbopack | `next build` passes on the empty app (16.8 s cold) |
| 2 | shadcn/ui CLI 4.21 init + 19 components | Compiles. **`form` is a deprecated empty stub in shadcn v4 → use `field` + react-hook-form `Controller`** |
| 3 | Drizzle 0.45.3 dual driver: `postgres` (postgres-js) when `DATABASE_URL` set, else PGlite 0.5.8 persisted to `./.data/pglite` | Two Postgres schemas (`app`, `supplier`) via `pgSchema`; `drizzle-kit generate` produced one migration; migrations apply at startup on **both** drivers (verified against PGlite and a real Postgres 16.13); server component queries PGlite under Turbopack dev, `next build`, and `next start`; singleton survives HMR |
| 4 | Better Auth 1.7.6 + Drizzle adapter + email/password + organization plugin + `/api/auth/[...all]` | Sign-up, session read, sign-out, sign-in, `organization/list` all work on PGlite (curl) and in Chromium (Playwright). Schema generated with `@better-auth/cli generate` (7 tables). Organization auto-created via `databaseHooks.user.create.after` |
| 5 | zod 4, react-hook-form 7.89, @hookform/resolvers 5.9, TanStack Table 9.2 / Query 5.104, date-fns 4.4, lucide-react 1.48, next-intl 4.14 (no routing), sharp 0.35.5 (EXIF stripped), uuidv7 1.2, vitest 4.1.11, @playwright/test 1.56.1 | All install and build. next-intl kept (single-locale mode is ~20 lines, no friction). Vitest 5 refuses `@types/node@20` → bump to `^22` |
| 6 | Storage adapter (local disk + S3/R2 stub), upload route (re-encode via sharp) + streaming download route | Works; download enforces org prefix + `client|internal` visibility; unauthenticated → 401 |

Full checks at the end of the spike: `lint` ✓ · `typecheck` ✓ · `test:unit` 10/10 ✓ · `build` ✓ · `test:e2e` 1/1 ✓ (Chromium 141 from `/opt/pw-browsers`).

---

## 1. Pinned versions

Install exactly these (the spike's resolved tree). Use `npm` (lockfile committed). **In this container run `npx npm@12 install …`** for any install that touches `@types/*` peers — npm 10.9.7 has an `edgesOut` crash; npm 12 resolves fine.

```json
"dependencies": {
  "@electric-sql/pglite": "0.5.8",
  "@hookform/resolvers": "5.9.1",
  "@tanstack/react-query": "5.104.0",
  "@tanstack/react-table": "9.2.4",
  "better-auth": "1.7.6",
  "class-variance-authority": "0.7.1",
  "cmdk": "1.1.1",
  "cn": "0.4.0",
  "date-fns": "4.4.0",
  "drizzle-orm": "0.45.3",
  "lucide-react": "1.48.0",
  "next": "16.3.6",
  "next-intl": "4.14.7",
  "next-themes": "0.4.6",
  "postgres": "3.4.9",
  "radix-ui": "1.6.7",
  "react": "19.2.8",
  "react-dom": "19.2.8",
  "react-hook-form": "7.89.0",
  "shadcn": "4.21.0",
  "sharp": "0.35.5",
  "sonner": "2.0.8",
  "tw-animate-css": "1.4.0",
  "uuidv7": "1.2.1",
  "zod": "4.6.5"
},
"devDependencies": {
  "@better-auth/cli": "1.4.22",
  "@playwright/test": "1.56.1",
  "@tailwindcss/postcss": "4.3.3",
  "@types/node": "22.20.4",
  "@types/react": "19.3.0",
  "@types/react-dom": "19.3.0",
  "drizzle-kit": "0.31.11",
  "eslint": "9.39.5",
  "eslint-config-next": "16.3.6",
  "tailwindcss": "4.3.3",
  "tsx": "4.23.15",
  "typescript": "5.9.3",
  "vitest": "4.1.11"
}
```

Notes on versions:

- **TypeScript 5.9.3, not 7** — `create-next-app` pins `^5` and `eslint-config-next` 16.3.6 resolves typescript-eslint 8.70 against TS 5.9. Blueprint T-01 said "TypeScript 7"; deviate. Revisit when `eslint-config-next` declares TS 7 support.
- **React 19.2.8** is what Next 16.3.6 pins (App Router bundles its own canary anyway).
- **shadcn v4** installs the `radix-ui` umbrella package (not `@radix-ui/react-*`), a runtime `shadcn` dep (for `shadcn/tailwind.css`), and the tiny `cn` package (`src/lib/utils.ts` re-exports it).
- **Playwright 1.56.1** is pinned because the preinstalled Chromium in this container is revision 1194 (= 1.56.x). In CI use the latest and run `npx playwright install --with-deps chromium`. Do not run `playwright install` in this container.
- **Vitest 4.1.11** (5.x resolves only with npm 12 and adds nothing we need).
- **zod 4** — API differences vs 3 that matter here: `z.uuid()` (not `z.string().uuid()`), `schema.def.catchall` for strictness introspection, `ZodError.issues`.

---

## 2. Bootstrap commands (exact)

```bash
# 1. scaffold (non-interactive)
npx --yes create-next-app@latest influensia-platform \
  --ts --tailwind --eslint --app --src-dir --turbopack \
  --import-alias "@/*" --use-npm --yes
cd influensia-platform
sed -i 's/"@types\/node": "\^20"/"@types\/node": "^22"/' package.json   # vitest peer

# 2. shadcn (v4 CLI: --base radix, preset nova = Lucide/Geist, neutral base colour)
npx --yes shadcn@latest init --yes -b radix --preset nova --no-monorepo
npx --yes shadcn@latest add --yes button card table badge sheet dialog tabs input textarea \
  select field dropdown-menu sonner separator avatar tooltip command label input-group

# 3. runtime deps
npx npm@12 install drizzle-orm@0.45.3 @electric-sql/pglite@0.5.8 postgres@3.4.9 better-auth@1.7.6 \
  zod@4.6.5 react-hook-form@7.89.0 @hookform/resolvers@5.9.1 @tanstack/react-table@9.2.4 \
  @tanstack/react-query@5.104.0 date-fns@4.4.0 sharp@0.35.5 uuidv7@1.2.1 next-intl@4.14.7

# 4. dev deps
npx npm@12 install -D drizzle-kit@0.31.11 vitest@4.1.11 @playwright/test@1.56.1 tsx@4.23.15 @better-auth/cli@1.4.22
```

`shadcn init` writes `components.json` (`style: radix-nova`, `iconLibrary: lucide`, css vars on) and rewrites `src/app/globals.css` (`@import "tailwindcss"; @import "tw-animate-css"; @import "shadcn/tailwind.css";` + theme tokens). Don't hand-edit the token block; extend it.

### Config files

`next.config.ts`
```ts
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // PGlite ships WASM + needs node:fs; sharp and postgres are native/node-only. Keep them out of the bundler.
  serverExternalPackages: ["@electric-sql/pglite", "sharp", "postgres"],
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
};
export default withNextIntl(nextConfig);
```

`drizzle.config.ts`
```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/db/schema/app.ts", "./src/db/schema/supplier.ts", "./src/db/schema/auth.ts"],
  out: "./drizzle",
  // `generate` never connects; migrate/push/studio need a real URL.
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://unused:unused@localhost:5432/unused" },
  schemaFilter: ["public", "app", "supplier"],   // auth tables live in public
  strict: true,
  verbose: true,
});
```

`tsconfig.json` — keep the generated one (`"paths": {"@/*": ["./src/*"]}`, `moduleResolution: bundler`, `strict: true`). Add nothing.

`vitest.config.mts` (must be `.mts` — a `.ts` config triggers a CJS/ESM warning under Vite's native loader)
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node" },
});
```

`playwright.config.ts`
```ts
import { defineConfig } from "@playwright/test";
const port = Number(process.env.E2E_PORT ?? 3100);
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },            // first Turbopack compile of a page in dev can exceed 5 s
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  webServer: {
    command: process.env.CI ? `npx next start -p ${port}` : `npx next dev -p ${port}`,
    url: `http://localhost:${port}`, reuseExistingServer: !process.env.CI, timeout: 120_000,
    env: { BETTER_AUTH_URL: `http://localhost:${port}` },
  },
});
```

`eslint.config.mjs` — the anonymity import boundary (mechanism 1) and the no-raw-db rule, both verified to fire:
```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const boundary = [
  { group: ["@/db/schema/supplier", "**/db/schema/supplier", "**/schema/supplier"], message: "Client code paths may not import the supplier schema (anonymity boundary)." },
  { group: ["@/server/ops", "@/server/ops/*", "**/server/ops/**"], message: "Client code paths may not import ops modules (anonymity boundary)." },
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/server/client/**/*.{ts,tsx}", "src/app/(client)/**/*.{ts,tsx}", "src/components/app/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: boundary }] },
  },
  {
    // repositories only: no raw db in route handlers, pages, layouts or server actions
    files: ["src/app/**/route.ts", "src/app/**/page.tsx", "src/app/**/layout.tsx", "src/app/**/actions.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["@/db", "@/db/*", "@/db/schema/*"], message: "Use a repository in src/server/**; no raw db in route/page/action files." }] }] },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".data/**", "drizzle/**", "test-results/**", "playwright-report/**"]),
]);
```

`.env.local` (dev) / Vercel env (prod)
```
BETTER_AUTH_URL=http://localhost:3000        # MUST equal the origin you actually serve on, or every auth call is 403 INVALID_ORIGIN
BETTER_AUTH_SECRET=<openssl rand -hex 32>
# DATABASE_URL=postgres://...               # unset = PGlite at ./.data/pglite
# PGLITE_DIR=./.data/pglite
# FILES_DIR=./.data/files
# S3_BUCKET= S3_ENDPOINT= S3_REGION=auto S3_ACCESS_KEY_ID= S3_SECRET_ACCESS_KEY=   # set S3_BUCKET to switch storage to R2
# RESEND_API_KEY=                            # unset = local outbox sender (console + ./.data/outbox.log)
# CRON_SECRET=                               # Vercel Cron bearer for /api/cron/outbox
```

`.gitignore` additions: `.data/`, `test-results/`, `playwright-report/`.

---

## 3. Folder structure

```
src/
  proxy.ts                         # Next 16 "proxy" (was middleware): optimistic cookie check + /app|/ops door routing
  i18n/request.ts                  # next-intl single-locale config
  app/
    layout.tsx                     # NextIntlClientProvider + TooltipProvider + Toaster + QueryProvider
    (auth)/sign-in/page.tsx        # public
    (auth)/set-password/page.tsx   # invite landing
    (auth)/reset-password/page.tsx
    (client)/layout.tsx            # authorize({roles: client_*}) → redirect otherwise
    (client)/app/page.tsx          # dashboard: waiting-on-you + new request
    (client)/app/requests/[id]/page.tsx  (+ actions.ts)
    (client)/app/orders/[id]/page.tsx    (+ actions.ts)
    (client)/app/offers/[id]/page.tsx    (+ actions.ts)
    (client)/app/catalog/page.tsx
    (ops)/layout.tsx               # authorize({roles: admin|agent})
    (ops)/ops/page.tsx             # stale / waiting-on-us / waiting-on-client / unassigned
    (ops)/ops/requests/[id]/page.tsx     # request line + sourcing board (+ actions.ts)
    (ops)/ops/orders/[id]/page.tsx
    (ops)/ops/suppliers/**         # supplier db
    (ops)/ops/outbox/page.tsx      # outbox viewer + "drain now"
    (ops)/ops/admin/**             # invite client user, api keys (v1.1)
    api/auth/[...all]/route.ts     # Better Auth
    api/files/upload/route.ts      # multipart upload → storeUpload()
    api/files/[...key]/route.ts    # streaming download, prefix-gated
    api/cron/outbox/route.ts       # Vercel Cron (1 min) → drain()
    api/v1/**                      # automations API (API-key auth), v1.1
  server/
    client/                        # ONLY module (client) routes may import. app schema only. DTO allowlists live here.
      requests.ts  orders.ts  offers.ts  samples.ts  catalog.ts  documents.ts  comments.ts  dashboard.ts
    ops/                           # app + supplier schemas. Sourcing board, quotes, suppliers, publish.
      suppliers.ts  participations.ts  quotes.ts  offers.ts  orders.ts  publish.ts  dashboard.ts  import/
    shared/                        # importable from both sides; never re-exports supplier rows to client code
      authorize.ts  http.ts  ids.ts  money.ts  dates.ts  activity.ts  outbox.ts  state-machine.ts
      leak-check.ts  files.ts  storage/{index,types,local,s3}.ts  email/{sender,templates}.ts
  db/
    schema/app.ts  schema/supplier.ts  schema/auth.ts   index.ts  migrate.ts  seed.ts
  lib/
    auth/server.ts  auth/client.ts  auth/cli-config.ts  utils.ts  query-client.tsx
  components/
    ui/          # shadcn, owned code
    shared/      # MilestoneStepper, Money, DateTime, EmptyState, DataTable (TanStack), FileDrop
    app/         # client-facing composites (bound by the ESLint boundary)
    ops/         # sourcing board, quote form, publish dialog, leak-hit list
messages/en.json
drizzle/                           # generated migrations, committed
scripts/migrate.ts  scripts/outbox-drain.ts
tests/unit/**  tests/e2e/**
```

Import graph (enforced by ESLint, section 2):

```
app/(client)/** ──► server/client/** ──► db/schema/app + server/shared/**
app/(ops)/**    ──► server/ops/**    ──► db/schema/{app,supplier} + server/shared/**
server/shared/** may import both schemas but exposes nothing supplier-shaped to callers
   (leak-check takes plain string arrays; storage takes keys; authorize returns {userId, orgId, role}).
```

---

## 4. Database layer

### 4.1 Dual driver singleton — `src/db/index.ts` (copy verbatim from spike)

```ts
import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import * as appSchema from "./schema/app";
import * as supplierSchema from "./schema/supplier";
import * as authSchema from "./schema/auth";

export const schema = { ...appSchema, ...supplierSchema, ...authSchema };
export type Schema = typeof schema;
export type Db = PostgresJsDatabase<Schema> | PgliteDatabase<Schema>;
export const PGLITE_DIR = process.env.PGLITE_DIR ?? "./.data/pglite";

type DbGlobal = { __influensiaDb?: Db; __influensiaDbReady?: Promise<Db> };
const g = globalThis as unknown as DbGlobal;

async function createDb(): Promise<Db> {
  if (process.env.DATABASE_URL) {
    const { default: postgres } = await import("postgres");
    const client = postgres(process.env.DATABASE_URL, { max: 10, prepare: false }); // prepare:false for Neon pooler
    return drizzlePg(client, { schema });
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(PGLITE_DIR, { recursive: true }); // PGlite's nodefs mkdir is NOT recursive
  const client = await PGlite.create({ dataDir: PGLITE_DIR });
  return drizzlePglite(client, { schema });
}

/** globalThis singleton: survives Turbopack HMR module re-evaluation; migrates once per process. */
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
```

`getDb()` is **async** everywhere. Repositories call `const db = await getDb()`. Do not export a sync `db`.

`src/db/migrate.ts`
```ts
import path from "node:path";
import type { Db } from "./index";
const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");
export async function runMigrations(db: Db) {
  if (process.env.DATABASE_URL) {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  }
}
```

### 4.2 Schemas

- `schema/app.ts`: `export const app = pgSchema("app")` and every tenant table as `app.table(...)`. Every tenant table carries `id uuid PK`, `orgId uuid → organizations.id`, `createdBy text`, `createdAt/updatedAt timestamptz default now()`, `deletedAt timestamptz` (soft delete, T-11).
- `schema/supplier.ts`: `export const supplier = pgSchema("supplier")` — `suppliers`, `supplier_contacts`, `supplier_participations`, `quotes`, `quote_price_breaks`, `supplier_price_lists`, `supplier_catalogues`, `supplier_performance`, `purchase_orders`. Cross-schema FKs to `app.*` work (`supplier_participations.request_line_id → app.request_lines.id` verified on both drivers).
- `schema/auth.ts`: **generated**, in `public`, never hand-edited. Regenerate with `npm run auth:schema` whenever the Better Auth config changes. Tables: `user, session, account, verification, organization, member, invitation` (+ `relations`). Better Auth ids are `text`, so `created_by`, `actor_id`, `user_id` columns in `app.*` are `text`, not `uuid`.
- Enums: use `text("col", { enum: [...] })` (TS-checked) rather than `pgEnum` — cheaper to evolve, and the state machine module is the source of truth for state/milestone strings.
- Money: `integer` minor units + `text currency` (D-21). Never `numeric`.
- The `app.organizations.auth_org_id text` column links the app org to Better Auth's `organization.id`.

Migrations: `npm run db:generate -- --name <what>` after each schema change; commit `drizzle/*.sql` + `drizzle/meta/*`. Migrations apply automatically at first `getDb()` (dev + prod boot). For Neon production prefer `npm run db:migrate` in the Vercel build step so a bad migration fails the deploy, not the first request. Never edit an applied migration.

### 4.3 Seeding — `src/db/seed.ts`

- `npm run db:seed`: idempotent (checks by email / by `legal_name`), works on both drivers.
- `npm run db:reset`: `rm -rf .data && npm run db:seed` (PGlite only; on Postgres use `drizzle-kit drop` + reseed, or a fresh Neon branch).
- Seeds: agency org "Influensia" with `admin@influensia.test` (admin) and `agent@influensia.test` (agent); client org with `client@koff.test` (client_owner); supplier `ZZLEAKTEST Co., Ltd.` / `泄漏测试有限公司` with a WeChat contact and +86 phone (T-14 leak-test fixture); one request line with a participation for that supplier, one published document and one internal document, so the anonymity crawl has something to catch.
- Users are created through `auth.api.signUpEmail(...)` so password hashing and the org hook run; roles are then patched on `member`.
- **Run seed with the dev server stopped in PGlite mode** — PGlite is a single-process database (see pitfalls).

### 4.4 Ids and human refs

- Primary keys: `uuidv7()` from the `uuidv7` package (time-sortable; `crypto.randomUUID()` is v4, keep it only for Better Auth's own ids and org slugs).
- Human refs from `app.sequences (name, year, next_value)` with an atomic upsert — `src/server/shared/ids.ts`:

```ts
export async function nextRef(db: Db, name: "REQ"|"ORD"|"PRD"|"SUP"|"F", year = new Date().getUTCFullYear()) {
  const res = await db.execute(sql`
    insert into app.sequences (name, year, next_value) values (${name}, ${year}, 2)
    on conflict (name, year) do update set next_value = app.sequences.next_value + 1
    returning next_value - 1 as v`);
  const rows = (res as { rows?: { v: number }[] }).rows ?? (res as unknown as { v: number }[]);
  const v = Number(rows[0].v);
  if (name === "F") return `F-${String(v).padStart(4, "0")}`;                      // Factory F-0042 (year-less)
  if (name === "PRD" || name === "SUP") return `${name}-${String(v).padStart(4, "0")}`;
  return `${name}-${year}-${String(v).padStart(4, "0")}`;                          // REQ-2026-0312
}
```
`db.execute` returns `{rows}` on postgres-js and an array-like on PGlite — the helper normalises; reuse it, don't re-implement.

---

## 5. Auth and authorization

### 5.1 Better Auth config — `src/lib/auth/server.ts` (copy from spike, then extend)

Key points verified:
- `drizzleAdapter(db, { provider: "pg", schema: authSchema })` with the generated schema; plural off.
- `emailAndPassword: { enabled: true, minPasswordLength: 8 }`; `session: { expiresIn: 30d, updateAge: 1d }` (D-02).
- `plugins: [organization(), nextCookies()]` — `nextCookies` must be **last**; it lets server actions set the session cookie.
- `baseURL` from `BETTER_AUTH_URL`; `secret` from `BETTER_AUTH_SECRET`.
- Auth is built lazily (`getAuth()` → `createAuth(await getDb())`) with a `globalThis` cache because the db is async.
- Route handler wraps per request:

```ts
// src/app/api/auth/[...all]/route.ts
import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth/server";
export const runtime = "nodejs";
async function handler(req: Request) {
  const { GET, POST } = toNextJsHandler(await getAuth());
  return req.method === "POST" ? POST(req) : GET(req);
}
export { handler as GET, handler as POST };
```

- Client SDK: `createAuthClient({ plugins: [organizationClient()] })` from `better-auth/react`; `authClient.signIn.email`, `signUp.email`, `signOut`, `useSession`.
- Server session read: `auth.api.getSession({ headers: await headers() })`.

### 5.2 Organisations auto-created on invite (D-03)

Verified mechanism: `databaseHooks.user.create.after` inserts `organization` + `member` (Better Auth tables) and `app.organizations {authOrgId}` in the same hook. In the spike this fires on public sign-up; **in the product there is no public sign-up** (D-02):

1. Admin action `inviteClientUser({ email, name, companyName, country, commercialMode, pricingDisplay })` in `server/ops/admin.ts`:
   - `auth.api.signUpEmail({ body: { email, name, password: <random 24 chars> } })` → hook creates the org.
   - Update `app.organizations` with the company name and commercial settings; set `member.role = client_owner`.
   - `auth.api.forgetPassword({ body: { email, redirectTo: "/set-password" } })` → the invite email is the reset link (Resend template `invite`).
2. Agents/admins are seeded or invited the same way with `role admin|agent` and membership in the **agency** org.
3. `signUp.email` is disabled on the public surface: set `emailAndPassword.disableSignUp: true` in production (`process.env.NODE_ENV === "production"`); the seed and the invite action call `auth.api.signUpEmail` server-side, which bypasses that flag only if you pass the internal context — simpler: keep sign-up enabled but **do not ship a `/sign-up` page**, and add a `before` hook that rejects `/sign-up/email` unless the request carries the internal header set by `inviteClientUser`. Either is fine; document the one chosen in code.
4. Roles live on `member.role` (Better Auth) and nowhere else. Values: `admin | agent | client_owner | client_member` (blueprint). The organization plugin's default role `member` is never used.

The organization plugin's own invite flow (`invitation` table, `organization.inviteMember`) is **not** used in v1 — it invites into an existing org and needs org-management UI. It remains available for v1.1.

### 5.3 `authorize()` contract — `src/server/shared/authorize.ts`

```ts
export type Role = "admin" | "agent" | "client_owner" | "client_member";
export type Ctx = { userId: string; email: string; orgId: string; authOrgId: string; role: Role };
export class Unauthorized extends Error { status = 401 }   // no session
export class Forbidden   extends Error { status = 403 }   // session but wrong role / no membership

export async function authorize(opts?: { roles?: Role[] }): Promise<Ctx>;
export async function currentSession();  // nullable, for layouts that only redirect
```

Resolution: session → `member` row (one per user in v1) → `app.organizations` by `auth_org_id`. Every repository function takes `ctx: Ctx` as its first argument and scopes by `ctx.orgId` (clients) or checks `ctx.role in [admin, agent]` (ops). A repository never trusts an `orgId` from input.

Helper roles: `isOps(ctx)` = admin|agent; `isClient(ctx)` = client_*. Ops queries that touch a client's data take `orgId` explicitly and assert `isOps(ctx)`.

### 5.4 Usage patterns

Server action (`actions.ts` next to the page):
```ts
"use server";
const Input = z.object({ name: z.string().min(1).max(200), qty: z.coerce.number().int().positive() });
export async function createRequestAction(formData: FormData) {
  const ctx = await authorize({ roles: ["client_owner", "client_member"] });
  const input = Input.parse(Object.fromEntries(formData));
  await createRequest(ctx, input);
  revalidatePath("/app");
}
```

Route handler — always wrapped with `route()` from `server/shared/http.ts`, which maps `Unauthorized→401`, `Forbidden→403`, `ZodError→400`, anything else→500 (logged, no stack in the body):
```ts
export const runtime = "nodejs";
export const POST = route(async (req) => { const ctx = await authorize(); ... });
```

Server component: `try { ctx = await authorize() } catch (e) { if (e instanceof Unauthorized) redirect("/sign-in"); throw e; }` — done once in `(client)/layout.tsx` and `(ops)/layout.tsx`, pages then call `authorize()` again cheaply (session lookup is one query; cache with `React.cache` if it shows up in traces).

### 5.5 `/app` vs `/ops` gating

Two layers, per Next 16 guidance ("proxy is an optimistic check, not authorization"):

1. `src/proxy.ts` (Next 16 renamed middleware → proxy; file must be `proxy.ts`, export `proxy`): if no `better-auth.session_token` cookie and path matches `/app/:path*` or `/ops/:path*` → redirect `/sign-in?next=`. No db access here (edge-safe, cookie presence only).
2. Layouts: `(client)/layout.tsx` calls `authorize({ roles: ["client_owner","client_member"] })`; on `Forbidden` (an agent hitting /app) redirect to `/ops`, and vice-versa. Pages and actions still call `authorize()` — the layout check is UX, the per-call check is security.
3. After sign-in, the sign-in page redirects by role: read `/api/auth/get-session` then `member.role` via a tiny server action `whereToAfterLogin()`.

---

## 6. Anonymity implementation contract (blueprint §07, mechanisms 1–9)

| # | Mechanism | Where | Verified in spike |
|---|-----------|-------|-------------------|
| 1 | Import boundary | `eslint.config.mjs` (section 2) | yes — rule fires on a deliberate leak |
| 2 | DTO allowlists | `src/server/client/*.ts` | yes |
| 3 | Key denylist test | `tests/unit/dto-denylist.test.ts` | yes |
| 4 | Server-only ids | type-level, section 6.2 | pattern |
| 5 | Files by prefix | `api/files/[...key]/route.ts` + `storage/local.ts` | yes — 403 on `/internal/` for clients, 403 cross-org |
| 6 | Leak check | `src/server/shared/leak-check.ts` | yes — unit-tested |
| 7 | Images re-encoded | `src/server/shared/files.ts` (sharp) | yes — EXIF absent on output |
| 8 | Factory range label | `nextRef(db, "F")` | helper verified |
| 9 | Anonymity crawl | `tests/e2e/anonymity.spec.ts` | contract below |

### 6.1 Client DTOs

Every function in `src/server/client/**` returns `Dto.parse({...explicit fields...})` where `Dto` is a `z.object({...}).strict()`. Rules:
- Build the object literal by hand from the row; never `Dto.parse(row)` or `{...row}`. `.strict()` is the runtime safety net, not the primary mechanism.
- DTO names end in `Dto`; nested shapes are their own `Dto` so the denylist walker reaches them.
- Export every DTO from the module (the test enumerates module exports).
- Allowed "count" disclosures per Q11: `factoriesContacted: number`, `quotesReceived: number` — no names.

### 6.2 Server-only ids

`participation_id`, `po_id`, `supplier_id`, `contact_id` are typed as `ServerOnly<string>`:
```ts
declare const serverOnly: unique symbol;
export type ServerOnly<T> = T & { readonly [serverOnly]: true };
```
Row types from `schema/supplier.ts` and the offer/sample/order-line rows in `schema/app.ts` brand these columns via `.$type<ServerOnly<string>>()`. A `ServerOnly<string>` is not assignable to a zod `z.string()` output, so it cannot be placed in a DTO without an explicit cast — and the denylist test catches the key name anyway.

### 6.3 Denylist test contract (`tests/unit/dto-denylist.test.ts`)

- Imports every module under `src/server/client/` (use `import.meta.glob` or an explicit list kept in the test — the spike uses an explicit map; switch to glob once there are >5 modules).
- For every exported `z.ZodObject`, walks keys recursively (objects, arrays, optionals, nullables, unions) and asserts no key matches `/supplier|factory_id|participation|contact|wechat|alibaba|1688|uscc|quote|po_|legal_name|cn_name|handle/i`.
- Asserts `.strict()` via `schema.def.catchall.def.type === "never"` (zod 4).
- Asserts a runtime probe with an extra `supplierId` key throws.
- Exception list for legitimate keys (e.g. `quotesReceived`) lives in the test as an explicit `ALLOW` set, reviewed in PR.

### 6.4 File keys

`org/{orgId}/{entity}/{entityId}/{client|internal}/{uuid}[.ext]` — validated by `assertValidKey` regex; `..` rejected. Rules:
- Agents upload to `/internal/`. Clients upload to `/client/` (reference images, artwork) — their own uploads are client-visible by definition.
- `publishDocument(ctx, documentId)` in `server/ops/publish.ts`: runs `leakCheck` on filename + extracted text (PDF text layer via `pdf-parse`, add when needed), on pass `storage.copy(internalKey, clientKey)`, inserts a new `files` row, flips `documents.visibility = client`, `published_at/by`, writes `activity_events` + `outbox`. On fail returns `{ ok:false, hits }` and writes nothing.
- Download route: `orgId` in key must equal `ctx.orgId` unless `isOps(ctx)`; `visibility` segment must be `client` for client roles. Local mode streams from disk (`Readable.toWeb(createReadStream)`); R2 mode returns a 302 to a presigned URL (60 s).
- Images: `storeUpload` re-encodes `image/(jpeg|png|webp)` with `sharp(data).rotate().jpeg({quality:88})`. Do **not** call `.withMetadata()` — that is what keeps EXIF. Output is always JPEG; `product_images.kind` is set by the caller (`client_reference` for client uploads, `supplier_facing` for agent uploads, `clean` only via the publish action).

### 6.5 Leak check contract — `src/server/shared/leak-check.ts`

```ts
export type LeakSources = { names: string[]; handles: string[] };
export type LeakHit = { kind: "supplier_name"|"handle"|"url"|"wechat"|"phone_cn"|"company_suffix"; match: string; where: "text"|"filename" };
export function leakCheck(input: { text?: string; filenames?: string[] }, sources: LeakSources): { ok: true } | { ok: false; hits: LeakHit[] };
export async function loadLeakSources(db: Db): Promise<LeakSources>;   // suppliers.legal_name + cn_name + supplier_contacts.handle, cached 60 s
```
Detects: normalised full supplier names, distinctive tokens ≥ 6 chars of the legal name (minus a generic-word set: city names, "packaging", "trading"…), CN names, contact handles, URLs on alibaba/1688/aliexpress/made-in-china/globalsources, `wechat|weixin|微信 <id>`, `+86 1xx xxxx xxxx`, English `… Co., Ltd / Company Limited / Corp / Manufactory` and Chinese `有限公司|有限责任公司|股份有限公司|厂`. Pure function; the db loader is separate so tests need no db.

Called on: `publishDocument`, `createComment(visibility=client)`, `sendOffer` (option `deviations_plain`, labels), `publishFactoryRange`, every outbound email body (in the sender, as a last gate — a hit there throws and the row goes to `failed` with the hits in `last_error`).

### 6.6 Anonymity crawl contract — `tests/e2e/anonymity.spec.ts`

- Precondition: seed ran (`ZZLEAKTEST Co., Ltd.`, `泄漏测试有限公司`, `zzleak_wechat`, `+8613600000000`, supplier ref `SUP-9999`) and the seeded client org has a request line, offer, sample, order and documents (one internal, one published) tied to that supplier.
- Logs in as `client@koff.test` in Chromium.
- Visits: `/app`, every link under `/app/**` discovered by BFS (max depth 4, same origin), plus every `/api/**` URL the pages fetched (captured from `page.on("request")`), plus the download URL of every published document, plus the internal document's key with `/internal/` (expects 403).
- For each response (HTML, JSON, RSC payloads `?_rsc=`, file bodies for text/PDF): asserts none of the needles appear, case-insensitive, after Unicode NFKC normalisation: `ZZLEAKTEST`, `泄漏测试`, `zzleak_wechat`, `8613600000000`, `SUP-9999`, and the raw participation/PO uuids read from the db.
- Also asserts no `/internal/` key string appears anywhere in client responses.
- Runs in CI on every PR against `next start` with a fresh PGlite dir; **never skipped** (`test.skip` is grep-blocked for this file by a lint step).

---

## 7. State machine module — `src/server/shared/state-machine.ts` (spike file, unit-tested)

- `STATES` (24), `MILESTONES` (9), `MILESTONE_OF: Record<State, Milestone>` (every state mapped, test-enforced), `ACTION_MILESTONES` (price_ready, sample, order_confirmed, quality_check, delivered), `TRANSITIONS: Record<State, State[]>` (every state reachable from `draft`, test-enforced), `assertTransition(from, to)`, `milestoneChanged(from, to): Milestone | null`.
- Cancellation is a soft-delete flag on the line (`deleted_at` + `cancel_reason`), not a state.

`transition(lineId, to, ctx, opts?)` in `server/shared/transition.ts`:
```ts
export async function transition(lineId: string, to: State, ctx: Ctx, opts?: { note?: string; payload?: Record<string, unknown> }): Promise<{ from: State; to: State; milestone: Milestone | null }>
```
In one transaction: lock the line (`for update`), `assertTransition`, update `state`, `milestone`, `last_state_change_at`, `updated_at`; insert `activity_events { type: "line.state_changed", payload: {from, to, milestone, note}, visibility: milestone changed ? "client" : "internal" }`; if the milestone changed, `enqueue` `milestone.changed` for every `client_*` member of the line's org (idempotency `milestone:${lineId}:${to}`), and `action.needed` when `ACTION_MILESTONES` includes it; when `to` is `submitted` enqueue `agent.new_request` for the assigned agent or all agents. Orders mirror this with `order.state`.

---

## 8. Notifications outbox — `src/server/shared/outbox.ts` (spike file, tested on PGlite)

Table `app.notification_outbox`: `id, user_id text, channel 'email', template, payload jsonb, idempotency_key unique, status pending|sent|failed, attempts, last_error, send_after, sent_at, created_at`.

```ts
enqueue({ userId, template, payload, idempotencyKey, sendAfter? }, tx?)   // ON CONFLICT (idempotency_key) DO NOTHING
drain(sender = localSender, limit = 50) → { due, sent, failed }              // backoff 1,5,15,60,240 min; failed after 5 attempts
interface Sender { send(row): Promise<void> }
localSender   // console + ./.data/outbox.log (JSON lines)
resendSender  // RESEND_API_KEY set: renders React Email template from payload (client DTO only), runs leakCheck on subject+html, sends
```
- Templates: `request.received, milestone.changed, action.needed, eta.changed, update.posted, agent.new_request, agent.client_action, agent.daily_digest, invite, password_reset`.
- Idempotency key conventions: `<template>:<entityId>:<discriminator>` (`milestone:${lineId}:${milestone}`, `digest:${userId}:${yyyy-mm-dd}`).
- Production trigger: `api/cron/outbox/route.ts` (GET, checks `Authorization: Bearer ${CRON_SECRET}`) → `drain(resendSender)`; `vercel.json` cron `* * * * *`. Daily digest: a second cron at 07:00 Europe/Warsaw enqueues `agent.daily_digest` rows, the minute cron sends them.
- Local: `/ops/outbox` page lists last 200 rows (status, template, attempts, last_error, payload) with a **Drain now** button (server action → `drain(localSender)`) and a "resend" per failed row (resets to pending). `npm run outbox:drain` exists for scripts but in PGlite mode only with the dev server stopped.

---

## 9. Conventions

- **Server actions** live in `actions.ts` beside the page, `"use server"`, first line `authorize(...)`, input parsed with a zod schema declared in the same file, call one repository function, `revalidatePath`/`revalidateTag`, return `{ ok: true, data } | { ok: false, error: string, issues? }` — never throw across the boundary except `redirect()`.
- **Forms**: react-hook-form + `zodResolver` + shadcn `Field*` components with `Controller`; submit calls the server action via `useTransition`; errors shown with `FieldError`; success `toast.success` (sonner). Shared `<Form>` wrapper in `components/shared/form.tsx` handles the `{ok:false}` → `setError` mapping.
- **Client state**: TanStack Query only for client-side polling/optimistic lists (sourcing board); everything else is server components + actions. One `QueryClientProvider` in the root layout (`lib/query-client.tsx`).
- **Tables**: `components/shared/data-table.tsx` over TanStack Table 9 (`useReactTable`, column defs typed per DTO).
- **Product pictures (picture first, title second)** — one stack for both sides:
  - Server: `server/shared/media.ts` — `lineThumbs` / `productThumbs` / `fileThumbs` (batched: one query per source per table, never per row) under an audience policy: `{ kind: "client", orgId }` (own org, client-visible, EXIF-stripped `/client/` keys) or `OPS_MEDIA` (any live image). `mediaItems()` builds the picture list of a multi-product row. Client DTO wrapper: `server/client/thumbnails.ts`. Guarded by `tests/unit/media.test.ts`.
  - UI: `components/shared/media.tsx` — `ProductThumb`, `ThumbStack`, and `MediaCell` (picture + title + sub), the first column of every product table. `variant="dense"` for ops, `"comfortable"` for the portal. Do not hand-roll thumbnail markup.
  - Delivery: `/api/files/<key>?w=96|160|320|640` returns a square WebP rendered by `server/shared/image-variants.ts` (bounded LRU, browser-cached 7 days; keys are immutable). Components pick the width with `thumbUrl()` from `lib/media.ts` — originals are only downloaded on explicit open.
- **Loading/errors**: `loading.tsx` with skeletons and `error.tsx` per route group; `not-found.tsx` at `(client)` and `(ops)`; no spinners inside tables — use `Suspense` boundaries around slow panels (history, compare view).
- **Dates**: stored UTC `timestamptz`; `server/shared/dates.ts` → `formatDate(d, "d MMM yyyy")`, `formatDateTime`, `relative(d)` via date-fns; display timezone `Europe/Warsaw` for the first client, configurable per org later.
- **Money**: `server/shared/money.ts` → `Money = { minor: number; currency: string }`, `formatMoney({minor,currency}, {perUnit?})` using `Intl.NumberFormat("en", { style:"currency" })`; unit prices to 4 decimals (`$0.0539 / pc`) via a dedicated `formatUnitPrice(minorPer10k)` — store unit prices as **minor units × 100** (`unit_price_minor_e2`) to keep sub-cent quotes exact.
- **Repositories only**: no `@/db` imports in `app/**` (lint-enforced). Repository functions: `(ctx, input) => Dto | void`, throw `Forbidden` on scope violations, take an optional `tx` when composed.
- **Activity**: `server/shared/activity.ts` → `logActivity(tx, { orgId, entityType, entityId, actorId, type, payload, visibility })`; every mutation in `server/ops/**` and `server/client/**` calls it inside its transaction.
- **i18n**: all UI strings via `next-intl` (`useTranslations`/`getTranslations`), `messages/en.json` namespaced by screen; server-side `getTranslations` in server components and email templates. Single locale, no routing (`src/i18n/request.ts` returns `locale: "en"`).
- **Naming**: files kebab-case, components PascalCase, DTOs `XDto`, actions `verbNounAction`, repositories `verbNoun`.
- **Runtime**: every route handler and page that touches the db declares `export const runtime = "nodejs"` (PGlite/sharp/postgres cannot run on edge). Pages under `(client)` and `(ops)` are `dynamic = "force-dynamic"` (session-dependent).

---

## 10. package.json scripts

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint src tests scripts",
  "typecheck": "tsc --noEmit",
  "test:unit": "vitest run",
  "test:e2e": "playwright test",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "tsx scripts/migrate.ts",
  "db:seed": "tsx src/db/seed.ts",
  "db:reset": "rm -rf .data && npm run db:seed",
  "auth:schema": "@better-auth/cli generate --yes --config src/lib/auth/cli-config.ts --output src/db/schema/auth.ts",
  "outbox:drain": "tsx scripts/outbox-drain.ts"
}
```
CI order: `lint → typecheck → test:unit → build → test:e2e` (e2e against `next start`, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` in this container).

---

## 11. Known pitfalls found in the spike, and fixes

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| npm 10.9.7 crash | `Cannot read properties of null (reading 'edgesOut')` on some installs | `npx npm@12 install …` (npm 12 also gates postinstall scripts: esbuild/sharp still work — sharp uses prebuilt optional deps) |
| vitest peer | `ERESOLVE … @types/node ^22 \|\| >=24` | `@types/node@^22` in devDependencies (create-next-app writes `^20`) |
| shadcn v4 CLI flags | `unknown option --base-color`; interactive preset prompt | `init --yes -b radix --preset nova --no-monorepo`; base colour is set by the preset (neutral) |
| shadcn `form` | `add form` creates nothing (deprecated stub) | use `field` (+ `label`, `separator` deps) with react-hook-form `Controller` |
| PGlite dataDir | `ENOENT mkdir ./.data/pglite` | `mkdirSync(dir, { recursive: true })` before `PGlite.create` |
| PGlite in the bundle | WASM/`fs` resolution errors under Turbopack | `serverExternalPackages: ["@electric-sql/pglite", "sharp", "postgres"]`; `runtime = "nodejs"` on every db route |
| HMR re-opens PGlite | double-open / lock errors after edits | `globalThis` singleton (`__influensiaDb`), verified across 3 edits |
| PGlite is single-process | a second process (seed, drain script) on the same `.data/pglite` while `next dev` runs risks corruption | run `db:seed`/`db:reset` with the dev server stopped; local outbox drain is a button on `/ops/outbox`, not a separate process. (Alternative if it bites: `PGLITE_DIR` per process, or keep `DATABASE_URL` pointing at a local Postgres — a Postgres 16 binary is present in this container, see `scripts/db-smoke.ts` header for the `initdb`/`pg_ctl` incantation.) |
| Better Auth origin | `403 {"code":"INVALID_ORIGIN"}` on every POST | `BETTER_AUTH_URL` must equal the served origin (port included); add `trustedOrigins` for preview domains on Vercel |
| Better Auth CLI needs a sync `auth` export | our auth is async (db is async) | `src/lib/auth/cli-config.ts` builds a throwaway instance on `drizzle(new PGlite())` (sync constructor); used only by `auth:schema` |
| Better Auth CLI warns "Drizzle schema mismatch" on first run | expected — the schema file does not exist yet | run `auth:schema` once, then `db:generate` |
| Auth tables in `public` | `drizzle-kit generate` ignores them if `schemaFilter` omits `public` | `schemaFilter: ["public", "app", "supplier"]` |
| Route handler errors | thrown `Unauthorized` → 500 with stack | wrap every handler in `route()` (`server/shared/http.ts`) |
| Playwright + Better Auth sign-out | `page.request.post` has no browser `Origin` → 403 | call `fetch` inside `page.evaluate` (or sign out via the UI) |
| Playwright cold start | `expect` 5 s timeout on first `/app` compile in dev | `expect.timeout: 15_000`; CI uses `next start` |
| Playwright browser mismatch | 1.63 wants Chromium 1243; container has 1194 | pin `@playwright/test@1.56.1` here; latest in CI with `playwright install` |
| `vitest.config.ts` | ESM-in-CJS warning | name it `vitest.config.mts` |
| sharp keeps EXIF | `.withMetadata()` preserves it | never call `withMetadata`; verified output has no EXIF |
| `db.execute` result shape | `{rows}` (postgres-js) vs array (PGlite) | normalise as in `nextRef`; prefer the query builder over `execute` |
| Server components in dev split text nodes with `<!-- -->` | curl greps look broken | irrelevant in the browser; strip in shell checks |
| next-intl | none — single-locale config is 10 lines + plugin wrapper | keep (D-20); a bare messages module would save nothing |

---

## 12. Spike directory map — `/home/claude/spike` (copy from here)

| File | Use |
|------|-----|
| `package.json`, `package-lock.json` | pinned versions and scripts |
| `next.config.ts`, `drizzle.config.ts`, `eslint.config.mjs`, `vitest.config.mts`, `playwright.config.ts`, `components.json`, `tsconfig.json`, `postcss.config.mjs` | config, copy as-is |
| `src/db/index.ts`, `src/db/migrate.ts`, `src/db/seed.ts` | dual driver, migrator, idempotent seed |
| `src/db/schema/app.ts`, `src/db/schema/supplier.ts` | `pgSchema` pattern, tenant columns, cross-schema FK; extend to the 36-table model |
| `src/db/schema/auth.ts` | generated Better Auth tables (regenerate, don't edit) |
| `drizzle/0000_init.sql`, `drizzle/meta/*` | example generated migration (regenerate in the real repo) |
| `src/lib/auth/server.ts`, `client.ts`, `cli-config.ts` | Better Auth server (lazy, org hook), React client, CLI config |
| `src/app/api/auth/[...all]/route.ts` | auth handler |
| `src/server/shared/authorize.ts`, `http.ts`, `ids.ts` | `authorize()`, `route()`, `nextRef()` |
| `src/server/shared/storage/{types,local,s3,index}.ts`, `src/server/shared/files.ts` | storage adapter, key builder/validator, upload pipeline with sharp |
| `src/app/api/files/upload/route.ts`, `src/app/api/files/[...key]/route.ts` | upload + prefix-gated streaming download |
| `src/server/shared/outbox.ts`, `scripts/outbox-drain.ts`, `scripts/outbox-smoke.ts` | outbox enqueue/drain, local sender |
| `src/server/shared/state-machine.ts` | 24 states, 9 milestones, transition table |
| `src/server/shared/leak-check.ts` | leak check (pure) |
| `src/server/client/requests.ts` | repository with strict DTOs, transaction + activity write |
| `src/app/(client)/app/page.tsx`, `actions.ts` | server component + server action pattern, next-intl usage |
| `src/app/(auth)/sign-in/page.tsx`, `sign-up/page.tsx` | client SDK usage (sign-up page is spike-only; product has invites) |
| `src/app/layout.tsx`, `src/i18n/request.ts`, `messages/en.json` | providers, next-intl single-locale |
| `tests/unit/dto-denylist.test.ts`, `leak-check.test.ts`, `state-machine.test.ts`, `ids.test.ts` | unit test patterns |
| `tests/e2e/auth-and-request.spec.ts` | Playwright pattern (sign-up → action → row → sign-out → sign-in) |
| `scripts/db-smoke.ts`, `scripts/migrate.ts` | driver smoke test (run with and without `DATABASE_URL`) |
| `.env.local` | `BETTER_AUTH_URL=http://localhost:3100` (spike port) |

Reproduce the spike's verification: `cd /home/claude/spike && npm run lint && npm run typecheck && npm run test:unit && npm run build && (npx next dev -p 3100 &) && sleep 8 && PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run test:e2e`.

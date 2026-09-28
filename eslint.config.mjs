import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/** Anonymity mechanism 1: client code paths cannot reach the supplier schema or ops modules. */
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

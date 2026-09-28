import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // pin the workspace root to this project so Turbopack never infers it from a lockfile in a parent directory
  turbopack: { root: __dirname },
  // PGlite ships WASM + needs node:fs; sharp is native. Keep them out of the bundler.
  serverExternalPackages: ["@electric-sql/pglite", "sharp", "postgres"],
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default withNextIntl(nextConfig);

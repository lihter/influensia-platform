# Influensia Sourcing Platform

Client portal (`/app`) + agent workspace (`/ops`) for the China–Europe sourcing agency. Next.js 16 · Drizzle (PGlite locally, Postgres when `DATABASE_URL` is set) · Better Auth · Tailwind 4 / shadcn.

## Local run

```bash
npm install          # or `npx npm@12 install` if npm 10 crashes
npm run db:seed      # rebuilds ./.data with the SPEC §7 dataset (stop `npm run dev` first — PGlite is single-process)
npm run dev          # http://localhost:3000
```

Seed users (password `Password123!`): `marko@influensia.ro` (admin), `bogdan@influensia.ro`, `cristina@influensia.ro` (agents) → `/ops`; `piotr@example.pl`, `buyer@koff.example` (clients) → `/app`.

Checks: `npm run lint && npm run typecheck && npm run test:unit && npm run build && npm run test:e2e`

Docs: `docs/FOUNDATION.md` (what exists, module APIs, file ownership) · `docs/ARCHITECTURE.md` · `docs/SPEC.md` · `docs/DESIGN.md`.

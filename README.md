# Influensia Sourcing Platform

The operating system for a China → Europe sourcing agency: a **client portal** (`/app`) where European buyers send product links, follow every line from request to delivery, decide offers, approve samples and pay — without ever seeing which factory makes their goods — and an **agent workspace** (`/ops`) where the team runs sourcing boards, quotes, offers, samples, orders, documents and suppliers, with a leak check guarding everything clients can see.

Next.js 16 · Drizzle ORM · PGlite locally (Postgres when `DATABASE_URL` is set) · Better Auth · Tailwind 4 / shadcn.

## Quick start (Node 22 LTS or 24, npm 10+)

```bash
npm ci                                   # if it crashes: npx npm@latest install
cp .env.example .env.local               # set BETTER_AUTH_SECRET to the output of: openssl rand -hex 32
npm run db:seed                          # today-relative demo data in ./.data (~10 s)
npm run dev                              # http://localhost:3000
# sign in with password Password123!: piotr@example.pl (client) · bogdan@influensia.ro (agent) · marko@influensia.ro (admin)
```

## Docs

- **`docs/RUNBOOK.md`** — start here: install, logins, the 10-minute demo script, today-relative seeding (`SEED_SHIFT_DAYS`), tests, reset, known gaps, going live (Neon, R2, Resend, Vercel).
- `docs/SPEC.md` — product specification and acceptance criteria.
- `docs/DESIGN.md` — design system and screen designs.
- `docs/ARCHITECTURE.md` — system architecture, data model, anonymity model.
- `docs/FOUNDATION.md` — what exists, module APIs, conventions.
- `docs/QA_REPORT.md` — QA findings and fix status (screenshots in `docs/qa-shots/`).
- `docs/UX_REVIEW.md` — UX review and what was fixed/deferred (screenshots in `docs/ux-shots/`).

Checks: `npm run lint && npm run typecheck && npm run test:unit && npm run build && CI=1 npx playwright test`

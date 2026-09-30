/**
 * Production bootstrap — `npm run db:bootstrap`.
 *
 * Creates an EMPTY workspace: the agency org, one client org and the four real accounts. No demo requests, products,
 * suppliers, quotes, files, pricing rules or FX rates. Every person gets a one-time invite link (valid 7 days) and sets
 * their own password on /invite/<token> — nobody shares or knows anyone else's password.
 *
 * Refuses to run when any user already exists (it never wipes data). Runs migrations first (via getDb()).
 * Needs APP_URL (or BETTER_AUTH_URL) set to the public origin so the printed links are correct.
 */
import { uuidv7 } from "uuidv7";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as A from "@/db/schema/app";
import { inviteUser } from "@/server/ops/admin";

const ACCOUNTS = [
  { email: "marko@influensia.ro", name: "Marko", role: "admin" as const, org: "agency" as const },
  { email: "bogdan@influensia.ro", name: "Bogdan", role: "agent" as const, org: "agency" as const },
  { email: "cristina@influensia.ro", name: "Cristina", role: "agent" as const, org: "agency" as const },
  { email: "piotr@example.pl", name: "Piotr", role: "client_owner" as const, org: "client" as const },
];

async function main() {
  const db = await getDb();
  const res = await db.execute(sql`select count(*)::int as n from "user"`);
  const rows = (res as { rows?: { n: number }[] }).rows ?? (res as unknown as { n: number }[]);
  if (Number(rows[0].n) > 0) {
    console.error(`bootstrap: refusing — ${rows[0].n} user(s) already exist. This script never wipes data.`);
    process.exit(1);
  }

  const at = new Date();
  const base = { commercialMode: "agency_passthrough" as const, pricingDisplay: "factory_plus_fee" as const, defaultIncoterm: "FOB" as const, depositPct: 30, createdAt: at, updatedAt: at };
  const agencyId = uuidv7();
  const clientId = uuidv7();
  await db.insert(A.organizations).values({ id: agencyId, type: "agency", name: "Influensia", country: "RO", timezone: "Europe/Zagreb", ...base });
  await db.insert(A.organizations).values({ id: clientId, type: "client", name: "Piotr's team", country: "PL", timezone: "Europe/Warsaw", ...base });

  const origin = (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  console.log(`\nInfluensia bootstrap — empty workspace on ${origin}\n`);
  for (const a of ACCOUNTS) {
    const r = await inviteUser(null, { email: a.email, name: a.name, role: a.role, orgId: a.org === "agency" ? agencyId : clientId, at });
    console.log(`${a.role.padEnd(13)} ${a.email.padEnd(24)} ${origin}/invite/${r.inviteToken}`);
  }
  console.log(`\nLinks are single-use and expire in 7 days. Send each person only their own link.\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

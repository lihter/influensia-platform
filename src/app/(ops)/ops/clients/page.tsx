import Link from "next/link";
import { Settings2 } from "lucide-react";
import { requireOpsPage, isAdmin } from "@/server/shared/authorize";
import { listClients } from "@/server/ops/clients";
import { PageHeader } from "@/components/shared/page-header";
import { PageBand } from "@/components/shared/section-band";
import { Button } from "@/components/ui/button";
import { ClientsTable } from "@/components/ops/clients/clients-table";
import { NewClientSheet } from "@/components/ops/clients/new-client-sheet";
import { S } from "@/components/ops/clients/strings";
import { createClientAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clients" };

/** F-26 — client organisations. "+ Client" (admin) creates the org and invites its first user in one form. */
export default async function ClientsPage() {
  const ctx = await requireOpsPage("/ops/clients");
  const rows = await listClients(ctx);
  const admin = isAdmin(ctx);
  return (
    <>
      <PageHeader band
        eyebrow={S.eyebrow}
        title={S.title}
        titleSuffix={S.count(rows.length)}
        actions={
          admin ? (
            <>
              <Button asChild variant="outline"><Link href="/ops/settings"><Settings2 />{S.settingsLink}</Link></Button>
              <NewClientSheet create={createClientAction} />
            </>
          ) : undefined
        }
      />
      <PageBand tone="page" pad="md">
        <ClientsTable rows={rows} />
      </PageBand>
    </>
  );
}

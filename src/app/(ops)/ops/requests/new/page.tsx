import { requireOpsPage } from "@/server/shared/authorize";
import { listClientOrgs } from "@/server/ops/requests";
import { PageHeader } from "@/components/shared/page-header";
import { NewRequestForm } from "@/components/app/requests/new-request-form";
import { O } from "@/components/ops/requests/strings";
import { createOnBehalfAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "New request on behalf" };

/** F-04 (ops) — same paste-and-go intake with a client picker; source fixed to agent_on_behalf. */
export default async function NewOnBehalfPage() {
  const ctx = await requireOpsPage("/ops/requests/new");
  const clients = await listClientOrgs(ctx);
  return (
    <>
      <PageHeader eyebrow={O.newOnBehalf.eyebrow} title={O.newOnBehalf.title} meta={<span className="text-xs text-muted-foreground">{O.newOnBehalf.hint}</span>} />
      <div className="max-w-4xl">
        <NewRequestForm mode="ops" action={createOnBehalfAction} clients={clients} />
      </div>
    </>
  );
}

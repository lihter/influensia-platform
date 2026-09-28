import { requireClientPage } from "@/server/shared/authorize";
import { getClientAccount } from "@/server/client/settings";
import { PageHeader } from "@/components/shared/page-header";
import { ProfileCard, CompanyCard, PasswordCard, NotificationsCard } from "@/components/app/settings/account-view";
import { updateProfileAction, passwordChangedAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

/** F-01 self-service: name, password (Better Auth client), company details read-only, notification preferences stub. */
export default async function ClientSettingsPage() {
  const ctx = await requireClientPage("/app/settings");
  const dto = await getClientAccount(ctx);
  return (
    <>
      <PageHeader eyebrow="Account" title="Your profile" meta={<span>{dto.email}</span>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <ProfileCard dto={dto} save={updateProfileAction} />
          <PasswordCard dto={dto} done={passwordChangedAction} />
        </div>
        <div className="flex flex-col gap-6">
          <CompanyCard dto={dto} />
          <NotificationsCard dto={dto} />
        </div>
      </div>
    </>
  );
}

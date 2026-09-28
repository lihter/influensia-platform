"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, MoreHorizontal, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FormShell } from "@/components/shared/form-shell";
import { DataTable, PrimaryCell, type DataTableColumn } from "@/components/shared/data-table";
import { DateTime } from "@/components/shared/formatters";
import { EmptyState } from "@/components/shared/empty-state";
import type { ActionResult } from "@/server/shared/http";
import type { ClientUserRow, AddClientUserInput } from "@/server/ops/clients";
import { Field, TextField } from "./fields";
import { Input } from "@/components/ui/input";
import { InviteResultDialog, type InviteCredentials } from "./invite-result";
import { S, USER_STATUS_LABEL, ROLE_LABEL, errorText } from "./strings";

type Ref = { orgId: string; userId: string };
export type UserActions = {
  add: (input: AddClientUserInput) => Promise<ActionResult<{ userId: string; email: string; tempPassword: string; inviteToken: string }>>;
  deactivate: (r: Ref) => Promise<ActionResult<undefined>>;
  reactivate: (r: Ref) => Promise<ActionResult<undefined>>;
  resend: (r: Ref) => Promise<ActionResult<{ inviteToken: string; expiresAt: string }>>;
};

const statusVariant = (s: ClientUserRow["status"]) => (s === "active" ? "success" : s === "invited" ? "info" : "neutral");

/** F-26 Users card: name · email · role · status · last seen · [Resend invite] [Deactivate] (admin). */
export function ClientUsersCard({ orgId, orgName, users, admin, actions }: { orgId: string; orgName: string; users: ClientUserRow[]; admin: boolean; actions: UserActions }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [creds, setCreds] = React.useState<InviteCredentials | null>(null);

  const run = (userId: string, fn: () => Promise<ActionResult<unknown>>, ok: string) => {
    setBusy(userId);
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(ok); else toast.error(errorText(r.error));
      setBusy(null);
      router.refresh();
    });
  };

  const columns: DataTableColumn<ClientUserRow>[] = [
    { id: "name", accessorKey: "name", header: S.detail.colUser.name, cell: ({ row }) => <PrimaryCell title={row.original.name} sub={row.original.email} /> },
    { id: "role", accessorKey: "role", header: S.detail.colUser.role, cell: ({ row }) => ROLE_LABEL[row.original.role] ?? row.original.role },
    {
      id: "status", accessorKey: "status", header: S.detail.colUser.status,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2">
          <Badge variant={statusVariant(row.original.status)} data-status={row.original.status}>{USER_STATUS_LABEL[row.original.status]}</Badge>
          {row.original.status === "invited" && row.original.inviteExpiresAt && <span className="text-xs text-muted-foreground">{S.detail.expires} <DateTime value={row.original.inviteExpiresAt} variant="short" /></span>}
        </span>
      ),
    },
    { id: "lastSeen", accessorKey: "lastSeenAt", header: S.detail.colUser.lastSeen, meta: { numeric: true }, cell: ({ row }) => (row.original.lastSeenAt ? <DateTime value={row.original.lastSeenAt} variant="datetime" /> : <span className="text-faint">{S.detail.never}</span>) },
  ];
  if (admin) {
    columns.push({
      id: "actions", header: "", meta: { numeric: true, width: "3rem" }, enableSorting: false,
      cell: ({ row }) => {
        const u = row.original;
        const ref = { orgId, userId: u.id };
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.name}`} data-testid={`user-menu-${u.email}`} disabled={pending && busy === u.id} onClick={(e) => e.stopPropagation()}>
                {pending && busy === u.id ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              {u.status !== "deactivated" && <DropdownMenuItem onSelect={() => run(u.id, () => actions.resend(ref), S.toast.resent)}>{S.detail.resend}</DropdownMenuItem>}
              {u.status !== "deactivated" ? (
                <DropdownMenuItem variant="destructive" onSelect={() => run(u.id, () => actions.deactivate(ref), S.toast.deactivated)}>{S.detail.deactivate}</DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => run(u.id, () => actions.reactivate(ref), S.toast.reactivated)}>{S.detail.reactivate}</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    });
  }

  const onInvite = async (e: React.FormEvent<HTMLFormElement>) => {
    const fd = new FormData(e.currentTarget);
    setErrors({});
    const r = await actions.add({ orgId, name: String(fd.get("name") ?? ""), email: String(fd.get("email") ?? "") });
    if (!r.ok) { setErrors(r.errors ?? {}); toast.error(errorText(r.error)); return false; }
    toast.success(S.toast.invited(r.data.email));
    setCreds({ email: r.data.email, tempPassword: r.data.tempPassword, inviteToken: r.data.inviteToken });
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      {admin && (
        <div className="flex justify-end">
          <FormShell trigger={<Button variant="outline" data-testid="invite-user"><UserPlus />{S.detail.addUser}</Button>} eyebrow={orgName} title={S.detail.addUser} submitLabel={S.detail.addUser} onSubmit={onInvite}>
            <TextField id="name" label={S.sheet.userName} error={errors.name} required autoFocus />
            <TextField id="email" label={S.sheet.email} error={errors.email} required type="email" />
            <Field id="role" label={S.sheet.role}><Input id="role" value={S.sheet.roleFixed} readOnly disabled /></Field>
          </FormShell>
        </div>
      )}
      <DataTable columns={columns} data={users} density="compact" data-testid="client-users" rowClassName={(u) => (u.status === "deactivated" ? "text-muted-foreground" : undefined)} emptyState={<EmptyState title="No users yet" className="py-8" />} />
      <InviteResultDialog creds={creds} onClose={() => setCreds(null)} />
    </div>
  );
}

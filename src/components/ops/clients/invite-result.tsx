"use client";
import * as React from "react";
import Link from "next/link";
import { Check, Copy } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { S } from "./strings";

export type InviteCredentials = { email: string; tempPassword: string; inviteToken: string; orgId?: string };

function CopyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="w-32 shrink-0 text-xs font-medium text-muted-foreground">{label}</div>
      <div className={mono ? "min-w-0 flex-1 truncate font-mono text-[13px] text-foreground" : "min-w-0 flex-1 truncate text-sm text-foreground"} title={value} data-testid={`cred-${label.toLowerCase().replace(/\s+/g, "-")}`}>{value}</div>
      <Button
        type="button" size="sm" variant="outline"
        onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ } }}
      >
        {copied ? <Check className="text-success" /> : <Copy />}{copied ? S.invited.copied : S.invited.copy}
      </Button>
    </div>
  );
}

/**
 * Shown exactly once after an invite (local mode): the temporary password never appears again (SPEC F-26 / D-02).
 * A dialog, not a sheet — it is a decision-free confirmation the admin reads and closes (DESIGN §5.9).
 */
export function InviteResultDialog({ creds, onClose, showOpen }: { creds: InviteCredentials | null; onClose: () => void; showOpen?: boolean }) {
  return (
    <Dialog open={!!creds} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid="invite-result">
        <DialogHeader>
          <DialogTitle>{S.invited.title}</DialogTitle>
          <DialogDescription>{S.invited.body}</DialogDescription>
        </DialogHeader>
        {creds && (
          <dl className="sheet">
            <CopyRow label={S.invited.email} value={creds.email} />
            <CopyRow label={S.invited.tempPassword} value={creds.tempPassword} mono />
            <CopyRow label={S.invited.inviteUrl} value={`/invite/${creds.inviteToken}`} mono />
          </dl>
        )}
        <DialogFooter>
          {showOpen && creds?.orgId && <Button asChild variant="outline"><Link href={`/ops/clients/${creds.orgId}`}>{S.invited.open}</Link></Button>}
          <Button type="button" onClick={onClose}>{S.invited.done}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

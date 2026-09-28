"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, PencilLine } from "lucide-react";
import { requestSpecChangeAction } from "@/app/(client)/app/lines/[ref]/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** QA-08 — "Request a change" on a frozen spec: formal change request (comment + change_requested exception). */
export function RequestChangeButton({ lineRef, className }: { lineRef: string; className?: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const submit = () => {
    if (text.trim().length < 10) { setError("Tell us what should change (at least 10 characters)."); return; }
    setError(null);
    start(async () => {
      const r = await requestSpecChangeAction({ lineRef, text });
      if (r.ok) { toast.success("Change request sent — we'll confirm the new spec with you."); setOpen(false); setText(""); router.refresh(); }
      else { const m = r.message ?? (r.errors ? Object.values(r.errors)[0] : null) ?? "Couldn't send — please try again."; setError(m); toast.error(m); }
    });
  };
  return (
    <>
      <Button type="button" variant="outline" size="sm" className={className} onClick={() => setOpen(true)} data-testid="request-change"><PencilLine />Request a change</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request a change</DialogTitle>
            <DialogDescription>The spec is confirmed. Tell us what should change — your contact checks it with the factory and confirms a new version before anything moves on.</DialogDescription>
          </DialogHeader>
          <Textarea rows={4} value={text} onChange={(e) => { setText(e.target.value); if (error) setError(null); }} placeholder="e.g. Thickness 100 µm instead of 80 µm" className="text-base" aria-invalid={!!error} data-testid="change-text" autoFocus />
          {error && <p className="text-xs text-danger" role="alert">{error}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={pending} data-testid="change-send">{pending && <Loader2 className="animate-spin" />}Send change request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

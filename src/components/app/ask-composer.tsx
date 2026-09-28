"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, SendHorizontal } from "lucide-react";
import type { ActionResult } from "@/server/shared/http";
import { askAction } from "@/app/(client)/app/lines/[ref]/actions";
import { askAboutRequestAction } from "@/app/(client)/app/requests/[reqRef]/actions";
import { askAboutOrderAction } from "@/app/(client)/app/orders/[ref]/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clientInitials } from "./client-format";

export type AskTarget = { kind: "line" | "request" | "order"; ref: string };

const MIN: Record<AskTarget["kind"], number> = { line: 1, request: 2, order: 3 };

/** Sends through the existing client actions; one call shape for the composer. */
async function send(target: AskTarget, body: string): Promise<ActionResult<object>> {
  if (target.kind === "line") return askAction({ lineRef: target.ref, body });
  if (target.kind === "request") return askAboutRequestAction({ requestRef: target.ref, body });
  return askAboutOrderAction({ ref: target.ref, text: body });
}

/**
 * Signature touch #4 — WhatsApp-effort composer at the bottom of the Updates feed ("Message Bogdan…"). Replaces the
 * separate Ask tab / sheet. `#ask` in the URL (dashboard "Answer", header "Ask a question") focuses it (QA-20).
 */
export function AskComposer({ target, agentName, openQuestion, disabled, className }: { target: AskTarget; agentName: string | null; openQuestion?: string | null; disabled?: boolean; className?: string }) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const first = agentName?.split(/\s+/)[0] ?? null;
  const placeholder = openQuestion ? "Type your answer…" : first ? `Message ${first}…` : "Message your contact…";

  React.useEffect(() => {
    const focusIfAsked = () => { if (window.location.hash === "#ask") { ref.current?.scrollIntoView({ block: "center" }); ref.current?.focus({ preventScroll: true }); } };
    focusIfAsked();
    window.addEventListener("hashchange", focusIfAsked);
    return () => window.removeEventListener("hashchange", focusIfAsked);
  }, []);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = body.trim();
    if (text.length < MIN[target.kind]) { setError(target.kind === "line" ? "Write a message first." : `Write at least ${MIN[target.kind]} characters.`); ref.current?.focus(); return; }
    setError(null);
    start(async () => {
      const r = await send(target, text);
      if (r.ok) {
        const msg = "answered" in r.data && r.data.answered ? "Thanks — your answer reached us." : "Sent — we'll get back to you.";
        setSent(msg); setBody(""); toast.success(msg); router.refresh();
      } else {
        const msg = r.message ?? (r.errors ? Object.values(r.errors)[0] : null) ?? "Couldn't send — please try again.";
        setError(msg); toast.error(msg);
      }
    });
  };

  return (
    <form id="ask" onSubmit={submit} className={cn("scroll-mt-24 rounded-xl border border-border bg-card p-3 sm:p-4", className)} data-testid="ask-form" aria-label="Ask a question">
      {openQuestion && (
        <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm" data-testid="open-question">
          <span className="text-xs font-semibold text-green-700">{first ?? "We"} asked you:</span> <span className="[overflow-wrap:anywhere]">{openQuestion}</span>
        </div>
      )}
      <div className="flex items-end gap-3">
        <Avatar className="hidden size-10 shrink-0 sm:flex"><AvatarFallback className="bg-section-alt text-xs font-semibold text-ink-2">{clientInitials(agentName ?? "Influensia")}</AvatarFallback></Avatar>
        <label className="sr-only" htmlFor={`ask-${target.ref}`}>{placeholder}</label>
        <textarea
          id={`ask-${target.ref}`}
          ref={ref}
          rows={1}
          value={body}
          disabled={disabled}
          onChange={(e) => { setBody(e.target.value); if (error) setError(null); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`; }}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
          placeholder={placeholder}
          aria-invalid={!!error}
          className="min-h-11 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-danger"
          data-testid="ask-text"
        />
        <Button type="submit" variant="action" size="lg" disabled={pending || disabled} className="h-11 shrink-0" data-testid="ask-send" aria-label="Send">
          {pending ? <Loader2 className="animate-spin" /> : <SendHorizontal />}<span className="max-sm:sr-only">Send</span>
        </Button>
      </div>
      <p className={cn("mt-2 text-xs", error ? "text-danger" : sent ? "text-success" : "text-muted-foreground")} role={error ? "alert" : undefined} aria-live="polite">
        {error ?? sent ?? `${first ?? "We"} usually ${first ? "replies" : "reply"} within one working day — here and by email.`}
      </p>
    </form>
  );
}

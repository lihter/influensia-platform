import { Inbox, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** DESIGN §5.6 — centred, icon in a section-alt square, H3, muted prose, one action. */
export function EmptyState({ icon: Icon = Inbox, title, body, action, className }: { icon?: LucideIcon; title: string; body?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto max-w-sm py-12 text-center", className)} data-testid="empty-state">
      <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-lg bg-section-alt">
        <Icon className="size-5 text-muted-foreground" strokeWidth={1.75} />
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {body && <p className="mt-1 text-base text-muted-foreground">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

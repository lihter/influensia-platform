import { Eyebrow } from "@/components/shared/eyebrow";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { S } from "./strings";

const T = S.newRequest;

/** DESIGN §6.2 right rail: three numbered eyebrow pills + the contact card. Section-alt band, not a card. */
export function NextStepsRail({ agentName }: { agentName?: string | null }) {
  const steps = [[T.rail1, T.rail1Body], [T.rail2, T.rail2Body], [T.rail3, T.rail3Body]];
  const name = agentName ?? "Influensia team";
  return (
    <aside className="rounded-xl border border-hairline-strong bg-section-alt p-5 lg:sticky lg:top-20 lg:self-start" aria-label={T.railTitle}>
      <h2 className="text-base font-semibold">{T.railTitle}</h2>
      <ol className="mt-4 flex flex-col gap-4">
        {steps.map(([title, body], i) => (
          <li key={title}>
            <Eyebrow variant="pill" number={i + 1}>{title}</Eyebrow>
            <p className="mt-1.5 text-sm text-ink-2">{body}</p>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex items-center gap-3 rounded-xl border border-border bg-card p-3">
        <Avatar className="size-8"><AvatarFallback className="bg-section-alt text-2xs font-semibold text-ink-2">{name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}</AvatarFallback></Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{name}</p>
          <p className="text-xs text-muted-foreground">{T.railAgent}</p>
        </div>
      </div>
    </aside>
  );
}

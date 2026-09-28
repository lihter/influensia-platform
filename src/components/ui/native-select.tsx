import * as React from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A native <select> dressed exactly like the shadcn SelectTrigger (one select look across the app, UX #7).
 * Use it where a form posts the value or tests drive `selectOption`; use ui/select for rich option rendering.
 *   <NativeSelect value={v} onChange={(e) => set(e.target.value)} size="sm"><option value="">All</option>…</NativeSelect>
 */
export function NativeSelect({ className, wrapperClassName, size = "default", children, ...props }: Omit<React.ComponentProps<"select">, "size"> & { size?: "sm" | "default"; wrapperClassName?: string }) {
  return (
    <span className={cn("relative inline-flex", wrapperClassName)}>
      <select
        data-slot="native-select"
        className={cn(
          "w-full min-w-0 cursor-pointer appearance-none rounded-lg border border-input bg-card pr-8 pl-2.5 font-sans text-sm text-foreground transition-colors outline-none hover:border-hairline-strong focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
          size === "sm" ? "h-8" : "h-9",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
}

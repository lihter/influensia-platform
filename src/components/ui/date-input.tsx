"use client";

/**
 * EU date input (FIX_PHASE contract c): shows and accepts `dd.mm.yyyy`, emits ISO `yyyy-mm-dd`.
 * Drop-in for `<Input type="date" value={iso} onChange={(e) => set(e.target.value)} />`:
 *
 *   <DateInput value={valid} onChange={(e) => setValid(e.target.value)} data-testid="offer-valid" />
 *   <DateInput value={valid} onValueChange={setValid} min="2026-01-01" />
 *   <DateInput name="paidOn" defaultValue="2026-09-28" />   // uncontrolled; a hidden input carries the ISO value in FormData
 *
 * Typing accepts 12.10.2026, 12/10/2026, 12.10.26, 12.10. (this year) and 2026-10-12 (so e2e `fill("2026-10-31")` works).
 * The calendar button opens the browser's native picker. While the text is not a full date, onChange receives "".
 */
import * as React from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtInputDate, parseInputDate } from "@/lib/format-date";

type Props = Omit<React.ComponentProps<"input">, "type" | "value" | "defaultValue" | "onChange"> & {
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (e: { target: { value: string; name?: string } }) => void;
  onValueChange?: (iso: string) => void;
  min?: string;
  max?: string;
  wrapperClassName?: string;
};

export function DateInput({ value, defaultValue, onChange, onValueChange, name, min, max, className, wrapperClassName, disabled, id, onBlur, ...rest }: Props) {
  const controlled = value !== undefined;
  const [iso, setIso] = React.useState<string>(defaultValue ?? "");
  const current = controlled ? value ?? "" : iso;
  const [text, setText] = React.useState<string>(fmtInputDate(current));
  const lastEmitted = React.useRef<string>(current);
  const picker = React.useRef<HTMLInputElement>(null);

  // Sync the visible text when the parent changes the value (reset, prefill) — not on our own emissions.
  React.useEffect(() => {
    if (current !== lastEmitted.current) { lastEmitted.current = current; setText(fmtInputDate(current)); }
  }, [current]);

  const emit = (next: string) => {
    lastEmitted.current = next;
    if (!controlled) setIso(next);
    onChange?.({ target: { value: next, name } });
    onValueChange?.(next);
  };
  const outOfRange = !!current && ((min && current < min) || (max && current > max));
  const invalidText = text.trim() !== "" && !parseInputDate(text);

  return (
    <div className={cn("relative w-full", wrapperClassName)}>
      <input
        {...rest}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={rest.placeholder ?? "dd.mm.yyyy"}
        disabled={disabled}
        value={text}
        aria-invalid={rest["aria-invalid"] ?? (invalidText || outOfRange ? true : undefined)}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parseInputDate(e.target.value);
          if (parsed) { if (parsed !== current) emit(parsed); }
          else if (current) emit("");
        }}
        onBlur={(e) => { const parsed = parseInputDate(text); if (parsed) setText(fmtInputDate(parsed)); onBlur?.(e); }}
        className={cn(
          "h-9 w-full min-w-0 rounded-lg border border-input bg-card py-1 pr-9 pl-3 font-mono text-sm tabular-nums transition-colors outline-none placeholder:font-sans placeholder:text-faint focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30",
          className,
        )}
      />
      {name && <input type="hidden" name={name} value={current} />}
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label="Open calendar"
        onClick={() => { const el = picker.current; if (!el) return; try { el.showPicker(); } catch { el.focus(); } }}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground disabled:pointer-events-none"
      >
        <CalendarDays className="size-4" />
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        min={min}
        max={max}
        value={current}
        onChange={(e) => { const v = e.target.value; setText(fmtInputDate(v)); emit(v); }}
        className="pointer-events-none absolute right-0 bottom-0 h-px w-px opacity-0"
      />
    </div>
  );
}

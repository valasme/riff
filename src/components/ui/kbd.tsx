import { cn } from "@/lib/cn";

/**
 * One key of a shortcut. Chords arrive from `formatChord` as "Alt+K", so the
 * splitting happens here rather than at every call site.
 *
 * The keys are rendered as separate chips instead of one "Alt+K" string
 * because that is what the shortcut physically is, and because a run of
 * mono-spaced text at 11px next to a 15px label reads as a typo rather than
 * as a key.
 */
export function Kbd({ chord, className }: { chord: string; className?: string }) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1", className)} aria-hidden>
      {chord.split("+").map((key) => (
        <kbd
          key={key}
          data-slot="kbd"
          className="grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-[0.25rem] border border-line bg-hover px-1 font-sans text-[0.6875rem] leading-none font-medium text-muted-foreground"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

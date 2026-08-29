import { cn } from "@/lib/cn";
import type { Theme } from "@/lib/ipc";

/**
 * A miniature of the real shell, so a theme is shown rather than named.
 *
 * `data-theme` on the wrapper is the whole trick: the preview is built from
 * the same tokens as the application, so it cannot drift from what choosing
 * that theme actually does. Adding a fourth theme needs no work here.
 *
 * Decorative by construction — the label beside it names the choice — so it
 * carries `aria-hidden` and the surrounding control supplies the accessible
 * name. A `role="img"` with an alt text saying "dark theme preview" would add
 * a second announcement of a word the radio already says.
 */
export function ThemePreview({ variant, className }: { variant: Theme; className?: string }) {
  return (
    <div
      data-theme={variant}
      aria-hidden
      className={cn(
        "flex flex-col overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface",
        className,
      )}
    >
      {/* Title bar: toggle tile, wordmark stroke, search field. */}
      <div className="flex h-[0.875rem] shrink-0 items-center gap-[0.1875rem] border-b border-line px-1">
        <div className="size-[0.3125rem] rounded-[0.0625rem] bg-active-fill" />
        <div className="h-[0.1875rem] w-2.5 rounded-full bg-muted-foreground" />
        <div className="ms-auto me-auto h-[0.375rem] w-8 rounded-full border border-line bg-hover" />
        <div className="h-[0.1875rem] w-[0.1875rem] rounded-full bg-muted-foreground" />
      </div>
      <div className="flex min-h-0 flex-1">
        {/* Sidebar: one active row, one inactive. */}
        <div className="flex w-[28%] shrink-0 flex-col gap-[0.1875rem] border-e border-line p-1">
          <div className="h-[0.4375rem] rounded-[0.125rem] bg-active-fill" />
          <div className="h-[0.4375rem] rounded-[0.125rem] bg-hover" />
        </div>
        {/* Content: a card on the surface, which is the pair the theme is
            really about. */}
        <div className="flex-1 p-1">
          <div className="h-full rounded-[0.1875rem] border border-line bg-card" />
        </div>
      </div>
    </div>
  );
}

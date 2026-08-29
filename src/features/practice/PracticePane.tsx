import type { LucideIcon } from "lucide-react";
import { AudioLines, FileMusic, PictureInPicture2, Video, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type { Pane } from "@/lib/ipc";

export const PANE_ICONS: Record<Pane, LucideIcon> = {
  score: FileMusic,
  video: Video,
  audio: AudioLines,
};

/**
 * One practice pane, drawn identically whether it is a cell of the grid or
 * the whole of its own window. The content is still the §8.3 placeholder —
 * this milestone builds the seam the players in §15 will travel through, not
 * the players.
 */
export function PracticePane({
  pane,
  popped = false,
  onPopOut,
  onDockBack,
  className,
}: {
  pane: Pane;
  /** Drawn in a pop-out window, where the ⧉ button means the reverse. */
  popped?: boolean;
  onPopOut?: (pane: Pane) => void;
  onDockBack?: (pane: Pane) => void;
  className?: string;
}) {
  const { t } = useTranslation("common");
  const Icon = PANE_ICONS[pane];
  const title = t(`panes.${pane}`);
  // Resolved to a handler-or-nothing *before* it reaches the button, so a
  // pane given `popped` but no `onDockBack` draws a disabled control rather
  // than a live one that quietly does nothing when clicked. Wrapping the call
  // in an arrow first would make `onClick` always defined and defeat
  // `PaneButton`'s only test for whether it works.
  const travel = popped ? onDockBack : onPopOut;

  return (
    <section
      aria-label={title}
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-pane)] border border-line bg-card",
        className,
      )}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-line bg-hover px-3 py-2">
        <span className="flex items-center gap-2 text-[0.8125rem] font-semibold">
          <Icon size={15} aria-hidden className="text-muted-foreground" />
          {title}
        </span>
        <div className="flex items-center gap-0.5">
          {/* One button, two directions. The glyph was already drawn in the
              mockup for the outward trip; the return needs no new chrome, and
              a second control beside it would be two ways to say one thing. */}
          <PaneButton
            label={popped ? t("paneActions.dockBack") : t("paneActions.popOut")}
            onClick={travel ? () => travel(pane) : undefined}
          >
            <PictureInPicture2 size={15} aria-hidden />
          </PaneButton>
          {/* Still inert, and still says so. A working × needs a way to bring
              a *closed* pane back, which is pane management rather than
              pop-out — §7 of the design keeps the two apart. */}
          <PaneButton label={t("paneActions.closePane")}>
            <X size={15} aria-hidden />
          </PaneButton>
        </div>
      </header>
      <div className="grid flex-1 place-items-center p-6 text-center">
        <div className="flex flex-col items-center gap-2">
          <Icon size={26} aria-hidden className="text-muted-foreground/50" />
          <p className="max-w-[22ch] text-[0.8125rem] text-muted-foreground">
            {t(`paneEmpty.${pane}`)}
          </p>
          <span className="rounded-full border border-line bg-hover px-2.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
            {t("inDevelopment")}
          </span>
        </div>
      </div>
    </section>
  );
}

function PaneButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const disabled = onClick === undefined;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled || undefined}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "grid size-7 place-items-center rounded-[var(--radius-control)] text-muted-foreground",
        disabled
          ? "opacity-50"
          : "transition-colors duration-[var(--motion-fast)] ease-(--ease-standard) hover:bg-active-fill hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

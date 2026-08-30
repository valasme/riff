import { listen } from "@tauri-apps/api/event";
import type { LucideIcon } from "lucide-react";
import { PictureInPicture2, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { fire, ipc, type Pane, type RiffError } from "@/lib/ipc";
import { PANE_ICONS } from "./paneIcons";
import { ScoreViewer } from "./score/ScoreViewer";
import { scoreErrorMessage } from "./score/scoreError";
import { useOpenScore } from "./score/useOpenScore";

/**
 * One practice pane, drawn identically whether it is a cell of the grid or
 * the whole of its own window. Video and Audio are still the §8.3
 * placeholder; Score is the first of the three players plan 13 built this
 * seam for.
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
  const { t } = useTranslation(["common", "errors"]);
  const Icon = PANE_ICONS[pane];
  const title = t(`panes.${pane}`);
  // Resolved to a handler-or-nothing *before* it reaches the button, so a
  // pane given `popped` but no `onDockBack` draws a disabled control rather
  // than a live one that quietly does nothing when clicked. Wrapping the call
  // in an arrow first would make `onClick` always defined and defeat
  // `PaneButton`'s only test for whether it works.
  const travel = popped ? onDockBack : onPopOut;

  const isScore = pane === "score";
  // The hook itself is still called unconditionally — a pane's identity
  // does not change across its lifetime, so this is not a conditional hook
  // — but `enabled: false` skips the round trip and the listener for the
  // two panes with nothing to read.
  const openScore = useOpenScore(isScore);
  const [scoreError, setScoreError] = useState<string | null>(null);

  useEffect(() => {
    if (!isScore) return;
    // The Rust side of a failed drop (`lib.rs`'s `WindowEvent::DragDrop`
    // handler) has no command promise to reject — it is not a response to a
    // call this window made — so it is reported through this event instead.
    const unlisten = listen<RiffError>("score://drop-failed", (event) => {
      setScoreError(scoreErrorMessage(event.payload, t));
    });
    return () => void unlisten.then((off) => off());
  }, [isScore, t]);

  async function handleOpenScore() {
    setScoreError(null);
    try {
      await ipc.scoreOpen();
    } catch (error) {
      setScoreError(scoreErrorMessage(error, t));
    }
  }

  function handleCloseScore() {
    fire(ipc.scoreClose(), "closing the score");
  }

  const closeScore = isScore && openScore ? handleCloseScore : undefined;

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
          {/* Live for Score once a score is open — it closes the score, not
              the pane. Still inert for Video and Audio: a working × there
              needs a way to bring a *closed* pane back, which is pane
              management rather than pop-out — §7 of the design keeps the
              two apart. */}
          <PaneButton
            label={closeScore ? t("paneActions.closeScore") : t("paneActions.closePane")}
            onClick={closeScore}
          >
            <X size={15} aria-hidden />
          </PaneButton>
        </div>
      </header>
      {isScore && openScore ? (
        <ScoreViewer open={openScore} onLoadError={setScoreError} />
      ) : (
        <EmptyPaneBody
          icon={Icon}
          message={isScore ? (scoreError ?? t("paneEmpty.score")) : t(`paneEmpty.${pane}`)}
          action={
            isScore ? (
              <Button variant="outline" size="sm" onClick={() => void handleOpenScore()}>
                {t("paneActions.openScore")}
              </Button>
            ) : (
              <span className="rounded-full border border-line bg-hover px-2.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
                {t("inDevelopment")}
              </span>
            )
          }
        />
      )}
    </section>
  );
}

function EmptyPaneBody({
  icon: Icon,
  message,
  action,
}: {
  icon: LucideIcon;
  message: string;
  action: ReactNode;
}) {
  return (
    <div className="grid flex-1 place-items-center p-6 text-center">
      <div className="flex flex-col items-center gap-2">
        <Icon size={26} aria-hidden className="text-muted-foreground/50" />
        <p className="max-w-[22ch] text-[0.8125rem] text-muted-foreground">{message}</p>
        {action}
      </div>
    </div>
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

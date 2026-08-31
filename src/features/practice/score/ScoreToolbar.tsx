import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Maximize2,
  RotateCw,
  ScrollText,
  StretchHorizontal,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type { View } from "@/lib/ipc";
import { clampPage, nextFit, nextRotation, nextScrollMode, nextSpread } from "./geometry";

/**
 * The row beneath the pane header. **A labelled group of ordinary tabbable
 * buttons, not `role="toolbar"`** — and that is not an oversight.
 *
 * The ARIA toolbar pattern moves focus between its controls with the arrow
 * keys, and spec §6.1 binds Left and Right to turning pages so a commodity
 * page-turner pedal works. Both would fire on one keystroke, and `chord.ts`
 * has no notion of "focus is inside a roving group" — only `isTypingTarget`,
 * which covers text fields. A row of plain tabbable buttons under an
 * `aria-label` is fully accessible, costs a few tab stops, and removes the
 * collision rather than guarding it. `role="toolbar"` looks like an obvious
 * improvement here and would silently break the most important interaction
 * in the application.
 */
export function ScoreToolbar({
  page,
  pageCount,
  view,
  onGoToPage,
  onViewChange,
  onZoom,
}: {
  page: number;
  pageCount: number;
  view: View;
  onGoToPage: (page: number) => void;
  onViewChange: (patch: Partial<View>) => void;
  /** Separate from `onViewChange` because stepping out of a fit mode has to
   *  start from the scale pdf.js actually resolved, which only the viewer
   *  knows. */
  onZoom: (direction: 1 | -1) => void;
}) {
  const { t } = useTranslation("common");
  const fit = nextFit(view.scale);

  return (
    <div
      // The container the overflow queries in `score.css` measure. Later
      // tiers of controls (spec §5.1) collapse against this, not against the
      // window — a viewport media query cannot see UI scale at all.
      className="@container/score-toolbar shrink-0 border-b border-line bg-card"
    >
      {/* A `fieldset` is the HTML element for `role="group"`: it takes a
          name and carries no keyboard behaviour of its own. Not
          `role="toolbar"`, whose roving arrow keys would fight the page-turn
          chords; and not a bare `div`, whose generic role does not support
          `aria-label` at all, so the name would be dropped on the floor.
          `min-w-0` because a fieldset defaults to `min-width: min-content`,
          which stops a flex row from ever shrinking below its contents —
          the opposite of what the overflow queries need. */}
      <fieldset
        aria-label={t("score.toolbar")}
        className="flex min-w-0 items-center gap-1 px-2 py-1"
      >
        <ToolbarButton
          label={t("score.previousPage")}
          onClick={() => onGoToPage(page - 1)}
          disabled={page <= 1}
        >
          <ChevronLeft size={15} aria-hidden />
        </ToolbarButton>
        <PageField page={page} pageCount={pageCount} onGoToPage={onGoToPage} />
        <ToolbarButton
          label={t("score.nextPage")}
          onClick={() => onGoToPage(page + 1)}
          disabled={page >= pageCount}
        >
          <ChevronRight size={15} aria-hidden />
        </ToolbarButton>

        <Separator />

        {/* Always visible: without a fit control a score that is too wide or
            too tall has no way back.

            Labelled with what pressing it *does*, not with the mode it is
            in — and both come from one `nextFit` call, because computing
            them separately is how a button ends up saying "Fit page" while
            taking you to fit width. Not `aria-pressed`: this alternates
            between two modes rather than toggling one thing on and off. */}
        <ToolbarButton
          label={fit.mode === "fit-page" ? t("score.fitPage") : t("score.fitWidth")}
          onClick={() => onViewChange({ scale: fit })}
        >
          {fit.mode === "fit-page" ? (
            <Maximize2 size={15} aria-hidden />
          ) : (
            <StretchHorizontal size={15} aria-hidden />
          )}
        </ToolbarButton>

        <Tier tier="next">
          <ToolbarButton label={t("score.zoomOut")} onClick={() => onZoom(-1)}>
            <ZoomOut size={15} aria-hidden />
          </ToolbarButton>
          <ToolbarButton label={t("score.zoomIn")} onClick={() => onZoom(1)}>
            <ZoomIn size={15} aria-hidden />
          </ToolbarButton>
          {/* Continuous or one page at a time. On the toolbar rather than
              buried because the two suit two different users: continuous is
              what auto-scroll is for, page-at-a-time is what a pedal user
              wants, since a turn then lands on a whole page rather than
              somewhere between two. */}
          <ToolbarButton
            label={t(`score.scrollMode.${view.scrollMode}`)}
            pressed={view.scrollMode === "page"}
            onClick={() => onViewChange({ scrollMode: nextScrollMode(view.scrollMode) })}
          >
            <ScrollText size={15} aria-hidden />
          </ToolbarButton>
          <ToolbarButton
            label={t(`score.spread.${view.spread}`)}
            pressed={view.spread !== "none"}
            onClick={() => onViewChange({ spread: nextSpread(view.spread) })}
          >
            <Columns2 size={15} aria-hidden />
          </ToolbarButton>
          <ToolbarButton
            label={t("score.rotate")}
            onClick={() => onViewChange({ rotation: nextRotation(view.rotation) })}
          >
            <RotateCw size={15} aria-hidden />
          </ToolbarButton>
        </Tier>
      </fieldset>
    </div>
  );
}

/**
 * One tier of the overflow order in spec §5.1. The tier is an attribute
 * rather than a class so `score.css` owns the widths it gives way at — see
 * `TOOLBAR_TIERS` in `geometry.ts` for why the two halves live apart.
 */
function Tier({ tier, children }: { tier: "next" | "last"; children: React.ReactNode }) {
  return (
    <div data-toolbar-tier={tier} className="flex items-center gap-1">
      {children}
    </div>
  );
}

function Separator() {
  return <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-line" />;
}

/**
 * A typeable page number. Held as a draft while typing so a half-entered
 * "1" on the way to "12" does not jump the score to page one on every
 * keystroke; committed on blur and on Enter.
 *
 * No keyboard guard is needed against the page-turn chords stealing the
 * arrow keys here: `useKeybindings` already skips every chord but `escape`
 * when `isTypingTarget` matches, and `"number"` is in its set — so arrows in
 * this field move the caret rather than the score. Recorded so nobody
 * solves it a second time.
 */
function PageField({
  page,
  pageCount,
  onGoToPage,
}: {
  page: number;
  pageCount: number;
  onGoToPage: (page: number) => void;
}) {
  const { t } = useTranslation("common");
  const [draft, setDraft] = useState<string | null>(null);
  const [shownPage, setShownPage] = useState(page);

  // The score can move without this field — a chord, a pedal, a search hit —
  // and a draft left over from half-typed input would then be a field
  // claiming a page the score is not on. Adjusted during render rather than
  // in an effect: React's documented way to reset state when a prop changes,
  // and it lands before paint instead of one frame after it.
  if (shownPage !== page) {
    setShownPage(page);
    setDraft(null);
  }

  function commit() {
    if (draft !== null) onGoToPage(clampPage(Number.parseInt(draft, 10), pageCount, page));
    setDraft(null);
  }

  return (
    <span className="flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
      <input
        type="number"
        inputMode="numeric"
        aria-label={t("score.pageNumber")}
        value={draft ?? String(page)}
        min={1}
        max={Math.max(pageCount, 1)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        className={cn(
          "h-6 w-11 rounded-[var(--radius-control)] border border-line bg-hover px-1.5",
          "text-center font-mono text-[0.75rem] tabular-nums text-foreground",
          "outline-none focus-visible:border-border-subtle",
          // The spinners are a pointer affordance for a field whose whole
          // point is that a musician is not holding a mouse.
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        )}
      />
      <span>{t("score.pageOf", { total: pageCount })}</span>
    </span>
  );
}

/**
 * At least 24×24 CSS pixels in both densities (spec §10). Density changes
 * spacing, never target size — a Compact toolbar has tighter gaps, not
 * smaller buttons — so this size is fixed rather than derived from
 * `--row-height`.
 */
function ToolbarButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** A control that is currently *on* — spread, page-at-a-time, a fit mode.
   *  `aria-pressed` rather than colour alone, so the state is available to a
   *  screen reader and not only to someone looking at the row. */
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-[var(--radius-control)] text-muted-foreground",
        disabled
          ? "opacity-40"
          : "transition-colors duration-[var(--motion-fast)] ease-(--ease-standard) hover:bg-active-fill hover:text-foreground",
        pressed && !disabled && "bg-active-fill text-foreground",
      )}
    >
      {children}
    </button>
  );
}

import { PictureInPicture2, Undo2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ipc, type Pane } from "@/lib/ipc";
import { dockedPanes, gridShape } from "./layout";
import { PANE_ICONS, PracticePane } from "./PracticePane";
import { usePoppedOut } from "./usePoppedOut";

/** Only `feature` is asymmetric, and only because three docked panes are
 *  necessarily all three of them — the mockup's arrangement, kept. */
const GRID: Record<ReturnType<typeof gridShape>, string> = {
  empty: "",
  full: "grid-cols-1 grid-rows-1",
  columns: "grid-cols-2 grid-rows-1",
  feature: "grid-cols-2 grid-rows-2",
};

export function PracticeGrid() {
  const poppedOut = usePoppedOut();
  const docked = dockedPanes(poppedOut);
  const shape = gridShape(docked);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {poppedOut.length > 0 && <PoppedOutStrip panes={poppedOut} />}
      {shape === "empty" ? (
        <EmptyState />
      ) : (
        <div className={`grid min-h-0 flex-1 gap-3 p-[var(--content-padding)] ${GRID[shape]}`}>
          {docked.map((pane, index) => (
            <PracticePane
              key={pane}
              pane={pane}
              // The tall cell exists only in the three-pane arrangement, and
              // there it is always the first one drawn.
              className={shape === "feature" && index === 0 ? "row-span-2" : undefined}
              onPopOut={(p) => void ipc.practicePopOut(p)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One chip per pane that is elsewhere. Without it a popped-out window that
 * has drifted behind another application is unreachable from Riff — the pane
 * is simply gone, with nothing on screen admitting it exists.
 */
function PoppedOutStrip({ panes }: { panes: Pane[] }) {
  const { t } = useTranslation("common");

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-[var(--content-padding)] py-2">
      <PictureInPicture2 size={14} aria-hidden className="text-muted-foreground" />
      {/* A real list, not a labelled div. The label needs a role to survive
          at all, and "these panes are elsewhere" is exactly a list — which
          also tells a screen reader how many there are before it reads the
          first. The icon stays outside it: only `li` may be a child of `ul`. */}
      <ul aria-label={t("panesOut.strip")} className="flex flex-wrap items-center gap-2">
        {panes.map((pane) => {
          const Icon = PANE_ICONS[pane];
          const name = t(`panes.${pane}`);
          return (
            <li
              key={pane}
              className="flex items-center rounded-full border border-line bg-hover text-[0.75rem] font-medium"
            >
              <button
                type="button"
                aria-label={t("panesOut.focus", { pane: name })}
                onClick={() => void ipc.practiceFocus(pane)}
                className="flex items-center gap-1.5 rounded-l-full py-1 ps-2.5 pe-1.5 text-muted-foreground transition-colors duration-[var(--motion-fast)] ease-(--ease-standard) hover:text-foreground"
              >
                <Icon size={13} aria-hidden />
                {name}
              </button>
              <button
                type="button"
                aria-label={t("panesOut.dockBack", { pane: name })}
                onClick={() => void ipc.practiceDockBack(pane)}
                className="grid size-6 place-items-center rounded-r-full text-muted-foreground transition-colors duration-[var(--motion-fast)] ease-(--ease-standard) hover:bg-active-fill hover:text-foreground"
              >
                <X size={12} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation("common");

  return (
    <div className="grid flex-1 place-items-center p-[var(--content-padding)] text-center">
      <div className="flex flex-col items-center gap-3">
        <PictureInPicture2 size={30} aria-hidden className="text-muted-foreground/50" />
        <h2 className="text-[0.9375rem] font-semibold">{t("panesOut.emptyTitle")}</h2>
        <p className="max-w-[38ch] text-[0.8125rem] text-muted-foreground">
          {t("panesOut.emptyBody")}
        </p>
        <button
          type="button"
          onClick={() => void ipc.practiceDockAll()}
          className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-hover px-3 py-1.5 text-[0.8125rem] font-medium transition-colors duration-[var(--motion-fast)] ease-(--ease-standard) hover:bg-active-fill"
        >
          <Undo2 size={14} aria-hidden />
          {t("panesOut.bringAllBack")}
        </button>
      </div>
    </div>
  );
}

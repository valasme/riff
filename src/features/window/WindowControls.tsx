import { useTranslation } from "react-i18next";
import { fire, ipc } from "@/lib/ipc";
import { useWindowMaximized } from "./useWindowMaximized";
import { WindowGlyph } from "./WindowGlyph";

/** Square, rounded, and separated from the window edge rather than welded to
 *  it. The old controls ran flush into the right-hand border, so the close
 *  button's hover fill bled off the corner. */
const BUTTON =
  "grid size-8 place-items-center rounded-[var(--radius-control)] text-muted-foreground transition-colors duration-[var(--motion-fast)] ease-(--ease-standard) hover:bg-hover hover:text-foreground";

export function WindowControls() {
  const { t } = useTranslation("nav");
  const maximized = useWindowMaximized();

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        className={BUTTON}
        aria-label={t("minimize")}
        onClick={() => fire(ipc.windowMinimize(), "minimising the window")}
      >
        <WindowGlyph shape="minimize" />
      </button>
      <button
        type="button"
        className={BUTTON}
        // Telling a screen-reader user the button maximizes a window that is
        // already maximized is worse than not labelling it at all.
        aria-label={maximized ? t("restore") : t("maximize")}
        onClick={() => fire(ipc.windowToggleMaximize(), "maximising the window")}
      >
        <WindowGlyph shape={maximized ? "restore" : "maximize"} />
      </button>
      <button
        type="button"
        className={BUTTON}
        aria-label={t("closeWindow")}
        onClick={() => fire(ipc.windowClose(), "closing the window")}
      >
        <WindowGlyph shape="close" />
      </button>
    </div>
  );
}

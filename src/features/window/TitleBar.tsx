import { PanelLeft, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { WindowControls } from "./WindowControls";

const ICON_BUTTON =
  "grid h-8 w-8 place-items-center rounded-md text-foreground transition-colors hover:bg-raised";

export function TitleBar({
  onToggleSidebar,
  onOpenPalette,
}: {
  onToggleSidebar?: () => void;
  onOpenPalette?: () => void;
}) {
  const { t } = useTranslation("nav");

  return (
    <header
      data-tauri-drag-region
      className="flex h-[var(--spacing-titlebar)] shrink-0 items-center gap-2 bg-surface ps-2 pe-0"
    >
      <button
        type="button"
        className={ICON_BUTTON}
        aria-label={t("toggleSidebar")}
        onClick={onToggleSidebar}
      >
        <PanelLeft size={18} aria-hidden />
      </button>

      {/* The wordmark is the one place Playfair appears. */}
      <span className="select-none font-display text-[1.375rem] italic leading-none">riff</span>

      {/* The mouse equivalent of Alt+K. Plan 09 supplies the handler. */}
      <button
        type="button"
        className={ICON_BUTTON}
        aria-label={t("openPalette")}
        onClick={onOpenPalette}
      >
        <Search size={16} aria-hidden />
      </button>

      <div data-tauri-drag-region className="h-full flex-1" />
      <WindowControls />
    </header>
  );
}

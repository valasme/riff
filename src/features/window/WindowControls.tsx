import { Minus, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ipc } from "@/lib/ipc";

const BUTTON = "grid h-8 w-11 place-items-center text-foreground transition-colors hover:bg-raised";

export function WindowControls({ maximized = false }: { maximized?: boolean }) {
  const { t } = useTranslation("nav");
  return (
    <div className="flex items-center">
      <button
        type="button"
        className={BUTTON}
        aria-label={t("minimize")}
        onClick={() => void ipc.windowMinimize()}
      >
        <Minus size={16} aria-hidden />
      </button>
      <button
        type="button"
        className={BUTTON}
        // Telling a screen-reader user the button maximizes a window that is
        // already maximized is worse than not labelling it at all.
        aria-label={maximized ? t("restore") : t("maximize")}
        onClick={() => void ipc.windowToggleMaximize()}
      >
        <Square size={13} aria-hidden />
      </button>
      <button
        type="button"
        className={BUTTON}
        aria-label={t("closeWindow")}
        onClick={() => void ipc.windowClose()}
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

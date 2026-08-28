import { PictureInPicture2, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

/**
 * Faithful to the mockup and deliberately inert. No resizing, no closing.
 * The layout engine arrives with the content that needs it.
 */
export function PracticePlaceholder() {
  const { t } = useTranslation("common");

  return (
    <div className="grid h-full grid-cols-2 gap-4 p-[var(--content-padding)]">
      <Pane title={t("panes.score")} className="row-span-2" />
      <Pane title={t("panes.video")} />
      <Pane title={t("panes.audio")} />
    </div>
  );
}

function Pane({ title, className }: { title: string; className?: string }) {
  const { t } = useTranslation("common");

  return (
    <section
      aria-label={title}
      className={cn("flex min-h-0 flex-col rounded-[var(--radius-pane)] bg-raised", className)}
    >
      <header className="flex items-center justify-between border-b border-separator px-3 py-2">
        <span className="text-sm font-medium">{title}</span>
        <div className="flex items-center gap-1">
          <PaneButton label={t("paneActions.popOut")}>
            <PictureInPicture2 size={15} aria-hidden />
          </PaneButton>
          <PaneButton label={t("paneActions.closePane")}>
            <X size={15} aria-hidden />
          </PaneButton>
        </div>
      </header>
      <div className="grid flex-1 place-items-center">
        <span className="rounded-full bg-surface px-3 py-1 text-xs text-muted-foreground">
          {t("inDevelopment")}
        </span>
      </div>
    </section>
  );
}

function PaneButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      aria-label={label}
      title={label}
      className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground opacity-60"
    >
      {children}
    </button>
  );
}

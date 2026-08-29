import type { LucideIcon } from "lucide-react";
import { AudioLines, FileMusic, PictureInPicture2, Video, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

/**
 * Faithful to the mockup's three-pane arrangement and deliberately inert. No
 * resizing, no closing. The layout engine arrives with the content that needs
 * it (§15).
 *
 * Each pane now names what it is waiting for rather than showing a bare "In
 * development" pill on an empty rectangle — the pill said the feature was
 * unfinished but not what the feature was.
 */
export function PracticePlaceholder() {
  const { t } = useTranslation("common");

  return (
    <div className="grid h-full grid-cols-2 grid-rows-2 gap-3 p-[var(--content-padding)]">
      <Pane
        title={t("panes.score")}
        icon={FileMusic}
        blurb={t("paneEmpty.score")}
        className="row-span-2"
      />
      <Pane title={t("panes.video")} icon={Video} blurb={t("paneEmpty.video")} />
      <Pane title={t("panes.audio")} icon={AudioLines} blurb={t("paneEmpty.audio")} />
    </div>
  );
}

function Pane({
  title,
  icon: Icon,
  blurb,
  className,
}: {
  title: string;
  icon: LucideIcon;
  blurb: string;
  className?: string;
}) {
  const { t } = useTranslation("common");

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
          <PaneButton label={t("paneActions.popOut")}>
            <PictureInPicture2 size={15} aria-hidden />
          </PaneButton>
          <PaneButton label={t("paneActions.closePane")}>
            <X size={15} aria-hidden />
          </PaneButton>
        </div>
      </header>
      <div className="grid flex-1 place-items-center p-6 text-center">
        <div className="flex flex-col items-center gap-2">
          <Icon size={26} aria-hidden className="text-muted-foreground/50" />
          <p className="max-w-[22ch] text-[0.8125rem] text-muted-foreground">{blurb}</p>
          <span className="rounded-full border border-line bg-hover px-2.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
            {t("inDevelopment")}
          </span>
        </div>
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
      className="grid size-7 place-items-center rounded-[var(--radius-control)] text-muted-foreground opacity-50"
    >
      {children}
    </button>
  );
}

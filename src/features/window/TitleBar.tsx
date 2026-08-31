import type { LucideIcon } from "lucide-react";
import { PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Wordmark } from "@/components/Wordmark";
import { WindowControls } from "./WindowControls";
import { handleWindowDrag } from "./windowDrag";

export function TitleBar({
  onToggleSidebar,
  onOpenPalette,
  sidebarCollapsed = false,
  badge,
}: {
  onToggleSidebar?: () => void;
  onOpenPalette?: () => void;
  sidebarCollapsed?: boolean;
  /** Takes the sidebar toggle's place in a pop-out window, which has no
   *  sidebar to toggle. It says which pane this window is, and it is not a
   *  control — there is nothing here for it to do. */
  badge?: { icon: LucideIcon; label: string };
}) {
  const { t } = useTranslation(["nav", "palette"]);

  // One icon for one state was the bug: `panel-left` looked identical whether
  // the sidebar was open or shut, so the control never said which way it was
  // about to go. Two icons, and the label follows them.
  const ToggleIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;
  const toggleLabel = sidebarCollapsed ? t("nav:expandSidebar") : t("nav:collapseSidebar");

  return (
    // A provider per component rather than one at the root: the title bar and
    // the sidebar are both rendered in isolation by their tests, and a Radix
    // tooltip outside a provider throws. Nesting providers is supported and
    // costs nothing.
    <TooltipProvider delayDuration={500}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: A native window drag is pointer-only; a role or keyboard binding would falsely expose the whole titlebar as a control. */}
      <header
        onMouseDown={handleWindowDrag}
        // `border-b` is the line the bar never had. Without it the title bar
        // and the content below it were the same flat #242424 with nothing
        // between them, so the window read as one undifferentiated slab.
        className="@container/titlebar relative z-30 flex h-[var(--spacing-titlebar)] shrink-0 items-center gap-3 border-b border-line bg-surface px-2"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {badge ? (
            <span className="grid size-8 shrink-0 place-items-center text-muted-foreground">
              <badge.icon size={17} aria-hidden />
            </span>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={toggleLabel}
                  aria-expanded={!sidebarCollapsed}
                  onClick={onToggleSidebar}
                  // The rectangle appears on hover, not at rest. A tile that is
                  // always filled reads as a permanently pressed control and is
                  // the only thing in the bar competing with the wordmark; the
                  // fill on hover is still what gives hover and focus a target.
                  className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] text-muted-foreground transition-colors duration-[var(--motion-fast)] ease-(--ease-standard) hover:bg-hover hover:text-foreground"
                >
                  <ToggleIcon size={17} aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8}>
                {toggleLabel}
                <Kbd chord="Ctrl+B" />
              </TooltipContent>
            </Tooltip>
          )}

          {/* Sized and spaced by the component; see Wordmark for why the
              trailing padding is not a `gap`. */}
          <Wordmark className="text-[1.375rem]" />
          {badge && (
            <span className="truncate text-[0.8125rem] font-medium text-muted-foreground">
              {badge.label}
            </span>
          )}
        </div>

        {/* Centred by the two `flex-1` siblings, not by a magic margin, so it
            stays centred as the window resizes. Replacing the bare search
            glyph with a labelled target is the actual fix for it sitting a
            few pixels from the wordmark: a 16px icon needs a 16px gap to look
            deliberate, and at that distance it looked like part of the mark.
            A field-shaped trigger cannot be mistaken for one. */}
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label={t("nav:openPalette")}
          aria-keyshortcuts="Alt+K"
          className="group flex h-8 w-full max-w-[24rem] shrink items-center gap-2 rounded-[var(--radius-control)] border border-line bg-hover px-2.5 text-muted-foreground transition-colors duration-[var(--motion-fast)] ease-(--ease-standard) hover:border-border-subtle hover:bg-active-fill hover:text-foreground @max-[44rem]/titlebar:w-8 @max-[44rem]/titlebar:justify-center @max-[44rem]/titlebar:px-0"
        >
          <Search size={15} aria-hidden className="shrink-0" />
          <span className="flex-1 truncate text-start text-[0.8125rem] @max-[44rem]/titlebar:hidden">
            {t("palette:placeholder")}
          </span>
          <Kbd chord="Alt+K" className="@max-[44rem]/titlebar:hidden" />
        </button>

        <div className="flex flex-1 items-center justify-end">
          <WindowControls />
        </div>
      </header>
    </TooltipProvider>
  );
}

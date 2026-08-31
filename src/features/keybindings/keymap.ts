import type { LucideIcon } from "lucide-react";
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Contrast,
  FileCog,
  FileMusic,
  FolderOpen,
  Gauge,
  History,
  Info,
  LogOut,
  Maximize2,
  Music4,
  PanelLeft,
  PictureInPicture2,
  Pin,
  Play,
  RotateCw,
  Rows3,
  ScrollText,
  Search,
  Settings,
  SquareX,
  SunMoon,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { PANES } from "@/features/practice/layout";
import type { ScoreCommand } from "@/features/practice/score/commands";
import type {
  DeepPartial,
  OpenScore,
  Pane,
  PathKind,
  Settings as SettingsShape,
  Theme,
} from "@/lib/ipc";

/** Which window is asking. A pop-out is a pane, not a second copy of the
 *  application. */
export type KeymapScope = "main" | "popout";

export interface KeymapContext {
  scope: KeymapScope;
  /** The pane this window shows. Only meaningful when `scope` is "popout". */
  pane?: Pane;
  navigate: (options: { to: string }) => void;
  togglePalette: () => void;
  toggleSidebar: () => void;
  patch: (patch: DeepPartial<SettingsShape>) => void;
  settings: {
    appearance: {
      theme: Theme;
      density: "comfortable" | "compact";
      highContrast: boolean;
    };
  };
  openPath: (kind: PathKind) => void;
  popOut: (pane: Pane) => void;
  dockBack: (pane: Pane) => void;
  dockAll: () => void;
  quit: () => void;
  closeOverlay: () => void;
  /**
   * Whether a score is open, mirrored from Rust by `useOpenScore()`. Only
   * the *identity* reaches here: the view stays local to the viewer, since
   * putting a value that changes on every page turn into the settings store
   * would re-render every primitive selector subscriber each time.
   */
  openScore: OpenScore | null;
  openScorePicker: () => void;
  closeScore: () => void;
  scoreCommand: (command: ScoreCommand) => void;
}

export interface Keybinding {
  id: string;
  /** Empty means palette-only: no chord, still runnable by name. */
  chord: string;
  descriptionKey: string;
  group: "navigation" | "appearance" | "score" | "application";
  /** Rendered by the palette. Lives here rather than in a lookup table beside
   *  the palette so that this file stays the whole answer to "what can Riff
   *  do" — a command added here arrives complete. */
  icon: LucideIcon;
  /** An alternative chord for an action already listed. Bound, not shown. */
  hidden?: boolean;
  /** Which windows this command exists in. Absent means all of them.
   *  Scoping removes the binding entirely rather than disabling it, so the
   *  chord is dead in a window the command does not belong to — `Alt+3` in a
   *  score window would otherwise replace the score with Settings, in a
   *  window with no sidebar to navigate back out by. */
  scope?: KeymapScope;
  /** Whether the command exists *right now*. Absent means always.
   *
   *  Follows `scope`'s doctrine exactly: a command that is unavailable is
   *  removed, not disabled — so its chord is dead rather than silently doing
   *  nothing, and the palette does not grow a dozen dead rows in an empty
   *  workspace. The two are applied by the same filter at the end of
   *  `createKeymap`. */
  available?: (ctx: KeymapContext) => boolean;
  run: () => void;
}

/**
 * Dark → Darker → Light → Dark. With three themes the old two-way flip has no
 * meaning, and an order that skips one of them would make the command feel
 * broken to whoever chose the one it skips.
 */
const THEME_CYCLE: Theme[] = ["dark", "darker", "light"];

export function nextTheme(current: Theme): Theme {
  const index = THEME_CYCLE.indexOf(current);
  return THEME_CYCLE[(index + 1) % THEME_CYCLE.length] ?? "dark";
}

/**
 * The single source of truth for what Riff can do from the keyboard. The
 * palette renders this list, so a command added here is discoverable without
 * touching the palette, and a future Shortcuts settings page is nearly free.
 */
export function createKeymap(ctx: KeymapContext): Keybinding[] {
  const { appearance } = ctx.settings;

  const bindings: Keybinding[] = [
    {
      id: "nav.practice",
      scope: "main",
      chord: "alt+1",
      group: "navigation",
      icon: Music4,
      descriptionKey: "palette:commands.nav.practice",
      run: () => ctx.navigate({ to: "/practice" }),
    },
    {
      id: "nav.history",
      scope: "main",
      chord: "alt+2",
      group: "navigation",
      icon: History,
      descriptionKey: "palette:commands.nav.history",
      run: () => ctx.navigate({ to: "/history" }),
    },
    {
      id: "nav.settings",
      scope: "main",
      chord: "alt+3",
      group: "navigation",
      icon: Settings,
      descriptionKey: "palette:commands.nav.settings",
      run: () => ctx.navigate({ to: "/settings/general" }),
    },
    // Second chord for the same action. `hidden` keeps it out of the palette:
    // two rows reading "Go to Settings" would carry the same cmdk `value`, and
    // duplicate values make cmdk select both at once.
    {
      id: "nav.settingsAlt",
      scope: "main",
      chord: "ctrl+,",
      group: "navigation",
      icon: Settings,
      hidden: true,
      descriptionKey: "palette:commands.nav.settings",
      run: () => ctx.navigate({ to: "/settings/general" }),
    },
    {
      id: "nav.about",
      scope: "main",
      chord: "",
      group: "navigation",
      icon: Info,
      descriptionKey: "palette:commands.nav.about",
      run: () => ctx.navigate({ to: "/settings/about" }),
    },

    {
      id: "ui.togglePalette",
      chord: "alt+k",
      group: "application",
      icon: Search,
      descriptionKey: "palette:commands.ui.togglePalette",
      run: ctx.togglePalette,
    },
    {
      id: "ui.toggleSidebar",
      scope: "main",
      chord: "ctrl+b",
      group: "application",
      icon: PanelLeft,
      descriptionKey: "palette:commands.ui.toggleSidebar",
      run: ctx.toggleSidebar,
    },

    {
      id: "appearance.toggleTheme",
      chord: "",
      group: "appearance",
      icon: SunMoon,
      descriptionKey: "palette:commands.appearance.toggleTheme",
      run: () => ctx.patch({ appearance: { theme: nextTheme(appearance.theme) } }),
    },
    {
      id: "appearance.toggleDensity",
      chord: "",
      group: "appearance",
      icon: Rows3,
      descriptionKey: "palette:commands.appearance.toggleDensity",
      run: () =>
        ctx.patch({
          appearance: { density: appearance.density === "comfortable" ? "compact" : "comfortable" },
        }),
    },
    {
      id: "appearance.toggleContrast",
      chord: "",
      group: "appearance",
      icon: Contrast,
      descriptionKey: "palette:commands.appearance.toggleContrast",
      run: () => ctx.patch({ appearance: { highContrast: !appearance.highContrast } }),
    },

    ...PANES.map(
      (pane): Keybinding => ({
        id: `practice.popOut.${pane}`,
        chord: "",
        group: "application",
        scope: "main",
        icon: PictureInPicture2,
        descriptionKey: `palette:commands.practice.popOut.${pane}`,
        run: () => ctx.popOut(pane),
      }),
    ),
    {
      id: "practice.dockAll",
      chord: "",
      group: "application",
      scope: "main",
      icon: Undo2,
      descriptionKey: "palette:commands.practice.dockAll",
      run: ctx.dockAll,
    },
    {
      id: "practice.dockBack",
      chord: "",
      group: "application",
      scope: "popout",
      icon: Undo2,
      descriptionKey: "palette:commands.practice.dockBack",
      run: () => {
        if (ctx.pane) ctx.dockBack(ctx.pane);
      },
    },

    // The score. `openScore` is always available — it is how an empty
    // workspace stops being one — and everything else exists only while a
    // score is open, so the palette does not grow a dozen dead rows for a
    // pane with nothing in it.
    //
    // Chords go to opening, page turning, zoom and search; the rest are
    // palette-only, discoverable by name and unbound. There is deliberately
    // no pane focus model: these are live in whichever window is focused,
    // which is exactly what makes a page-turner pedal work at all, and the
    // debt comes due when Video lands and two panes want one chord.
    {
      id: "score.open",
      chord: "ctrl+o",
      group: "score",
      icon: FileMusic,
      descriptionKey: "palette:commands.score.open",
      run: ctx.openScorePicker,
    },
    {
      id: "score.close",
      chord: "",
      group: "score",
      icon: SquareX,
      available: (c) => c.openScore !== null,
      descriptionKey: "palette:commands.score.close",
      run: ctx.closeScore,
    },
    // Page Up/Page Down and Left/Right, because that is what a commodity
    // pedal sends — see PAGE_TURN_CHORDS. Up and Down stay unbound so they
    // keep scrolling. The second chord for each is `hidden`, since two
    // palette rows reading "Next page" would carry the same cmdk value.
    {
      id: "score.nextPage",
      chord: "pagedown",
      group: "score",
      icon: ChevronRight,
      available: (c) => c.openScore !== null,
      descriptionKey: "palette:commands.score.nextPage",
      run: () => ctx.scoreCommand({ kind: "page", delta: 1 }),
    },
    {
      id: "score.nextPageAlt",
      chord: "arrowright",
      group: "score",
      icon: ChevronRight,
      hidden: true,
      available: (c) => c.openScore !== null,
      descriptionKey: "palette:commands.score.nextPage",
      run: () => ctx.scoreCommand({ kind: "page", delta: 1 }),
    },
    {
      id: "score.previousPage",
      chord: "pageup",
      group: "score",
      icon: ChevronLeft,
      available: (c) => c.openScore !== null,
      descriptionKey: "palette:commands.score.previousPage",
      run: () => ctx.scoreCommand({ kind: "page", delta: -1 }),
    },
    {
      id: "score.previousPageAlt",
      chord: "arrowleft",
      group: "score",
      icon: ChevronLeft,
      hidden: true,
      available: (c) => c.openScore !== null,
      descriptionKey: "palette:commands.score.previousPage",
      run: () => ctx.scoreCommand({ kind: "page", delta: -1 }),
    },
    {
      id: "score.zoomIn",
      chord: "ctrl+=",
      group: "score",
      icon: ZoomIn,
      available: (c) => c.openScore !== null,
      descriptionKey: "palette:commands.score.zoomIn",
      run: () => ctx.scoreCommand({ kind: "zoom", direction: 1 }),
    },
    {
      id: "score.zoomOut",
      chord: "ctrl+-",
      group: "score",
      icon: ZoomOut,
      available: (c) => c.openScore !== null,
      descriptionKey: "palette:commands.score.zoomOut",
      run: () => ctx.scoreCommand({ kind: "zoom", direction: -1 }),
    },
    {
      id: "score.fit",
      chord: "",
      group: "score",
      icon: Maximize2,
      available: (c) => c.openScore !== null,
      descriptionKey: "palette:commands.score.fit",
      run: () => ctx.scoreCommand({ kind: "fit" }),
    },
    {
      id: "score.search",
      chord: "ctrl+f",
      group: "score",
      icon: Search,
      available: (c) => c.openScore !== null,
      descriptionKey: "palette:commands.score.search",
      run: () => ctx.scoreCommand({ kind: "search" }),
    },
    {
      id: "score.rotate",
      chord: "",
      group: "score",
      icon: RotateCw,
      available: (c) => c.openScore !== null,
      descriptionKey: "palette:commands.score.rotate",
      run: () => ctx.scoreCommand({ kind: "rotate" }),
    },
    {
      id: "score.spread",
      chord: "",
      group: "score",
      icon: Columns2,
      available: (c) => c.openScore !== null,
      descriptionKey: "palette:commands.score.spread",
      run: () => ctx.scoreCommand({ kind: "spread" }),
    },
    {
      id: "score.scrollMode",
      chord: "",
      group: "score",
      icon: ScrollText,
      available: (c) => c.openScore !== null,
      descriptionKey: "palette:commands.score.scrollMode",
      run: () => ctx.scoreCommand({ kind: "scrollMode" }),
    },
    {
      id: "score.autoScroll",
      chord: "",
      group: "score",
      icon: Play,
      available: (c) => c.openScore !== null,
      descriptionKey: "palette:commands.score.autoScroll",
      run: () => ctx.scoreCommand({ kind: "autoScroll" }),
    },
    // The `±` chords spec §6.3 asks for. Stoppability from three surfaces is
    // what the reduced-motion exemption rests on, and this is one of them.
    {
      id: "score.speedUp",
      chord: "ctrl+shift+=",
      group: "score",
      icon: Gauge,
      available: (c) => c.openScore !== null,
      descriptionKey: "palette:commands.score.speedUp",
      run: () => ctx.scoreCommand({ kind: "speed", delta: 1 }),
    },
    {
      id: "score.speedDown",
      chord: "ctrl+shift+-",
      group: "score",
      icon: Gauge,
      available: (c) => c.openScore !== null,
      descriptionKey: "palette:commands.score.speedDown",
      run: () => ctx.scoreCommand({ kind: "speed", delta: -1 }),
    },
    {
      id: "score.pin",
      chord: "",
      group: "score",
      icon: Pin,
      available: (c) => c.openScore !== null,
      descriptionKey: "palette:commands.score.pin",
      run: () => ctx.scoreCommand({ kind: "pin" }),
    },

    {
      id: "app.openConfig",
      chord: "",
      group: "application",
      icon: FileCog,
      descriptionKey: "palette:commands.app.openConfig",
      run: () => ctx.openPath("config"),
    },
    {
      id: "app.openLogs",
      chord: "",
      group: "application",
      icon: FolderOpen,
      descriptionKey: "palette:commands.app.openLogs",
      run: () => ctx.openPath("logs"),
    },
    {
      id: "app.quit",
      chord: "ctrl+q",
      group: "application",
      icon: LogOut,
      descriptionKey: "palette:commands.app.quit",
      run: ctx.quit,
    },

    // Radix already closes its own overlays on Escape, so this binds nothing
    // new — it is here because §9 lists Escape, and a Shortcuts page built
    // from this registry has to be able to show it. `hidden` keeps it out of
    // the palette, where "close this palette" would be noise.
    {
      id: "ui.closeOverlay",
      chord: "escape",
      group: "application",
      icon: X,
      hidden: true,
      descriptionKey: "palette:commands.ui.closeOverlay",
      run: ctx.closeOverlay,
    },
  ];

  return bindings.filter(
    (b) =>
      (b.scope === undefined || b.scope === ctx.scope) &&
      (b.available === undefined || b.available(ctx)),
  );
}

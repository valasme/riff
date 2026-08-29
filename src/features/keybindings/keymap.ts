import type { LucideIcon } from "lucide-react";
import {
  Contrast,
  FileCog,
  FolderOpen,
  History,
  Info,
  LogOut,
  Music4,
  PanelLeft,
  Rows3,
  Search,
  Settings,
  SunMoon,
  X,
} from "lucide-react";
import type { DeepPartial, PathKind, Settings as SettingsShape, Theme } from "@/lib/ipc";

export interface KeymapContext {
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
  quit: () => void;
  closeOverlay: () => void;
}

export interface Keybinding {
  id: string;
  /** Empty means palette-only: no chord, still runnable by name. */
  chord: string;
  descriptionKey: string;
  group: "navigation" | "appearance" | "application";
  /** Rendered by the palette. Lives here rather than in a lookup table beside
   *  the palette so that this file stays the whole answer to "what can Riff
   *  do" — a command added here arrives complete. */
  icon: LucideIcon;
  /** An alternative chord for an action already listed. Bound, not shown. */
  hidden?: boolean;
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

  return [
    {
      id: "nav.practice",
      chord: "alt+1",
      group: "navigation",
      icon: Music4,
      descriptionKey: "palette:commands.nav.practice",
      run: () => ctx.navigate({ to: "/practice" }),
    },
    {
      id: "nav.history",
      chord: "alt+2",
      group: "navigation",
      icon: History,
      descriptionKey: "palette:commands.nav.history",
      run: () => ctx.navigate({ to: "/history" }),
    },
    {
      id: "nav.settings",
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
      chord: "ctrl+,",
      group: "navigation",
      icon: Settings,
      hidden: true,
      descriptionKey: "palette:commands.nav.settings",
      run: () => ctx.navigate({ to: "/settings/general" }),
    },
    {
      id: "nav.about",
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
}

import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { create } from "zustand";
import i18n from "@/app/i18n";
import { applyAppearance } from "@/lib/appearance";
import {
  type AppInfo,
  type AppPaths,
  type DeepPartial,
  ipc,
  isRiffError,
  type Section,
  type Settings,
} from "@/lib/ipc";
import { log } from "@/lib/logger";
import { mergeDeep } from "@/lib/merge";

interface BootstrapPayload {
  settings: Settings;
  paths: AppPaths;
  appInfo: AppInfo;
  /** Present when settings.json could not be read and was moved aside. */
  recoveredFrom?: string | null;
}

declare global {
  interface Window {
    __RIFF_BOOTSTRAP__?: BootstrapPayload;
  }
}

function bootstrap(): BootstrapPayload {
  const payload = window.__RIFF_BOOTSTRAP__;
  if (payload) return payload;
  // Only reachable if the initialisation script failed. Rendering with
  // defaults and correcting asynchronously beats refusing to start.
  console.warn("bootstrap payload missing; falling back to an async read");
  void ipc.settingsGet().then((settings) => useSettings.getState().adopt(settings));
  throw new Error("bootstrap payload missing");
}

function safeBootstrap(): BootstrapPayload {
  try {
    return bootstrap();
  } catch {
    return {
      settings: {
        $schema: "./settings.schema.json",
        version: 1,
        general: {
          startupRoute: "practice",
          lastRoute: "/practice",
          restoreWindowState: true,
          confirmOnQuit: false,
          language: "en",
        },
        appearance: {
          theme: "dark",
          density: "comfortable",
          uiScale: 1,
          reduceMotion: "system",
          highContrast: false,
          titleBar: "custom",
          sidebar: { collapsed: false, rememberCollapsed: true },
        },
        onboarding: { completedAt: null, version: 1 },
        practice: { poppedOut: [] },
      },
      paths: { configDir: "", dataDir: "", stateDir: "", cacheDir: "", logDir: "", homeDir: "" },
      appInfo: {
        version: "unknown",
        tauriVersion: "unknown",
        webkitVersion: "unknown",
        buildDate: "unknown",
        gitSha: "unknown",
      },
    };
  }
}

interface SettingsState extends BootstrapPayload {
  /**
   * Every section but `practice`. Rust owns which panes are popped out, and
   * `settings_patch` writes the file without reconciling the windows — so a
   * patch that reached `practice.poppedOut` would leave the file claiming one
   * thing and the compositor showing another, with the watcher unable to
   * correct it (it filters out our own writes). `practicePopOut` and friends
   * are the way in; `Omit` is what stops this being a rule nobody remembers.
   */
  patch: (patch: DeepPartial<Omit<Settings, "practice">>) => Promise<void>;
  reset: (section?: Section) => Promise<void>;
  adopt: (settings: Settings) => void;
}

const initial = safeBootstrap();

/** Monotonic ticket, so a stale reply cannot overwrite a newer one. */
let sequence = 0;

// The Rust bootstrap script writes theme, density, contrast and scale before
// the first paint, but not `data-motion` — so `reduceMotion: "always"` would
// otherwise do nothing until some unrelated setting changed.
applyAppearance(document.documentElement, initial.settings.appearance);

export const useSettings = create<SettingsState>((set, get) => ({
  ...initial,

  adopt: (settings) => {
    set({ settings });
    applyAppearance(document.documentElement, settings.appearance);
  },

  patch: async (patch) => {
    const previous = get().settings;
    // Optimistic, so a switch feels instant. Rust's answer still wins.
    const ticket = ++sequence;
    get().adopt(mergeDeep(previous, patch));
    try {
      const confirmed = await ipc.settingsPatch(patch);
      // Two patches in flight resolve in whatever order the IPC returns, so
      // adopting unconditionally lets an older reply overwrite a newer one —
      // toggle two switches quickly and one silently reverts.
      if (ticket === sequence) get().adopt(confirmed);
    } catch (error) {
      // Only validation failures reach here — a failed disk write arrives as
      // `settings://write-failed` with the value still applied, because
      // reverting the control would misrepresent what the user chose.
      if (ticket !== sequence) return;
      get().adopt(previous);
      const code = isRiffError(error) ? error.code : "unknown";
      void log.warn("settings patch rejected", { code, patch });
      toast.error(i18n.t(`errors:code.${code}`, { defaultValue: i18n.t("errors:code.unknown") }));
    }
  },

  reset: async (section) => {
    const previous = get().settings;
    try {
      get().adopt(await ipc.settingsReset(section));
    } catch {
      get().adopt(previous);
      toast.error(i18n.t("errors:code.unknown"));
    }
  },
}));

/**
 * Tells the user their settings file was unreadable and has been kept.
 * Recovery happens before the Tauri builder exists, so it arrives in the
 * bootstrap payload rather than as an event — there is nothing to emit to
 * yet, and emitting later would race the first render.
 */
export function reportRecovery(): void {
  const path = window.__RIFF_BOOTSTRAP__?.recoveredFrom;
  if (path) toast.error(i18n.t("errors:settingsRecovered", { path }));
}

/** Call once at mount. Returns a function that removes both listeners. */
export async function subscribeToBackend(): Promise<() => void> {
  const unlistenChanged = await listen<Settings>("settings://changed", (event) => {
    useSettings.getState().adopt(event.payload);
  });
  const unlistenWriteFailed = await listen("settings://write-failed", () => {
    toast.error(i18n.t("errors:settingsWriteFailed"));
  });
  return () => {
    unlistenChanged();
    unlistenWriteFailed();
  };
}

// Selector hooks. `adopt` replaces `settings` wholesale, so an object
// selector like `s.settings.appearance` returns a fresh identity on every
// change and re-renders for edits it does not care about — which is the exact
// thing §6.2 says these exist to prevent. The primitive selectors below
// compare by value and genuinely do it.
export const useTheme = () => useSettings((s) => s.settings.appearance.theme);
export const useDensity = () => useSettings((s) => s.settings.appearance.density);
export const useUiScale = () => useSettings((s) => s.settings.appearance.uiScale);
export const useHighContrast = () => useSettings((s) => s.settings.appearance.highContrast);
export const useTitleBarStyle = () => useSettings((s) => s.settings.appearance.titleBar);
export const useStartupRoute = () => useSettings((s) => s.settings.general.startupRoute);
export const useSidebarCollapsed = () =>
  useSettings((s) => s.settings.appearance.sidebar.collapsed);
export const useRememberCollapsed = () =>
  useSettings((s) => s.settings.appearance.sidebar.rememberCollapsed);

// Whole-section hooks for the settings screens, which render every field and
// therefore have nothing to gain from a narrower subscription.
export const useAppearance = () => useSettings((s) => s.settings.appearance);
export const useGeneral = () => useSettings((s) => s.settings.general);

# 07 — Settings Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The only fully functional area of the milestone — General, Appearance and About, every control persisting immediately.

**Architecture:** One Zustand store, hydrated synchronously from `window.__RIFF_BOOTSTRAP__` so there is no loading state and no IPC round trip at boot. Changes apply optimistically and are confirmed by the value Rust returns. A **validation** failure rolls the UI back because nothing was applied; a **write** failure does not, because the value *is* applied in memory and reverting the switch would be a lie about what the user chose.

**Tech Stack:** Zustand 5, shadcn primitives, `lucide-react`, `sonner`.

**Spec:** `docs/superpowers/specs/2026-08-28-riff-foundation-design.md` (§6.2, §8.5)

## Global Constraints

- **No Save button and no dirty state.** A settings screen that can be abandoned half-applied is a settings screen with a bug in it.
- **Sections are written by hand, not generated** from the JSON Schema. Fifteen controls do not repay a rendering framework, and a generator would need escape hatches immediately for the scale slider's live preview, the reset confirmation and the licence viewer.
- **Every user-visible string** goes through `t()`, including `aria-label` and descriptions.
- **Logical properties only** — `ps-*`, `pe-*`, `ms-*`, `me-*`.
- **There is no accent hue.** No coloured "destructive" button; the reset action is guarded by a confirmation dialog, not by red.
- **No language picker.** `general.language` exists and is honoured, but a dropdown with one option is noise. It appears when a second locale does.
- **Never install:** `@tanstack/react-query`, `eslint`, `prettier`, any HTTP client.
- **Commits:** Conventional Commits, one per task.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/stores/settings.ts` | Hydration, optimistic patching, event subscriptions |
| `src/lib/merge.ts` | `mergeDeep`, used for the optimistic value |
| `src/features/settings/SettingRow.tsx` | Label + description + control, used by every row |
| `src/features/settings/sections/GeneralSection.tsx` | Startup, window, quit, data, import/export/reset |
| `src/features/settings/sections/AppearanceSection.tsx` | Theme, density, scale, motion, contrast, title bar |
| `src/features/settings/sections/AboutSection.tsx` | Versions, links, diagnostics |
| `src/routes/settings.tsx` | Sub-navigation layout |
| `src/routes/settings.{general,appearance,about}.tsx` | Section routes |

---

### Task 1: The settings store

**Interfaces:**
- Produces: `@/stores/settings` exporting `useSettings` with state `{ settings, paths, appInfo }` and actions `patch(DeepPartial<Settings>)`, `reset(section?)`, `adopt(Settings)`; plus `subscribeToBackend()` and selector hooks `useAppearance()`, `useGeneral()`.

**Files:**
- Create: `src/lib/merge.ts`, `src/stores/settings.ts`, `src/stores/settings.test.ts`

- [ ] **Step 1: Install**

```bash
pnpm add zustand@5.0
```

- [ ] **Step 2: Write the deep merge**

`src/lib/merge.ts`:

```ts
/**
 * Mirrors the Rust merge patch in `src-tauri/src/settings/patch.rs`:
 * `undefined` and `null` mean "not supplied" and are skipped, never "clear".
 * Used only to compute the optimistic value; the authoritative result is
 * whatever Rust returns.
 */
export function mergeDeep<T>(base: T, patch: unknown): T {
  if (patch === null || patch === undefined) return base;
  if (typeof patch !== "object" || Array.isArray(patch)) return patch as T;
  if (typeof base !== "object" || base === null) return patch as T;

  const result = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    result[key] = mergeDeep(result[key], value);
  }
  return result as T;
}
```

- [ ] **Step 3: Write the failing tests**

`src/stores/settings.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "@/lib/ipc";

const settingsPatch = vi.fn();
const settingsReset = vi.fn();
vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  ipc: { settingsPatch, settingsReset },
}));

const listen = vi.fn().mockResolvedValue(() => {});
vi.mock("@tauri-apps/api/event", () => ({ listen: (...a: unknown[]) => listen(...a) }));

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: toastError } }));

const DEFAULTS: Settings = {
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
};

beforeEach(() => {
  vi.resetModules();
  settingsPatch.mockReset();
  settingsReset.mockReset();
  toastError.mockReset();
  window.__RIFF_BOOTSTRAP__ = {
    settings: structuredClone(DEFAULTS),
    paths: {
      configDir: "/c",
      dataDir: "/d",
      stateDir: "/s",
      cacheDir: "/k",
      logDir: "/s/logs",
    },
    appInfo: {
      version: "0.1.0",
      tauriVersion: "2.11.5",
      webkitVersion: "2.52.6",
      buildDate: "2026-08-28",
      gitSha: "abc1234",
    },
  };
});

describe("useSettings", () => {
  it("hydrates synchronously from the bootstrap payload with no ipc call", async () => {
    const { useSettings } = await import("./settings");
    expect(useSettings.getState().settings.appearance.theme).toBe("dark");
    expect(settingsPatch).not.toHaveBeenCalled();
  });

  it("applies a change optimistically before rust confirms", async () => {
    const { useSettings } = await import("./settings");
    let resolve: (value: Settings) => void = () => {};
    settingsPatch.mockReturnValue(new Promise<Settings>((r) => (resolve = r)));

    const pending = useSettings.getState().patch({ appearance: { theme: "light" } });
    expect(useSettings.getState().settings.appearance.theme).toBe("light");

    const confirmed = structuredClone(DEFAULTS);
    confirmed.appearance.theme = "light";
    resolve(confirmed);
    await pending;
    expect(useSettings.getState().settings.appearance.theme).toBe("light");
  });

  it("adopts the value rust returns rather than trusting its own guess", async () => {
    const { useSettings } = await import("./settings");
    const clamped = structuredClone(DEFAULTS);
    clamped.appearance.uiScale = 1.5;
    settingsPatch.mockResolvedValue(clamped);

    await useSettings.getState().patch({ appearance: { uiScale: 9 } });
    expect(useSettings.getState().settings.appearance.uiScale).toBe(1.5);
  });

  it("rolls back and reports when validation fails", async () => {
    const { useSettings } = await import("./settings");
    settingsPatch.mockRejectedValue({
      code: "validation",
      details: { field: "appearance.theme", reason: "unknown" },
    });

    await useSettings.getState().patch({ appearance: { theme: "light" } });
    expect(useSettings.getState().settings.appearance.theme).toBe("dark");
    expect(toastError).toHaveBeenCalledOnce();
  });

  it("writes the appearance attributes onto the document", async () => {
    const { useSettings } = await import("./settings");
    const confirmed = structuredClone(DEFAULTS);
    confirmed.appearance.density = "compact";
    settingsPatch.mockResolvedValue(confirmed);

    await useSettings.getState().patch({ appearance: { density: "compact" } });
    expect(document.documentElement.dataset.density).toBe("compact");
  });

  it("adopts an external edit without calling back into rust", async () => {
    const { useSettings } = await import("./settings");
    const external = structuredClone(DEFAULTS);
    external.general.confirmOnQuit = true;

    useSettings.getState().adopt(external);
    expect(useSettings.getState().settings.general.confirmOnQuit).toBe(true);
    expect(settingsPatch).not.toHaveBeenCalled();
  });

  it("subscribes to both backend events", async () => {
    const { subscribeToBackend } = await import("./settings");
    await subscribeToBackend();
    const events = listen.mock.calls.map((c) => c[0]);
    expect(events).toContain("settings://changed");
    expect(events).toContain("settings://write-failed");
  });
});
```

- [ ] **Step 4: Run and watch them fail**

Run: `pnpm test src/stores/settings`
Expected: FAIL — cannot resolve `./settings`

- [ ] **Step 5: Implement**

`src/stores/settings.ts`:

```ts
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { create } from "zustand";
import i18n from "@/app/i18n";
import { applyAppearance } from "@/lib/appearance";
import {
  ipc,
  isRiffError,
  type AppInfo,
  type AppPaths,
  type DeepPartial,
  type Section,
  type Settings,
} from "@/lib/ipc";
import { mergeDeep } from "@/lib/merge";

interface BootstrapPayload {
  settings: Settings;
  paths: AppPaths;
  appInfo: AppInfo;
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
      },
      paths: { configDir: "", dataDir: "", stateDir: "", cacheDir: "", logDir: "" },
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
  patch: (patch: DeepPartial<Settings>) => Promise<void>;
  reset: (section?: Section) => Promise<void>;
  adopt: (settings: Settings) => void;
}

const initial = safeBootstrap();

export const useSettings = create<SettingsState>((set, get) => ({
  ...initial,

  adopt: (settings) => {
    set({ settings });
    applyAppearance(document.documentElement, settings.appearance);
  },

  patch: async (patch) => {
    const previous = get().settings;
    // Optimistic, so a switch feels instant. Rust's answer still wins.
    get().adopt(mergeDeep(previous, patch));
    try {
      get().adopt(await ipc.settingsPatch(patch));
    } catch (error) {
      // Only validation failures reach here — a failed disk write arrives as
      // `settings://write-failed` with the value still applied, because
      // reverting the control would misrepresent what the user chose.
      get().adopt(previous);
      const code = isRiffError(error) ? error.code : "unknown";
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

// Selector hooks, so a component re-renders only for the slice it uses.
export const useAppearance = () => useSettings((s) => s.settings.appearance);
export const useGeneral = () => useSettings((s) => s.settings.general);
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test src/stores/settings`
Expected: PASS, 7 tests

- [ ] **Step 7: Wire it into the shell**

In `src/routes/__root.tsx`, replace the local collapsed state with the persisted setting and subscribe to backend events:

```tsx
const { collapsed, rememberCollapsed } = useAppearance().sidebar;
const patch = useSettings((s) => s.patch);
const [transientCollapsed, setTransientCollapsed] = useState(collapsed);
const effectiveCollapsed = rememberCollapsed ? collapsed : transientCollapsed;

useEffect(() => {
  const unsubscribe = subscribeToBackend();
  return () => void unsubscribe.then((off) => off());
}, []);

const toggleSidebar = () => {
  if (rememberCollapsed) {
    void patch({ appearance: { sidebar: { collapsed: !collapsed } } });
  } else {
    setTransientCollapsed((v) => !v);
  }
};
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(settings): add the zustand store with optimistic patching"
```

---

### Task 2: The settings layout and sub-navigation

**Files:**
- Modify: `src/routes/settings.tsx`
- Create: `src/routes/settings.index.tsx`, `src/features/settings/SettingRow.tsx`

- [ ] **Step 1: Add the strings**

`src/locales/en/settings.json`:

```json
{
  "title": "Settings",
  "sections": { "general": "General", "appearance": "Appearance", "about": "About" },
  "general": {
    "startupRoute": { "label": "On launch, open", "description": "Which page Riff shows when it starts." },
    "startupOptions": { "practice": "Practice", "history": "History", "last-used": "The page I was last on" },
    "restoreWindow": { "label": "Restore window size and position", "description": "Position is a request your window manager may decline. Under Wayland, most compositors place windows themselves." },
    "confirmOnQuit": { "label": "Confirm before quitting", "description": "Ask before closing Riff." },
    "dataLocations": { "label": "Data locations", "description": "Everything Riff stores lives in these folders and nowhere else." },
    "paths": { "config": "Settings", "data": "Data", "cache": "Cache", "logs": "Logs" },
    "importExport": { "label": "Settings file", "description": "Copy your settings to another machine, or bring them back." },
    "export": "Export settings",
    "import": "Import settings",
    "exported": "Settings exported to {{path}}",
    "imported": "Settings imported",
    "reset": { "label": "Reset all settings", "description": "Restores General and Appearance to their defaults. Your onboarding choice is kept.", "action": "Reset", "confirmTitle": "Reset all settings?", "confirmBody": "General and Appearance return to their defaults. This cannot be undone." },
    "rerunOnboarding": { "label": "Run first-time setup again", "description": "Shows the welcome, theme and privacy steps once more.", "action": "Run setup" }
  },
  "appearance": {
    "theme": { "label": "Theme", "description": "Riff does not follow your desktop; you chose this during setup and can change it here." },
    "themeOptions": { "dark": "Dark", "light": "Light" },
    "density": { "label": "Density", "description": "Adjusts spacing without changing text size." },
    "densityOptions": { "comfortable": "Comfortable", "compact": "Compact" },
    "uiScale": { "label": "Interface scale", "description": "Scales the whole interface, not only text.", "reset": "Reset to 100%" },
    "reduceMotion": { "label": "Reduce motion", "description": "System follows your desktop's accessibility preference." },
    "motionOptions": { "system": "Follow my system", "always": "Always reduce", "never": "Never reduce" },
    "highContrast": { "label": "High contrast", "description": "Strengthens borders and secondary text to meet WCAG contrast minimums." },
    "titleBar": { "label": "Title bar", "description": "Use Riff's own title bar, or ask your window manager for its decorations." },
    "titleBarOptions": { "custom": "Riff's title bar", "system": "System decorations" },
    "rememberSidebar": { "label": "Remember sidebar state", "description": "Reopen Riff with the sidebar as you left it." }
  },
  "about": {
    "version": "Version",
    "tauri": "Tauri",
    "webkit": "WebKitGTK",
    "buildDate": "Build date",
    "commit": "Commit",
    "repository": "Repository",
    "issues": "Report an issue",
    "license": "Licence",
    "licenseBody": "Riff is free software released under the MIT Licence.",
    "copyDiagnostics": "Copy diagnostics",
    "privacy": "Riff makes no network connections. Nothing you do here leaves this machine."
  }
}
```

- [ ] **Step 2: Write the shared row**

`src/features/settings/SettingRow.tsx`:

```tsx
import type { ReactNode } from "react";

/**
 * Label, optional description, control. Every setting uses this, which is
 * what keeps the three sections visually identical without a framework.
 */
export function SettingRow({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-separator py-4 last:border-b-0">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-[0.9375rem] font-medium">
          {label}
        </label>
        {description && <p className="mt-1 text-[0.8125rem] text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
```

- [ ] **Step 3: Write the layout**

`src/routes/settings.tsx`:

```tsx
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Info, House, Palette } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/settings")({ component: SettingsLayout });

const SECTIONS: { to: string; icon: LucideIcon; key: string }[] = [
  { to: "/settings/general", icon: House, key: "general" },
  { to: "/settings/appearance", icon: Palette, key: "appearance" },
  { to: "/settings/about", icon: Info, key: "about" },
];

function SettingsLayout() {
  const { t } = useTranslation(["settings", "nav"]);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex h-full min-h-0">
      {/* Below 700px of available width this becomes a horizontal strip, so a
          1.5x interface scale in a minimum-size window stays usable. */}
      <nav
        aria-label={t("nav:settingsSections")}
        className="@container flex w-[var(--spacing-subnav)] shrink-0 flex-col gap-1 border-e border-raised p-3 max-[700px]:w-full max-[700px]:flex-row max-[700px]:border-e-0 max-[700px]:border-b"
      >
        {SECTIONS.map(({ to, icon: Icon, key }) => (
          <Link
            key={to}
            to={to}
            aria-current={pathname === to ? "page" : undefined}
            className={cn(
              "flex h-10 items-center gap-2 rounded-[var(--radius-nav)] px-3 text-[0.9375rem] font-medium transition-colors hover:bg-raised",
              pathname === to && "bg-raised",
            )}
          >
            <Icon size={16} aria-hidden />
            {t(`settings:sections.${key}`)}
          </Link>
        ))}
      </nav>

      <div className="min-w-0 flex-1 overflow-auto p-[var(--content-padding)]">
        <div className="mx-auto max-w-3xl rounded-[var(--radius-card)] bg-card px-6">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
```

`src/routes/settings.index.tsx`:

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/general" });
  },
});
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm app`
Expected: `/settings` redirects to `/settings/general`; the sub-navigation renders with three entries.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(settings): add the settings layout and sub-navigation"
```

---

### Task 3: The Appearance section

**Files:**
- Create: `src/routes/settings.appearance.tsx`, `src/features/settings/sections/AppearanceSection.tsx`, `src/features/settings/sections/AppearanceSection.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/features/settings/sections/AppearanceSection.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";

const patch = vi.fn().mockResolvedValue(undefined);
const appearance = {
  theme: "dark" as const,
  density: "comfortable" as const,
  uiScale: 1,
  reduceMotion: "system" as const,
  highContrast: false,
  titleBar: "custom" as const,
  sidebar: { collapsed: false, rememberCollapsed: true },
};
vi.mock("@/stores/settings", () => ({
  useAppearance: () => appearance,
  useSettings: (selector: (s: { patch: typeof patch }) => unknown) => selector({ patch }),
}));
vi.mock("@/lib/ipc", () => ({ ipc: { windowSetDecorations: vi.fn().mockResolvedValue(false) } }));

const { AppearanceSection } = await import("./AppearanceSection");

function renderSection() {
  return render(
    <I18nextProvider i18n={i18n}>
      <AppearanceSection />
    </I18nextProvider>,
  );
}

describe("AppearanceSection", () => {
  beforeEach(() => patch.mockClear());

  it("shows every control from the spec", () => {
    renderSection();
    expect(screen.getByRole("radiogroup", { name: /theme/i })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: /interface scale/i })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /high contrast/i })).toBeInTheDocument();
  });

  it("persists a theme change immediately, with no save step", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("radio", { name: "Light" }));
    expect(patch).toHaveBeenCalledWith({ appearance: { theme: "light" } });
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });

  it("persists the high contrast toggle", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("switch", { name: /high contrast/i }));
    expect(patch).toHaveBeenCalledWith({ appearance: { highContrast: true } });
  });

  it("has no accessibility violations", async () => {
    const { container } = renderSection();
    await expect(container).toHaveNoAxeViolations();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm test AppearanceSection`
Expected: FAIL — cannot resolve `./AppearanceSection`

- [ ] **Step 3: Implement**

`src/features/settings/sections/AppearanceSection.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { SettingRow } from "@/features/settings/SettingRow";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ipc, type Density, type ReduceMotion, type Theme, type TitleBarStyle } from "@/lib/ipc";
import { useAppearance, useSettings } from "@/stores/settings";

export function AppearanceSection() {
  const { t } = useTranslation(["settings", "errors"]);
  const appearance = useAppearance();
  const patch = useSettings((s) => s.patch);

  async function setTitleBar(style: TitleBarStyle) {
    // The window manager decides. Under Wayland many compositors, Hyprland
    // among them, simply decline — so ask, then read back what actually
    // happened rather than leaving a switch that claims otherwise.
    const decorated = await ipc.windowSetDecorations(style === "system");
    if (style === "system" && !decorated) {
      toast.error(t("errors:decorationsRefused"));
      return;
    }
    await patch({ appearance: { titleBar: style } });
  }

  return (
    <section className="py-2">
      <Choice
        label={t("settings:appearance.theme.label")}
        description={t("settings:appearance.theme.description")}
        value={appearance.theme}
        options={["dark", "light"] as Theme[]}
        optionLabel={(v) => t(`settings:appearance.themeOptions.${v}`)}
        onChange={(theme) => void patch({ appearance: { theme } })}
      />

      <Choice
        label={t("settings:appearance.density.label")}
        description={t("settings:appearance.density.description")}
        value={appearance.density}
        options={["comfortable", "compact"] as Density[]}
        optionLabel={(v) => t(`settings:appearance.densityOptions.${v}`)}
        onChange={(density) => void patch({ appearance: { density } })}
      />

      <SettingRow
        label={t("settings:appearance.uiScale.label")}
        description={t("settings:appearance.uiScale.description")}
      >
        <div className="flex w-56 items-center gap-3">
          <Slider
            aria-label={t("settings:appearance.uiScale.label")}
            min={0.8}
            max={1.5}
            step={0.05}
            value={[appearance.uiScale]}
            onValueChange={([uiScale]) => void patch({ appearance: { uiScale } })}
          />
          <span className="w-12 shrink-0 text-end font-mono text-xs text-muted-foreground">
            {Math.round(appearance.uiScale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void patch({ appearance: { uiScale: 1 } })}
            aria-label={t("settings:appearance.uiScale.reset")}
          >
            100%
          </Button>
        </div>
      </SettingRow>

      <Choice
        label={t("settings:appearance.reduceMotion.label")}
        description={t("settings:appearance.reduceMotion.description")}
        value={appearance.reduceMotion}
        options={["system", "always", "never"] as ReduceMotion[]}
        optionLabel={(v) => t(`settings:appearance.motionOptions.${v}`)}
        onChange={(reduceMotion) => void patch({ appearance: { reduceMotion } })}
      />

      <SettingRow
        label={t("settings:appearance.highContrast.label")}
        description={t("settings:appearance.highContrast.description")}
        htmlFor="high-contrast"
      >
        <Switch
          id="high-contrast"
          checked={appearance.highContrast}
          onCheckedChange={(highContrast) => void patch({ appearance: { highContrast } })}
        />
      </SettingRow>

      <Choice
        label={t("settings:appearance.titleBar.label")}
        description={t("settings:appearance.titleBar.description")}
        value={appearance.titleBar}
        options={["custom", "system"] as TitleBarStyle[]}
        optionLabel={(v) => t(`settings:appearance.titleBarOptions.${v}`)}
        onChange={(style) => void setTitleBar(style)}
      />

      <SettingRow
        label={t("settings:appearance.rememberSidebar.label")}
        description={t("settings:appearance.rememberSidebar.description")}
        htmlFor="remember-sidebar"
      >
        <Switch
          id="remember-sidebar"
          checked={appearance.sidebar.rememberCollapsed}
          onCheckedChange={(rememberCollapsed) =>
            void patch({ appearance: { sidebar: { rememberCollapsed } } })
          }
        />
      </SettingRow>
    </section>
  );
}

function Choice<T extends string>({
  label,
  description,
  value,
  options,
  optionLabel,
  onChange,
}: {
  label: string;
  description: string;
  value: T;
  options: T[];
  optionLabel: (value: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <SettingRow label={label} description={description}>
      <RadioGroup
        aria-label={label}
        value={value}
        onValueChange={(v) => onChange(v as T)}
        className="flex gap-4"
      >
        {options.map((option) => (
          <div key={option} className="flex items-center gap-2">
            <RadioGroupItem value={option} id={`${label}-${option}`} />
            <label htmlFor={`${label}-${option}`} className="text-sm">
              {optionLabel(option)}
            </label>
          </div>
        ))}
      </RadioGroup>
    </SettingRow>
  );
}
```

`src/routes/settings.appearance.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { AppearanceSection } from "@/features/settings/sections/AppearanceSection";

export const Route = createFileRoute("/settings/appearance")({ component: AppearanceSection });
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test AppearanceSection`
Expected: PASS, 4 tests

- [ ] **Step 5: Verify by hand**

Run: `pnpm app`, open Settings → Appearance, switch the theme.
Expected: the interface retints instantly. Close and reopen Riff — it stays. `cat ~/.config/riff/settings.json` shows `"theme": "light"`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(settings): add the appearance section"
```

---

### Task 4: The General section

**Files:**
- Create: `src/routes/settings.general.tsx`, `src/features/settings/sections/GeneralSection.tsx`, `src/features/settings/sections/GeneralSection.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/features/settings/sections/GeneralSection.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";

const patch = vi.fn().mockResolvedValue(undefined);
const reset = vi.fn().mockResolvedValue(undefined);
const openPath = vi.fn().mockResolvedValue(undefined);
const settingsImport = vi.fn().mockResolvedValue(null);
const settingsExport = vi.fn().mockResolvedValue(null);

vi.mock("@/stores/settings", () => ({
  useGeneral: () => ({
    startupRoute: "practice" as const,
    lastRoute: "/practice",
    restoreWindowState: true,
    confirmOnQuit: false,
    language: "en",
  }),
  useSettings: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      patch,
      reset,
      paths: { configDir: "/c", dataDir: "/d", cacheDir: "/k", logDir: "/l", stateDir: "/s" },
    }),
}));
vi.mock("@/lib/ipc", () => ({
  ipc: { openPath, settingsImport, settingsExport },
}));

const { GeneralSection } = await import("./GeneralSection");

function renderSection() {
  return render(
    <I18nextProvider i18n={i18n}>
      <GeneralSection />
    </I18nextProvider>,
  );
}

describe("GeneralSection", () => {
  beforeEach(() => {
    patch.mockClear();
    reset.mockClear();
    openPath.mockClear();
  });

  it("has no language picker while english is the only locale", () => {
    renderSection();
    expect(screen.queryByRole("combobox", { name: /language/i })).not.toBeInTheDocument();
  });

  it("persists the confirm-on-quit switch", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("switch", { name: /confirm before quitting/i }));
    expect(patch).toHaveBeenCalledWith({ general: { confirmOnQuit: true } });
  });

  it("opens a data folder through the enum command, never a path", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getAllByRole("button", { name: /open folder/i })[0]);
    expect(openPath).toHaveBeenCalledWith("config");
  });

  it("guards reset behind a confirmation rather than colour", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(reset).not.toHaveBeenCalled();
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderSection();
    await expect(container).toHaveNoAxeViolations();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm test GeneralSection`
Expected: FAIL — cannot resolve `./GeneralSection`

- [ ] **Step 3: Implement**

`src/features/settings/sections/GeneralSection.tsx`:

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { SettingRow } from "@/features/settings/SettingRow";
import { ipc, type StartupRoute } from "@/lib/ipc";
import { PATH_KINDS, pathFor } from "@/lib/paths";
import { useGeneral, useSettings } from "@/stores/settings";

const STARTUP_ROUTES: StartupRoute[] = ["practice", "history", "last-used"];

export function GeneralSection() {
  const { t } = useTranslation(["settings", "common"]);
  const general = useGeneral();
  const patch = useSettings((s) => s.patch);
  const reset = useSettings((s) => s.reset);
  const paths = useSettings((s) => s.paths);
  const [confirmingReset, setConfirmingReset] = useState(false);

  return (
    <section className="py-2">
      <SettingRow
        label={t("settings:general.startupRoute.label")}
        description={t("settings:general.startupRoute.description")}
        htmlFor="startup-route"
      >
        <select
          id="startup-route"
          className="h-9 rounded-md border border-border-subtle bg-raised px-2 text-sm"
          value={general.startupRoute}
          onChange={(e) =>
            void patch({ general: { startupRoute: e.target.value as StartupRoute } })
          }
        >
          {STARTUP_ROUTES.map((route) => (
            <option key={route} value={route}>
              {t(`settings:general.startupOptions.${route}`)}
            </option>
          ))}
        </select>
      </SettingRow>

      <SettingRow
        label={t("settings:general.restoreWindow.label")}
        description={t("settings:general.restoreWindow.description")}
        htmlFor="restore-window"
      >
        <Switch
          id="restore-window"
          checked={general.restoreWindowState}
          onCheckedChange={(restoreWindowState) => void patch({ general: { restoreWindowState } })}
        />
      </SettingRow>

      <SettingRow
        label={t("settings:general.confirmOnQuit.label")}
        description={t("settings:general.confirmOnQuit.description")}
        htmlFor="confirm-quit"
      >
        <Switch
          id="confirm-quit"
          checked={general.confirmOnQuit}
          onCheckedChange={(confirmOnQuit) => void patch({ general: { confirmOnQuit } })}
        />
      </SettingRow>

      <div className="border-b border-separator py-4">
        <p className="text-[0.9375rem] font-medium">{t("settings:general.dataLocations.label")}</p>
        <p className="mt-1 text-[0.8125rem] text-muted-foreground">
          {t("settings:general.dataLocations.description")}
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {PATH_KINDS.map((kind) => (
            <li key={kind} className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <span className="text-sm">{t(`settings:general.paths.${kind}`)}</span>
                <code className="ms-2 truncate font-mono text-xs text-muted-foreground">
                  {pathFor(kind, paths)}
                </code>
              </div>
              <Button variant="secondary" size="sm" onClick={() => void ipc.openPath(kind)}>
                {t("common:openFolder")}
              </Button>
            </li>
          ))}
        </ul>
      </div>

      <SettingRow
        label={t("settings:general.importExport.label")}
        description={t("settings:general.importExport.description")}
      >
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={async () => {
              const path = await ipc.settingsExport();
              if (path) toast.success(t("settings:general.exported", { path }));
            }}
          >
            {t("settings:general.export")}
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              const imported = await ipc.settingsImport();
              if (imported) {
                useSettings.getState().adopt(imported);
                toast.success(t("settings:general.imported"));
              }
            }}
          >
            {t("settings:general.import")}
          </Button>
        </div>
      </SettingRow>

      <SettingRow
        label={t("settings:general.rerunOnboarding.label")}
        description={t("settings:general.rerunOnboarding.description")}
      >
        <Button variant="secondary" onClick={() => void reset("onboarding")}>
          {t("settings:general.rerunOnboarding.action")}
        </Button>
      </SettingRow>

      <SettingRow
        label={t("settings:general.reset.label")}
        description={t("settings:general.reset.description")}
      >
        <Button variant="secondary" onClick={() => setConfirmingReset(true)}>
          {t("settings:general.reset.action")}
        </Button>
      </SettingRow>

      <Dialog open={confirmingReset} onOpenChange={setConfirmingReset}>
        <DialogContent role="alertdialog">
          <DialogHeader>
            <DialogTitle>{t("settings:general.reset.confirmTitle")}</DialogTitle>
            <DialogDescription>{t("settings:general.reset.confirmBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmingReset(false)}>
              {t("common:cancel")}
            </Button>
            <Button
              onClick={() => {
                void reset();
                setConfirmingReset(false);
              }}
            >
              {t("settings:general.reset.action")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

```

Create `src/lib/paths.ts` — shared, because Plan 08's privacy step lists the
same directories and duplicating the mapping is how the two drift apart:

```ts
import type { AppPaths, PathKind } from "@/lib/ipc";

/** `logs` maps to `logDir`, not `logsDir`. That single irregularity is the
 *  whole reason this lives in one place. */
const FIELD: Record<PathKind, keyof AppPaths> = {
  config: "configDir",
  data: "dataDir",
  cache: "cacheDir",
  logs: "logDir",
};

export const PATH_KINDS: PathKind[] = ["config", "data", "cache", "logs"];

export function pathFor(kind: PathKind, paths: AppPaths): string {
  return paths[FIELD[kind]];
}
```

`src/routes/settings.general.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { GeneralSection } from "@/features/settings/sections/GeneralSection";

export const Route = createFileRoute("/settings/general")({ component: GeneralSection });
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test GeneralSection`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(settings): add the general section"
```

---

### Task 5: The About section

**Files:**
- Create: `src/routes/settings.about.tsx`, `src/features/settings/sections/AboutSection.tsx`, `src/features/settings/sections/AboutSection.test.tsx`

The third-party licence list is added by Plan 11, which generates the data it renders.

- [ ] **Step 1: Write the failing test**

`src/features/settings/sections/AboutSection.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";

const openExternal = vi.fn().mockResolvedValue(undefined);
const writeText = vi.fn().mockResolvedValue(undefined);

vi.mock("@/stores/settings", () => ({
  useSettings: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      appInfo: {
        version: "0.1.0",
        tauriVersion: "2.11.5",
        webkitVersion: "2.52.6",
        buildDate: "2026-08-28",
        gitSha: "abc1234",
      },
      paths: {
        configDir: "/home/dimitris/.config/riff",
        dataDir: "/home/dimitris/.local/share/riff",
        cacheDir: "/home/dimitris/.cache/riff",
        logDir: "/home/dimitris/.local/state/riff/logs",
        stateDir: "/home/dimitris/.local/state/riff",
      },
    }),
}));
vi.mock("@/lib/ipc", () => ({ ipc: { openExternal } }));

const { AboutSection } = await import("./AboutSection");

function renderSection() {
  Object.assign(navigator, { clipboard: { writeText } });
  return render(
    <I18nextProvider i18n={i18n}>
      <AboutSection />
    </I18nextProvider>,
  );
}

describe("AboutSection", () => {
  it("shows the build identity", () => {
    renderSection();
    expect(screen.getByText("0.1.0")).toBeInTheDocument();
    expect(screen.getByText("2.52.6")).toBeInTheDocument();
    expect(screen.getByText("abc1234")).toBeInTheDocument();
  });

  it("opens links through the enum command, never a url", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: /repository/i }));
    expect(openExternal).toHaveBeenCalledWith("repository");
  });

  it("redacts the home directory from copied diagnostics", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: /copy diagnostics/i }));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("$HOME/.config/riff");
    expect(copied).not.toContain("/home/dimitris");
  });

  it("has no accessibility violations", async () => {
    const { container } = renderSection();
    await expect(container).toHaveNoAxeViolations();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm test AboutSection`
Expected: FAIL — cannot resolve `./AboutSection`

- [ ] **Step 3: Implement**

`src/features/settings/sections/AboutSection.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SettingRow } from "@/features/settings/SettingRow";
import { ipc } from "@/lib/ipc";
import { useSettings } from "@/stores/settings";

/**
 * Diagnostics are meant to be pasted into a public issue, so the home
 * directory — which carries the user's account name — is replaced. A
 * privacy-first application should not leak identity through its own
 * bug-report affordance.
 */
function redactHome(text: string, home: string): string {
  return home ? text.split(home).join("$HOME") : text;
}

export function AboutSection() {
  const { t } = useTranslation(["settings", "common"]);
  const appInfo = useSettings((s) => s.appInfo);
  const paths = useSettings((s) => s.paths);

  const rows: [string, string][] = [
    [t("settings:about.version"), appInfo.version],
    [t("settings:about.tauri"), appInfo.tauriVersion],
    [t("settings:about.webkit"), appInfo.webkitVersion],
    [t("settings:about.buildDate"), appInfo.buildDate],
    [t("settings:about.commit"), appInfo.gitSha],
  ];

  function copyDiagnostics() {
    // Derive $HOME from a known path rather than an env var the webview has
    // no access to.
    const home = paths.configDir.replace(/\/\.config\/riff$/, "");
    const report = [
      ...rows.map(([label, value]) => `${label}: ${value}`),
      "",
      `Config: ${paths.configDir}`,
      `Data:   ${paths.dataDir}`,
      `Cache:  ${paths.cacheDir}`,
      `Logs:   ${paths.logDir}`,
    ].join("\n");

    void navigator.clipboard.writeText(redactHome(report, home));
    toast.success(t("common:copied"));
  }

  return (
    <section className="py-2">
      <dl className="border-b border-separator py-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 py-1">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="font-mono text-xs">{value}</dd>
          </div>
        ))}
      </dl>

      <SettingRow label={t("settings:about.license")} description={t("settings:about.licenseBody")}>
        <Button variant="secondary" onClick={() => void ipc.openExternal("license")}>
          {t("settings:about.license")}
        </Button>
      </SettingRow>

      <SettingRow label={t("settings:about.repository")} description={t("settings:about.privacy")}>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void ipc.openExternal("repository")}>
            {t("settings:about.repository")}
          </Button>
          <Button variant="secondary" onClick={() => void ipc.openExternal("issues")}>
            {t("settings:about.issues")}
          </Button>
        </div>
      </SettingRow>

      <SettingRow label={t("settings:about.copyDiagnostics")} description={t("settings:about.privacy")}>
        <Button variant="secondary" onClick={copyDiagnostics}>
          {t("settings:about.copyDiagnostics")}
        </Button>
      </SettingRow>
    </section>
  );
}
```

`src/routes/settings.about.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { AboutSection } from "@/features/settings/sections/AboutSection";

export const Route = createFileRoute("/settings/about")({ component: AboutSection });
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test AboutSection`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(settings): add the about section with redacted diagnostics"
```

---

### Task 6: Honour the startup route

**Files:**
- Modify: `src/routes/index.tsx`, `src/routes/__root.tsx`

- [ ] **Step 1: Write the failing test**

`src/routes/startup-route.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveStartupRoute } from "@/lib/startup-route";

const KNOWN = ["/practice", "/history", "/settings/general"];

describe("resolveStartupRoute", () => {
  it("uses the named route", () => {
    expect(resolveStartupRoute("history", "/practice", KNOWN)).toBe("/history");
  });

  it("uses the last route when asked to", () => {
    expect(resolveStartupRoute("last-used", "/settings/general", KNOWN)).toBe("/settings/general");
  });

  it("never restores onboarding, which would trap the user in a finished wizard", () => {
    expect(resolveStartupRoute("last-used", "/onboarding", KNOWN)).toBe("/practice");
  });

  it("falls back when the last route no longer exists after an update", () => {
    expect(resolveStartupRoute("last-used", "/removed-feature", KNOWN)).toBe("/practice");
  });

  it("falls back when the last route is empty", () => {
    expect(resolveStartupRoute("last-used", "", KNOWN)).toBe("/practice");
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm test startup-route`
Expected: FAIL — cannot resolve `@/lib/startup-route`

- [ ] **Step 3: Implement**

`src/lib/startup-route.ts`:

```ts
import type { StartupRoute } from "@/lib/ipc";

const FALLBACK = "/practice";

/**
 * `lastRoute` is validated rather than trusted. It can hold `/onboarding`,
 * which would drop the user into a wizard they already finished on every
 * launch, or a route an update removed.
 */
export function resolveStartupRoute(
  preference: StartupRoute,
  lastRoute: string,
  knownRoutes: readonly string[],
): string {
  if (preference === "practice") return "/practice";
  if (preference === "history") return "/history";
  if (lastRoute === "/onboarding" || !knownRoutes.includes(lastRoute)) return FALLBACK;
  return lastRoute;
}
```

`src/routes/index.tsx`:

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router";
import { resolveStartupRoute } from "@/lib/startup-route";
import { router } from "@/app/router";
import { useSettings } from "@/stores/settings";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    const { startupRoute, lastRoute } = useSettings.getState().settings.general;
    const known = Object.keys(router.routesById);
    throw redirect({ to: resolveStartupRoute(startupRoute, lastRoute, known) });
  },
});
```

- [ ] **Step 4: Record the last route**

In `src/routes/__root.tsx`, inside the existing route-announcement effect:

```tsx
// Only tracked when the user asked for it, so a setting nobody uses costs
// nothing in writes.
if (useSettings.getState().settings.general.startupRoute === "last-used") {
  void useSettings.getState().patch({ general: { lastRoute: pathname } });
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm test startup-route`
Expected: PASS, 5 tests

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(settings): honour the configured startup route"
```

---

### Task 7: Honour "Confirm before quitting"

Rust prevents the close and emits `app://confirm-quit` (Plan 04). Without this task the switch persists perfectly and changes nothing.

**Files:**
- Create: `src/features/window/QuitConfirmation.tsx`, `src/features/window/QuitConfirmation.test.tsx`
- Modify: `src/routes/__root.tsx`, `src/locales/en/common.json`

- [ ] **Step 1: Add the strings**

Add to `src/locales/en/common.json`:

```json
  "quit": { "title": "Quit Riff?", "body": "Your settings are already saved.", "action": "Quit" }
```

- [ ] **Step 2: Write the failing test**

`src/features/window/QuitConfirmation.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/app/i18n";

let emit: (() => void) | undefined;
vi.mock("@tauri-apps/api/event", () => ({
  listen: (_name: string, handler: () => void) => {
    emit = handler;
    return Promise.resolve(() => {});
  },
}));
const windowQuitConfirmed = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/ipc", () => ({ ipc: { windowQuitConfirmed } }));

const { QuitConfirmation } = await import("./QuitConfirmation");

function renderIt() {
  return render(
    <I18nextProvider i18n={i18n}>
      <QuitConfirmation />
    </I18nextProvider>,
  );
}

describe("QuitConfirmation", () => {
  it("stays hidden until rust asks", async () => {
    renderIt();
    await waitFor(() => expect(emit).toBeDefined());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("quits only after the user confirms", async () => {
    const user = userEvent.setup();
    renderIt();
    await waitFor(() => expect(emit).toBeDefined());
    emit?.();

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(windowQuitConfirmed).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Quit" }));
    expect(windowQuitConfirmed).toHaveBeenCalledOnce();
  });

  it("cancelling leaves the window open", async () => {
    const user = userEvent.setup();
    renderIt();
    await waitFor(() => expect(emit).toBeDefined());
    emit?.();
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(windowQuitConfirmed).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `pnpm test QuitConfirmation`
Expected: FAIL — cannot resolve `./QuitConfirmation`

- [ ] **Step 4: Implement**

`src/features/window/QuitConfirmation.tsx`:

```tsx
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ipc } from "@/lib/ipc";

/**
 * Rust owns the decision: it reads `confirmOnQuit`, cancels the close and
 * emits this event. The frontend only asks the question. Keeping the check in
 * Rust means the setting is honoured even if the webview is wedged.
 */
export function QuitConfirmation() {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const pending = listen("app://confirm-quit", () => setOpen(true));
    return () => void pending.then((off) => off());
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent role="alertdialog">
        <DialogHeader>
          <DialogTitle>{t("quit.title")}</DialogTitle>
          <DialogDescription>{t("quit.body")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void ipc.windowQuitConfirmed()}>{t("quit.action")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Mount `<QuitConfirmation />` in `src/routes/__root.tsx`, beside the palette.

- [ ] **Step 5: Run the tests**

Run: `pnpm test QuitConfirmation`
Expected: PASS, 3 tests

- [ ] **Step 6: Verify by hand**

Run `pnpm app`, enable Confirm before quitting, then close the window.
Expected: the dialog appears; Cancel keeps the window open; Quit closes it. Disable the setting and confirm the window closes immediately.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(settings): honour confirm before quitting"
```

---

### Task 8: Gate check

- [ ] **Step 1: Run everything**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test
```
Expected: all exit 0.

- [ ] **Step 2: Verify persistence end to end**

Run `pnpm app`. Change the theme, density and scale. Quit. Run `pnpm app` again.
Expected: every choice survived. `cat ~/.config/riff/settings.json` matches what the interface shows.

- [ ] **Step 3: Verify live external editing**

With Riff running: `sed -i 's/"theme": "dark"/"theme": "light"/' ~/.config/riff/settings.json`
Expected: the interface retints within a second, with no interaction.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: verify settings frontend gates" --allow-empty
```

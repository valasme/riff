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
      homeDir: "/home/probe",
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

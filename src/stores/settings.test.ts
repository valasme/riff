import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "@/lib/ipc";

const settingsPatch = vi.fn();
const settingsReset = vi.fn();
const settingsGet = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  ipc: { settingsPatch, settingsReset, settingsGet },
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
    sidebar: { collapsed: false, rememberCollapsed: true },
    scoreDim: 0,
  },
  onboarding: { completedAt: null, version: 1 },
  practice: { poppedOut: [] },
};

beforeEach(() => {
  vi.resetModules();
  settingsPatch.mockReset();
  settingsReset.mockReset();
  toastError.mockReset();
  listen.mockClear();
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

  it("subscribes to every backend event", async () => {
    const { subscribeToBackend } = await import("./settings");
    await subscribeToBackend();
    const events = listen.mock.calls.map((c) => c[0]);
    expect(events).toContain("settings://changed");
    expect(events).toContain("settings://write-failed");
    expect(events).toContain("settings://edit-invalid");
  });

  it("reports a hand edit that finished and still could not be read", async () => {
    const { subscribeToBackend } = await import("./settings");
    await subscribeToBackend();
    const onEditInvalid = listen.mock.calls.find((c) => c[0] === "settings://edit-invalid")?.[1] as
      | ((e: { payload: string }) => void)
      | undefined;

    onEditInvalid?.({ payload: "general" });
    expect(toastError).toHaveBeenCalledOnce();
    expect(String(toastError.mock.calls[0]?.[0])).toContain("general");
  });

  it("adopts a settings replacement pushed from outside the process", async () => {
    const { useSettings, subscribeToBackend } = await import("./settings");
    await subscribeToBackend();
    const onChanged = listen.mock.calls.find((c) => c[0] === "settings://changed")?.[1] as (e: {
      payload: Settings;
    }) => void;

    const external = structuredClone(DEFAULTS);
    external.appearance.theme = "light";
    onChanged({ payload: external });

    expect(useSettings.getState().settings.appearance.theme).toBe("light");
  });

  it("reports a write failure raised by the backend after a value was already applied", async () => {
    const { subscribeToBackend } = await import("./settings");
    await subscribeToBackend();
    const onWriteFailed = listen.mock.calls.find(
      (c) => c[0] === "settings://write-failed",
    )?.[1] as () => void;

    onWriteFailed();
    expect(toastError).toHaveBeenCalledOnce();
  });

  it("stops listening for every event once unsubscribed", async () => {
    const unlistenChanged = vi.fn();
    const unlistenWriteFailed = vi.fn();
    const unlistenEditInvalid = vi.fn();
    listen
      .mockResolvedValueOnce(unlistenChanged)
      .mockResolvedValueOnce(unlistenWriteFailed)
      .mockResolvedValueOnce(unlistenEditInvalid);

    const { subscribeToBackend } = await import("./settings");
    const unsubscribe = await subscribeToBackend();
    unsubscribe();

    expect(unlistenChanged).toHaveBeenCalledOnce();
    expect(unlistenWriteFailed).toHaveBeenCalledOnce();
    expect(unlistenEditInvalid).toHaveBeenCalledOnce();
  });

  it("resets a section and adopts what rust actually stored", async () => {
    const { useSettings } = await import("./settings");
    const reset = structuredClone(DEFAULTS);
    reset.general.confirmOnQuit = true;
    settingsReset.mockResolvedValue(reset);

    await useSettings.getState().reset("general");
    expect(settingsReset).toHaveBeenCalledWith("general");
    expect(useSettings.getState().settings.general.confirmOnQuit).toBe(true);
  });

  it("rolls back and reports when a reset fails", async () => {
    const { useSettings } = await import("./settings");
    settingsReset.mockRejectedValue(new Error("boom"));

    await useSettings.getState().reset();
    expect(useSettings.getState().settings.appearance.theme).toBe("dark");
    expect(toastError).toHaveBeenCalledOnce();
  });

  it("reports an unknown error code when the rejection is not a structured RiffError", async () => {
    const { useSettings } = await import("./settings");
    settingsPatch.mockRejectedValue(new Error("network gremlin"));

    await useSettings.getState().patch({ appearance: { theme: "light" } });
    expect(toastError).toHaveBeenCalledOnce();
  });

  it("falls back to synchronous defaults when the bootstrap payload never arrived, then adopts the async read", async () => {
    delete window.__RIFF_BOOTSTRAP__;
    const fetched = structuredClone(DEFAULTS);
    fetched.appearance.theme = "light";
    settingsGet.mockResolvedValueOnce(fetched);

    const { useSettings } = await import("./settings");
    expect(useSettings.getState().appInfo.version).toBe("unknown");

    await Promise.resolve();
    await Promise.resolve();
    expect(settingsGet).toHaveBeenCalled();
    expect(useSettings.getState().settings.appearance.theme).toBe("light");
  });

  it("starts from defaults, without touching the file, when safe mode was asked for", async () => {
    // The crash screen's escape hatch. A crash caused by something persisted
    // is Reload -> crash -> Reload with no way out, so this refuses to *apply*
    // the file for one session — it does not rewrite it, and closing the
    // window forgets the request.
    const payload = window.__RIFF_BOOTSTRAP__;
    if (payload) payload.settings.appearance.theme = "light";
    sessionStorage.setItem("riff:safe-mode", "1");

    try {
      const { useSettings } = await import("./settings");
      expect(useSettings.getState().settings.appearance.theme).toBe("dark");
      expect(useSettings.getState().paths.homeDir).toBe("/home/probe");
      expect(settingsPatch).not.toHaveBeenCalled();
    } finally {
      sessionStorage.clear();
    }
  });

  it("shows a toast when settings.json was quarantined and defaults were used instead", async () => {
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
      recovery: { state: "quarantined", kept: "/c/settings.json.corrupt-2026-08-28" },
    };
    const { reportRecovery } = await import("./settings");
    reportRecovery();
    expect(toastError).toHaveBeenCalledOnce();
    expect(String(toastError.mock.calls[0]?.[0])).toContain("kept the original");
  });

  it("says writing is off, not that it will try again, when the file could not be kept", async () => {
    // `Recovered { quarantined: None }` used to collapse into "nothing
    // happened", so the only thing the user saw was the generic write-failure
    // toast — which promises Riff will try again on the next change. It will
    // not: every flush returns Denied for the rest of the session.
    const payload = window.__RIFF_BOOTSTRAP__;
    if (payload) payload.recovery = { state: "writeBlocked", path: "/c/settings.json" };

    const { reportRecovery } = await import("./settings");
    reportRecovery();
    expect(toastError).toHaveBeenCalledOnce();
    const [message, options] = toastError.mock.calls[0] ?? [];
    expect(String(message)).toContain("/c/settings.json");
    expect(String(message)).not.toContain("try again");
    expect(options).toMatchObject({ duration: Number.POSITIVE_INFINITY });
  });

  it("announces a recovery once even if the root remounts", async () => {
    const payload = window.__RIFF_BOOTSTRAP__;
    if (payload) payload.recovery = { state: "quarantined", kept: "/c/settings.json.corrupt-x" };

    const { reportRecovery } = await import("./settings");
    reportRecovery();
    reportRecovery();
    expect(toastError).toHaveBeenCalledOnce();
  });

  it("says nothing when there was nothing to recover", async () => {
    const { reportRecovery } = await import("./settings");
    reportRecovery();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("exposes a narrow selector hook per field, each returning the live value", async () => {
    const settings = await import("./settings");
    const hooks = [
      [settings.useTheme, "dark"],
      [settings.useDensity, "comfortable"],
      [settings.useUiScale, 1],
      [settings.useHighContrast, false],
      [settings.useStartupRoute, "practice"],
      [settings.useSidebarCollapsed, false],
      [settings.useRememberCollapsed, true],
    ] as const;
    for (const [hook, expected] of hooks) {
      const { result } = renderHook(() => hook());
      expect(result.current).toBe(expected);
    }
    expect(renderHook(() => settings.useAppearance()).result.current.theme).toBe("dark");
    expect(renderHook(() => settings.useGeneral()).result.current.startupRoute).toBe("practice");
  });
});

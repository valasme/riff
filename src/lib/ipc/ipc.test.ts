import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { ipc, isRiffError } = await import("./index");

describe("ipc facade", () => {
  beforeEach(() => invoke.mockReset());

  it("passes a patch under the argument name the command expects", async () => {
    invoke.mockResolvedValue({});
    await ipc.settingsPatch({ appearance: { theme: "light" } });
    expect(invoke).toHaveBeenCalledWith("settings_patch", {
      patch: { appearance: { theme: "light" } },
    });
  });

  it("sends null rather than undefined when resetting everything", async () => {
    invoke.mockResolvedValue({});
    await ipc.settingsReset();
    expect(invoke).toHaveBeenCalledWith("settings_reset", { section: null });
  });

  it("recognises a serialised RiffError", () => {
    expect(isRiffError({ code: "denied", details: { what: "x" } })).toBe(true);
    expect(isRiffError(new Error("boom"))).toBe(false);
    expect(isRiffError(null)).toBe(false);
  });

  // Every remaining command: one call each, asserting the exact command name
  // and argument shape `invoke` receives. `ipc_shapes.rs` guards the payload
  // *types* crossing IPC; this guards the command *names and argument keys*
  // the Rust side actually registers, on the frontend that calls them.
  const calls: [string, () => unknown, string, Record<string, unknown> | undefined][] = [
    ["settingsGet", () => ipc.settingsGet(), "settings_get", undefined],
    ["settingsExport", () => ipc.settingsExport(), "settings_export", undefined],
    ["settingsImport", () => ipc.settingsImport(), "settings_import", undefined],
    ["pathsGet", () => ipc.pathsGet(), "paths_get", undefined],
    ["openPath", () => ipc.openPath("config"), "open_path", { kind: "config" }],
    ["openExternal", () => ipc.openExternal("repository"), "open_external", { link: "repository" }],
    ["appInfo", () => ipc.appInfo(), "app_info", undefined],
    ["appReady", () => ipc.appReady(), "app_ready", undefined],
    ["diagnosticsExport", () => ipc.diagnosticsExport(), "diagnostics_export", undefined],
    [
      "logWrite",
      () => ipc.logWrite("warn", "m", { a: 1 }),
      "log_write",
      { level: "warn", message: "m", context: { a: 1 } },
    ],
    ["licensesGet", () => ipc.licensesGet(), "licenses_get", undefined],
    ["windowMinimize", () => ipc.windowMinimize(), "window_minimize", undefined],
    ["windowToggleMaximize", () => ipc.windowToggleMaximize(), "window_toggle_maximize", undefined],
    ["windowClose", () => ipc.windowClose(), "window_close", undefined],
    ["windowQuitConfirmed", () => ipc.windowQuitConfirmed(), "window_quit_confirmed", undefined],
    [
      "windowSetDecorations",
      () => ipc.windowSetDecorations(true),
      "window_set_decorations",
      { enabled: true },
    ],
  ];

  it.each(calls)("%s calls the right rust command", async (_name, call, command, args) => {
    invoke.mockResolvedValue(undefined);
    await call();
    if (args === undefined) {
      expect(invoke).toHaveBeenCalledWith(command);
    } else {
      expect(invoke).toHaveBeenCalledWith(command, args);
    }
  });

  it("omits context rather than sending undefined", async () => {
    invoke.mockResolvedValue(undefined);
    await ipc.logWrite("error", "m");
    expect(invoke).toHaveBeenCalledWith("log_write", {
      level: "error",
      message: "m",
      context: null,
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: toastError } }));

const { fire, ipc, isRiffError, reportFailure } = await import("./index");

describe("ipc facade", () => {
  beforeEach(() => {
    invoke.mockReset();
    toastError.mockReset();
  });

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
    ["diagnosticsCheck", () => ipc.diagnosticsCheck(), "diagnostics_check", undefined],
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
    ["windowStartDragging", () => ipc.windowStartDragging(), "window_start_dragging", undefined],
    ["practiceState", () => ipc.practiceState(), "practice_state", undefined],
    ["practicePopOut", () => ipc.practicePopOut("score"), "practice_pop_out", { pane: "score" }],
    [
      "practiceDockBack",
      () => ipc.practiceDockBack("video"),
      "practice_dock_back",
      { pane: "video" },
    ],
    ["practiceDockAll", () => ipc.practiceDockAll(), "practice_dock_all", undefined],
    ["practiceFocus", () => ipc.practiceFocus("audio"), "practice_focus", { pane: "audio" }],
    [
      "practicePendingReopen",
      () => ipc.practicePendingReopen(),
      "practice_pending_reopen",
      undefined,
    ],
    ["practiceReopen", () => ipc.practiceReopen(), "practice_reopen", undefined],
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

  it("turns a structured RiffError into its own localised message", () => {
    invoke.mockResolvedValue(undefined);
    reportFailure({ code: "denied", details: { what: "x" } }, "opening a folder");
    expect(toastError).toHaveBeenCalledWith("Your system refused that action.");
  });

  it("falls back to the unknown message for the bare string tauri rejects with", () => {
    // A command that panicked, or one that is not registered at all. There is
    // no `errors:code.<string>` key for it, and a missing key must not become
    // the message.
    invoke.mockResolvedValue(undefined);
    reportFailure("command practice_pop_out not found", "popping a pane out");
    expect(toastError).toHaveBeenCalledWith("An unexpected error occurred.");
  });

  it("records the failure on disk as well as on screen", () => {
    invoke.mockResolvedValue(undefined);
    reportFailure({ code: "io", details: { path: "p", message: "m" } }, "exporting");
    expect(invoke).toHaveBeenCalledWith(
      "log_write",
      expect.objectContaining({ level: "warn", message: "exporting failed" }),
    );
  });

  it("gives a fire-and-forget call a voice when it rejects", async () => {
    invoke.mockResolvedValue(undefined);
    fire(Promise.reject({ code: "not-found", details: { what: "w" } }), "focusing a pane");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(toastError).toHaveBeenCalledOnce();
  });

  it("says nothing when a fire-and-forget call succeeds", async () => {
    invoke.mockResolvedValue(undefined);
    fire(Promise.resolve(), "focusing a pane");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(toastError).not.toHaveBeenCalled();
  });
});

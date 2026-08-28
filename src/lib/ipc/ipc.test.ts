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
});

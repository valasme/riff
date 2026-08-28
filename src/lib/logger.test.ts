import { beforeEach, describe, expect, it, vi } from "vitest";

const logWrite = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/ipc", () => ({ ipc: { logWrite } }));

const { installGlobalErrorHandlers, log } = await import("./logger");

describe("logger", () => {
  beforeEach(() => logWrite.mockClear());

  it("forwards an error to the rust log", async () => {
    await log.error("boom", { where: "test" });
    expect(logWrite).toHaveBeenCalledWith("error", "boom", { where: "test" });
  });

  it("captures an unhandled rejection", async () => {
    installGlobalErrorHandlers();
    window.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), { reason: new Error("nope") }),
    );
    expect(logWrite).toHaveBeenCalledWith(
      "error",
      expect.stringContaining("nope"),
      expect.anything(),
    );
  });

  it("never throws when the bridge itself fails", async () => {
    logWrite.mockRejectedValueOnce(new Error("ipc down"));
    await expect(log.warn("still fine")).resolves.toBeUndefined();
  });
});

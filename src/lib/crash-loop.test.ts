import { beforeEach, describe, expect, it } from "vitest";
import {
  CRASH_WINDOW_MS,
  isInCrashLoop,
  recordCrash,
  requestSafeMode,
  safeModeRequested,
} from "./crash-loop";

describe("crash loop", () => {
  beforeEach(() => sessionStorage.clear());

  it("does not call the first crash a loop", () => {
    expect(isInCrashLoop(recordCrash(1_000))).toBe(false);
  });

  it("calls the second crash within the window a loop", () => {
    // Reload → crash → Reload, with no way out, is a locked door. Two crashes
    // close together are the signal that reloading is not going to help.
    recordCrash(1_000);
    expect(isInCrashLoop(recordCrash(2_000))).toBe(true);
  });

  it("treats two crashes far apart as unrelated", () => {
    recordCrash(1_000);
    expect(isInCrashLoop(recordCrash(1_000 + CRASH_WINDOW_MS + 1))).toBe(false);
  });

  it("keeps counting once a loop has started", () => {
    recordCrash(1_000);
    recordCrash(2_000);
    expect(isInCrashLoop(recordCrash(3_000))).toBe(true);
  });

  it("survives a reload but not the window closing", () => {
    // `sessionStorage`, not `localStorage`: a reload keeps it, which is the
    // whole point, and closing the window forgets it — otherwise yesterday's
    // crash would put today's healthy launch into the escape hatch.
    recordCrash(1_000);
    expect(sessionStorage.length).toBeGreaterThan(0);
  });

  it("asks for safe mode and answers that it was asked for", () => {
    expect(safeModeRequested()).toBe(false);
    requestSafeMode();
    expect(safeModeRequested()).toBe(true);
  });

  it("survives storage being unavailable rather than crashing the crash screen", () => {
    const real = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("denied");
      },
    });
    try {
      expect(() => recordCrash(1_000)).not.toThrow();
      expect(safeModeRequested()).toBe(false);
      expect(() => requestSafeMode()).not.toThrow();
    } finally {
      if (real) Object.defineProperty(window, "sessionStorage", real);
    }
  });
});

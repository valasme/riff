import { describe, expect, it, vi } from "vitest";
import { preferredTheme, shouldShowOnboarding } from "./gate";

const CURRENT = 1;

describe("shouldShowOnboarding", () => {
  it("shows on a fresh install", () => {
    expect(shouldShowOnboarding({ completedAt: null, version: 0 }, CURRENT)).toBe(true);
  });

  it("does not show once completed at the current version", () => {
    expect(shouldShowOnboarding({ completedAt: "2026-08-28T10:00:00Z", version: 1 }, CURRENT)).toBe(
      false,
    );
  });

  it("shows again when completed at an older version", () => {
    expect(shouldShowOnboarding({ completedAt: "2026-08-28T10:00:00Z", version: 0 }, CURRENT)).toBe(
      true,
    );
  });

  it("does not show when completed at a newer version after a downgrade", () => {
    expect(
      shouldShowOnboarding({ completedAt: "2026-08-28T10:00:00Z", version: 99 }, CURRENT),
    ).toBe(false);
  });
});

describe("preferredTheme", () => {
  it("suggests light when the desktop prefers it", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    expect(preferredTheme()).toBe("light");
  });

  it("suggests dark otherwise, matching riff's own default", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    expect(preferredTheme()).toBe("dark");
  });

  it("suggests dark when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(preferredTheme()).toBe("dark");
  });
});

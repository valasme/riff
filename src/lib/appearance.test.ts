import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Appearance } from "@/lib/ipc";
import { applyAppearance, resolveMotion } from "./appearance";

const base: Appearance = {
  theme: "dark",
  density: "comfortable",
  uiScale: 1,
  reduceMotion: "system",
  highContrast: false,
  titleBar: "custom",
  sidebar: { collapsed: false, rememberCollapsed: true },
};

function mockPrefersReducedMotion(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
}

describe("applyAppearance", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("html");
    mockPrefersReducedMotion(false);
  });

  it("writes every axis as an attribute", () => {
    applyAppearance(root, { ...base, theme: "light", density: "compact", highContrast: true });
    expect(root.dataset.theme).toBe("light");
    expect(root.dataset.density).toBe("compact");
    expect(root.dataset.contrast).toBe("high");
  });

  it("marks normal contrast explicitly rather than omitting the attribute", () => {
    applyAppearance(root, base);
    expect(root.dataset.contrast).toBe("normal");
  });

  it("sets the scale as a custom property", () => {
    applyAppearance(root, { ...base, uiScale: 1.25 });
    expect(root.style.getPropertyValue("--ui-scale")).toBe("1.25");
  });

  it("clamps a scale outside the supported range", () => {
    applyAppearance(root, { ...base, uiScale: 9 });
    expect(root.style.getPropertyValue("--ui-scale")).toBe("1.5");
    applyAppearance(root, { ...base, uiScale: 0.1 });
    expect(root.style.getPropertyValue("--ui-scale")).toBe("0.8");
  });

  it("follows the desktop when motion preference is system", () => {
    mockPrefersReducedMotion(true);
    expect(resolveMotion("system")).toBe("reduced");
    mockPrefersReducedMotion(false);
    expect(resolveMotion("system")).toBe("full");
  });

  it("lets the setting override the desktop in both directions", () => {
    mockPrefersReducedMotion(true);
    expect(resolveMotion("never")).toBe("full");
    mockPrefersReducedMotion(false);
    expect(resolveMotion("always")).toBe("reduced");
  });
});

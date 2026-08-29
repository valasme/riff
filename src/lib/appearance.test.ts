import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Appearance } from "@/lib/ipc";
import { applyAppearance, motionAttribute } from "./appearance";

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

  // Answering the media query here is what made "Follow my system" sample the
  // desktop once at startup and hold that answer for the rest of the session.
  // The attribute has to stay "system" whichever way the desktop is pointing,
  // so the stylesheet is the thing that decides and can decide again.
  it("defers the system preference to CSS rather than sampling matchMedia", () => {
    mockPrefersReducedMotion(true);
    expect(motionAttribute("system")).toBe("system");
    mockPrefersReducedMotion(false);
    expect(motionAttribute("system")).toBe("system");
    applyAppearance(root, base);
    expect(root.dataset.motion).toBe("system");
  });

  it("lets the setting override the desktop in both directions", () => {
    mockPrefersReducedMotion(true);
    expect(motionAttribute("never")).toBe("full");
    mockPrefersReducedMotion(false);
    expect(motionAttribute("always")).toBe("reduced");
  });
});

import { describe, expect, it, vi } from "vitest";
import { createKeymap } from "./keymap";

function context() {
  return {
    navigate: vi.fn(),
    togglePalette: vi.fn(),
    toggleSidebar: vi.fn(),
    patch: vi.fn(),
    settings: {
      appearance: { theme: "dark" as const, density: "comfortable" as const, highContrast: false },
    },
    openPath: vi.fn(),
    quit: vi.fn(),
    closeOverlay: vi.fn(),
  };
}

describe("createKeymap", () => {
  it("binds every chord from the spec", () => {
    const chords = createKeymap(context()).map((b) => b.chord);
    for (const chord of ["alt+k", "ctrl+b", "ctrl+,", "alt+1", "alt+2", "alt+3", "ctrl+q"]) {
      expect(chords).toContain(chord);
    }
  });

  it("assigns no chord twice", () => {
    const chords = createKeymap(context())
      .map((b) => b.chord)
      .filter(Boolean);
    expect(new Set(chords).size).toBe(chords.length);
  });

  it("lists each action once, so cmdk values stay unique", () => {
    const shown = createKeymap(context()).filter((b) => !b.hidden);
    const labels = shown.map((b) => b.descriptionKey);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("gives every binding a translatable description", () => {
    for (const binding of createKeymap(context())) {
      expect(binding.descriptionKey).toMatch(/^palette:commands\./);
    }
  });

  it("routes alt+1 to practice", () => {
    const ctx = context();
    createKeymap(ctx)
      .find((b) => b.chord === "alt+1")
      ?.run();
    expect(ctx.navigate).toHaveBeenCalledWith({ to: "/practice" });
  });

  it("flips the theme from whatever is current", () => {
    const ctx = context();
    createKeymap(ctx)
      .find((b) => b.id === "appearance.toggleTheme")
      ?.run();
    expect(ctx.patch).toHaveBeenCalledWith({ appearance: { theme: "light" } });
  });
});

import { describe, expect, it, vi } from "vitest";
import type { KeymapScope } from "./keymap";
import { createKeymap } from "./keymap";

function context(scope: KeymapScope = "main") {
  return {
    scope,
    pane: "score" as const,
    navigate: vi.fn(),
    togglePalette: vi.fn(),
    toggleSidebar: vi.fn(),
    patch: vi.fn(),
    settings: {
      appearance: {
        theme: "dark" as "dark" | "darker" | "light",
        density: "comfortable" as const,
        highContrast: false,
      },
    },
    openPath: vi.fn(),
    popOut: vi.fn(),
    dockBack: vi.fn(),
    dockAll: vi.fn(),
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

  it("cycles the theme from whatever is current, visiting all three", () => {
    // Dark → Darker → Light → Dark. A two-way flip would silently skip
    // whichever theme it was not written for.
    const seen: string[] = [];
    let theme: "dark" | "darker" | "light" = "dark";
    for (let i = 0; i < 3; i++) {
      const ctx = context();
      ctx.settings.appearance.theme = theme;
      createKeymap(ctx)
        .find((b) => b.id === "appearance.toggleTheme")
        ?.run();
      const [call] = ctx.patch.mock.calls;
      theme = call?.[0].appearance.theme;
      seen.push(theme);
    }
    expect(seen).toEqual(["darker", "light", "dark"]);
  });

  it("gives a pop-out no way to navigate away from its pane", () => {
    // A score window that turned into the Settings screen would have no
    // sidebar to escape by. The binding is removed rather than disabled, so
    // the chord is dead rather than silently doing nothing.
    const popout = createKeymap(context("popout"));
    expect(popout.filter((b) => b.id.startsWith("nav."))).toHaveLength(0);
    expect(popout.map((b) => b.chord)).not.toContain("alt+3");
    expect(popout.find((b) => b.id === "ui.toggleSidebar")).toBeUndefined();
  });

  it("keeps appearance, the folders and quit available in a pop-out", () => {
    const ids = createKeymap(context("popout")).map((b) => b.id);
    for (const id of [
      "appearance.toggleTheme",
      "appearance.toggleDensity",
      "appearance.toggleContrast",
      "app.openConfig",
      "app.openLogs",
      "ui.togglePalette",
      "app.quit",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("offers dock-back only where there is a pane to dock", () => {
    const ctx = context("popout");
    const popout = createKeymap(ctx);
    popout.find((b) => b.id === "practice.dockBack")?.run();
    expect(ctx.dockBack).toHaveBeenCalledWith("score");

    const main = createKeymap(context("main"));
    expect(main.find((b) => b.id === "practice.dockBack")).toBeUndefined();
    expect(main.find((b) => b.id === "practice.popOut.score")).toBeDefined();
    expect(main.find((b) => b.id === "practice.dockAll")).toBeDefined();
  });

  it("pops out the pane its command names", () => {
    const ctx = context();
    createKeymap(ctx)
      .find((b) => b.id === "practice.popOut.video")
      ?.run();
    expect(ctx.popOut).toHaveBeenCalledWith("video");
  });

  it("gives every command an icon, so the palette never renders a blank slot", () => {
    for (const binding of createKeymap(context())) {
      // A lucide icon is a forwardRef object, not a plain function, so the
      // assertion is that one is present at all — a missing icon renders as
      // an empty 16px gap the palette silently keeps.
      expect(binding.icon).toBeDefined();
    }
  });
});

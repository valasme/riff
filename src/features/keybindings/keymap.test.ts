import { describe, expect, it, vi } from "vitest";
import type { OpenScore } from "@/lib/ipc";
import type { KeymapScope } from "./keymap";
import { createKeymap } from "./keymap";

const OPEN_SCORE: OpenScore = {
  score: { name: "sonata.pdf", size: 10 },
  view: {
    page: 1,
    scale: { mode: "fit-width" },
    rotation: 0,
    spread: "none",
    scrollMode: "continuous",
    autoScrollSpeed: 1,
  },
};

function context(scope: KeymapScope = "main", openScore: OpenScore | null = null) {
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
    openScore,
    openScorePicker: vi.fn(),
    closeScore: vi.fn(),
    scoreCommand: vi.fn(),
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

describe("the score commands", () => {
  // Otherwise the palette grows a dozen rows that do nothing, in a pane
  // with nothing in it.
  it("are absent from the palette when no score is open", () => {
    const ids = createKeymap(context("main", null)).map((b) => b.id);
    expect(ids).not.toContain("score.nextPage");
    expect(ids).not.toContain("score.autoScroll");
    expect(ids).not.toContain("score.close");
  });

  it("leaves Open score available, since it is how an empty workspace stops being one", () => {
    const ids = createKeymap(context("main", null)).map((b) => b.id);
    expect(ids).toContain("score.open");
  });

  it("appear once a score is open", () => {
    const ids = createKeymap(context("main", OPEN_SCORE)).map((b) => b.id);
    for (const id of ["score.nextPage", "score.previousPage", "score.search", "score.pin"]) {
      expect(ids).toContain(id);
    }
  });

  /**
   * `available` follows `scope`'s doctrine: an unavailable command is
   * removed, so its chord is dead rather than disabled. A binding that
   * merely did nothing would leave Page Down looking broken.
   */
  it("takes the chord away with the command rather than leaving it inert", () => {
    const chords = createKeymap(context("main", null)).map((b) => b.chord);
    expect(chords).not.toContain("pagedown");
    expect(chords).not.toContain("arrowleft");
    expect(createKeymap(context("main", OPEN_SCORE)).map((b) => b.chord)).toContain("pagedown");
  });

  // The keys a commodity pedal sends, in the spelling chordFromEvent
  // produces — "left" would parse fine and never fire.
  it("binds page turning to what a pedal actually sends", () => {
    const chords = createKeymap(context("main", OPEN_SCORE)).map((b) => b.chord);
    for (const chord of ["pageup", "pagedown", "arrowleft", "arrowright"]) {
      expect(chords).toContain(chord);
    }
    // Up and Down stay unbound so they keep scrolling.
    expect(chords).not.toContain("arrowup");
    expect(chords).not.toContain("arrowdown");
  });

  // Each command dispatches what its name says. A `run` wired to the wrong
  // payload — previousPage sending delta 1, zoomOut sending direction 1 —
  // reads perfectly and does the opposite of what the palette row promises.
  it.each([
    ["score.nextPage", { kind: "page", delta: 1 }],
    ["score.nextPageAlt", { kind: "page", delta: 1 }],
    ["score.previousPage", { kind: "page", delta: -1 }],
    ["score.previousPageAlt", { kind: "page", delta: -1 }],
    ["score.zoomIn", { kind: "zoom", direction: 1 }],
    ["score.zoomOut", { kind: "zoom", direction: -1 }],
    ["score.fit", { kind: "fit" }],
    ["score.search", { kind: "search" }],
    ["score.rotate", { kind: "rotate" }],
    ["score.spread", { kind: "spread" }],
    ["score.scrollMode", { kind: "scrollMode" }],
    ["score.autoScroll", { kind: "autoScroll" }],
    ["score.speedUp", { kind: "speed", delta: 1 }],
    ["score.speedDown", { kind: "speed", delta: -1 }],
    ["score.pin", { kind: "pin" }],
  ])("reaches the viewer through the command channel: %s", (id, expected) => {
    const ctx = context("main", OPEN_SCORE);
    createKeymap(ctx)
      .find((b) => b.id === id)
      ?.run();
    expect(ctx.scoreCommand).toHaveBeenCalledWith(expected);
  });

  it("opens and closes the score through Rust rather than the command channel", () => {
    const ctx = context("main", OPEN_SCORE);
    const bindings = createKeymap(ctx);
    bindings.find((b) => b.id === "score.open")?.run();
    expect(ctx.openScorePicker).toHaveBeenCalledTimes(1);
    bindings.find((b) => b.id === "score.close")?.run();
    expect(ctx.closeScore).toHaveBeenCalledTimes(1);
  });

  // A window-level keymap is what makes a pedal work at all; there is
  // deliberately no pane focus model until Video lands.
  it("is live in a pop-out window too", () => {
    const ids = createKeymap(context("popout", OPEN_SCORE)).map((b) => b.id);
    expect(ids).toContain("score.nextPage");
  });
});

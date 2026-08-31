import { describe, expect, it } from "vitest";
import { chordFromEvent } from "@/features/keybindings/chord";
import { clampPage, PAGE_TURN_CHORDS, scaleValue, TOOLBAR_TIERS } from "./geometry";

describe("scaleValue", () => {
  it("maps fit width to the string pdf.js recognises", () => {
    expect(scaleValue({ mode: "fit-width" })).toBe("page-width");
  });

  it("maps fit page to the string pdf.js recognises", () => {
    expect(scaleValue({ mode: "fit-page" })).toBe("page-fit");
  });

  it("passes free zoom through as a number, which is how pdf.js tells the two apart", () => {
    expect(scaleValue({ mode: "custom", value: 1.25 })).toBe(1.25);
  });
});

describe("clampPage", () => {
  it("clamps at both ends rather than refusing", () => {
    expect(clampPage(0, 12, 3)).toBe(1);
    expect(clampPage(99, 12, 3)).toBe(12);
    expect(clampPage(7, 12, 3)).toBe(7);
  });

  it("holds the current page for a half-typed or empty field", () => {
    expect(clampPage(Number.NaN, 12, 3)).toBe(3);
  });

  it("never returns page zero for a document whose count is not known yet", () => {
    expect(clampPage(1, 0, 1)).toBe(1);
  });

  it("truncates a fractional page rather than seeking between two", () => {
    expect(clampPage(4.8, 12, 1)).toBe(4);
  });
});

describe("the page-turn chords", () => {
  // A binding written as "left" parses perfectly and never fires, because
  // `chordFromEvent` uses `event.key.toLowerCase()` verbatim.
  it("match what chordFromEvent produces for the keys a pedal sends", () => {
    const chordFor = (key: string) => chordFromEvent(new KeyboardEvent("keydown", { key }));
    expect(chordFor("PageUp")).toBe("pageup");
    expect(chordFor("PageDown")).toBe("pagedown");
    expect(chordFor("ArrowLeft")).toBe("arrowleft");
    expect(chordFor("ArrowRight")).toBe("arrowright");

    expect(PAGE_TURN_CHORDS.previous).toContain(chordFor("PageUp"));
    expect(PAGE_TURN_CHORDS.previous).toContain(chordFor("ArrowLeft"));
    expect(PAGE_TURN_CHORDS.next).toContain(chordFor("PageDown"));
    expect(PAGE_TURN_CHORDS.next).toContain(chordFor("ArrowRight"));
  });

  it("leave Up and Down to scroll, which is what makes the split worth having", () => {
    const bound: readonly string[] = [...PAGE_TURN_CHORDS.previous, ...PAGE_TURN_CHORDS.next];
    expect(bound).not.toContain("arrowup");
    expect(bound).not.toContain("arrowdown");
  });
});

describe("the toolbar tiers", () => {
  // Spec §5.1: these four are what the viewer cannot be navigated without.
  it("never collapse the controls a narrow pane still needs", () => {
    expect(TOOLBAR_TIERS.always).toEqual(["page", "previous", "next", "fit", "search"]);
  });

  it("assign every control to exactly one tier", () => {
    const all = [...TOOLBAR_TIERS.always, ...TOOLBAR_TIERS.next, ...TOOLBAR_TIERS.last];
    expect(new Set(all).size).toBe(all.length);
  });
});

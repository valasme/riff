import { describe, expect, it } from "vitest";
import { chordFromEvent, formatChord, isTypingTarget } from "./chord";

function key(init: Partial<KeyboardEventInit> & { key: string }) {
  return new KeyboardEvent("keydown", init);
}

describe("chordFromEvent", () => {
  it("lowercases a plain key", () => {
    expect(chordFromEvent(key({ key: "K" }))).toBe("k");
  });

  it("orders modifiers deterministically", () => {
    expect(chordFromEvent(key({ key: "k", altKey: true, ctrlKey: true, shiftKey: true }))).toBe(
      "ctrl+alt+shift+k",
    );
  });

  it("handles punctuation used by real bindings", () => {
    expect(chordFromEvent(key({ key: ",", ctrlKey: true }))).toBe("ctrl+,");
  });

  it("names escape consistently", () => {
    expect(chordFromEvent(key({ key: "Escape" }))).toBe("escape");
  });
});

describe("isTypingTarget", () => {
  it("recognises inputs, textareas and contenteditable", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    expect(isTypingTarget(editable)).toBe(true);
  });

  it("does not treat a checkbox as typing", () => {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    expect(isTypingTarget(checkbox)).toBe(false);
  });

  it("treats anything else as not typing", () => {
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("formatChord", () => {
  it("renders a chord for display", () => {
    expect(formatChord("alt+k")).toBe("Alt+K");
    expect(formatChord("ctrl+,")).toBe("Ctrl+,");
  });

  // The general rule capitalises the first letter, which was right while
  // every chord was a letter or a modifier. `event.key.toLowerCase()` gives
  // "pageup" and "arrowright", so the palette rendered "Pageup" and
  // "Arrowright" — the page-turn chords, and the ones a pedal sends.
  it("renders the page-turn keys legibly rather than as one run-on word", () => {
    expect(formatChord("pageup")).toBe("Page Up");
    expect(formatChord("pagedown")).toBe("Page Down");
    expect(formatChord("arrowleft")).toBe("←");
    expect(formatChord("arrowright")).toBe("→");
  });

  it("still formats a modified page-turn chord as one badge per key", () => {
    expect(formatChord("ctrl+pagedown")).toBe("Ctrl+Page Down");
  });
});

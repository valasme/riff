import { describe, expect, it } from "vitest";
import { chordFromEvent } from "@/features/keybindings/chord";
import {
  clampPage,
  clampSpeed,
  MAX_SPEED,
  MIN_SPEED,
  nextFit,
  nextRotation,
  nextScrollMode,
  nextSpread,
  PAGE_TURN_CHORDS,
  PDFJS_SCROLL_MODE,
  PDFJS_SPREAD_MODE,
  pageInterval,
  pinnedBounds,
  pixelsPerSecond,
  scaleValue,
  searchStateFrom,
  spreadRow,
  spreadRowCount,
  steppedScale,
  TOOLBAR_TIERS,
} from "./geometry";

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

describe("steppedScale", () => {
  // Free zoom leaves the fit mode rather than fighting it (spec §6), so a
  // step always lands on a number, never back on a keyword.
  it("leaves the fit mode for a numeric scale", () => {
    expect(steppedScale(1, 1)).toEqual({ mode: "custom", value: 1.1 });
    expect(steppedScale(1, -1)).toEqual({ mode: "custom", value: 0.91 });
  });

  it("steps from the scale actually on screen, not from a stored keyword", () => {
    // Fit width in a narrow pane might have resolved to 0.6; one step in is
    // relative to that, not to 100%.
    expect(steppedScale(0.6, 1)).toEqual({ mode: "custom", value: 0.66 });
  });

  it("clamps at pdf.js's own bounds rather than zooming to nothing", () => {
    expect(steppedScale(0.1, -1)).toEqual({ mode: "custom", value: 0.1 });
    expect(steppedScale(25, 1)).toEqual({ mode: "custom", value: 25 });
  });

  it("rounds, so repeated steps do not write a floating-point tail to disk", () => {
    const stepped = steppedScale(1.331, 1);
    expect(stepped.mode).toBe("custom");
    if (stepped.mode !== "custom") return;
    expect(Number.isInteger(stepped.value * 100)).toBe(true);
  });
});

describe("the fit toggle", () => {
  it("alternates width and page", () => {
    expect(nextFit({ mode: "fit-width" })).toEqual({ mode: "fit-page" });
    expect(nextFit({ mode: "fit-page" })).toEqual({ mode: "fit-width" });
  });

  // "custom" is somewhere you arrive by zooming, not somewhere a toggle
  // should be able to put you.
  it("brings free zoom back to a fit mode", () => {
    expect(nextFit({ mode: "custom", value: 2.4 })).toEqual({ mode: "fit-width" });
  });
});

describe("nextRotation", () => {
  it("steps in 90° and wraps, since pdf.js throws on anything else", () => {
    expect(nextRotation(0)).toBe(90);
    expect(nextRotation(270)).toBe(0);
  });

  it("normalises a hand-edited negative rotation rather than passing it on", () => {
    expect(nextRotation(-90)).toBe(0);
  });
});

describe("nextSpread and nextScrollMode", () => {
  it("cycles the three spreads", () => {
    expect(nextSpread("none")).toBe("odd");
    expect(nextSpread("odd")).toBe("even");
    expect(nextSpread("even")).toBe("none");
  });

  it("toggles the two scroll modes Riff exposes", () => {
    expect(nextScrollMode("continuous")).toBe("page");
    expect(nextScrollMode("page")).toBe("continuous");
  });

  // Riff exposes two of pdf.js's four; horizontal and wrapped are not
  // Riff's vocabulary — see CONTEXT.md's "View" entry.
  it("maps onto the pdf.js enum values, not onto its ordinals", () => {
    expect(PDFJS_SCROLL_MODE.continuous).toBe(0);
    expect(PDFJS_SCROLL_MODE.page).toBe(3);
    expect(PDFJS_SPREAD_MODE).toEqual({ none: 0, odd: 1, even: 2 });
  });
});

describe("searchStateFrom", () => {
  // pdf.js's FindState numbers are module-private, so they are transcribed
  // here and named in Riff's words.
  it("names each of pdf.js's find states", () => {
    expect(searchStateFrom(0)).toBe("found");
    expect(searchStateFrom(1)).toBe("not-found");
    expect(searchStateFrom(2)).toBe("wrapped");
    expect(searchStateFrom(3)).toBe("pending");
  });

  it("treats anything it does not recognise as still pending", () => {
    expect(searchStateFrom(99)).toBe("pending");
  });
});

describe("auto-scroll arithmetic", () => {
  // The unit's whole promise: 1 page/min stays 1 page/min however far the
  // score is zoomed in. A cached pixels-per-second would silently mean a
  // different number of pages at every other scale.
  it("keeps pages per minute stable across zoom levels", () => {
    // Same 10-page score at two zooms: taller pages, proportionally faster
    // pixels, identical pages per minute.
    const slow = pixelsPerSecond(10_000, 10, 1);
    const zoomed = pixelsPerSecond(20_000, 10, 1);
    expect(slow).toBeCloseTo(1000 / 60);
    expect(zoomed).toBeCloseTo(2000 / 60);
    // One page takes a minute in both cases.
    expect(10_000 / 10 / slow).toBeCloseTo(60);
    expect(20_000 / 10 / zoomed).toBeCloseTo(60);
  });

  it("doubles the rate when the speed doubles", () => {
    expect(pixelsPerSecond(6000, 10, 2)).toBeCloseTo(pixelsPerSecond(6000, 10, 1) * 2);
  });

  it("turns a page every 60/speed seconds where there is nothing to scroll", () => {
    expect(pageInterval(1)).toBe(60);
    expect(pageInterval(2)).toBe(30);
    expect(pageInterval(10)).toBe(6);
  });

  it("clamps speed to the range the slider offers", () => {
    expect(clampSpeed(0)).toBe(MIN_SPEED);
    expect(clampSpeed(99)).toBe(MAX_SPEED);
    expect(clampSpeed(Number.NaN)).toBe(1);
    expect(clampSpeed(1.26)).toBe(1.3);
  });
});

describe("pinning", () => {
  // Releasing auto-scroll onto one half of a spread you are reading both
  // halves of would be worse than not pinning at all.
  it("holds a whole spread, not one half of it", () => {
    const first = pinnedBounds(1, "odd", 12, 6000);
    const second = pinnedBounds(2, "odd", 12, 6000);
    expect(second).toEqual(first);
    // Six rows of two pages each across 6000px.
    expect(first).toEqual({ top: 0, bottom: 1000 });
  });

  it("holds a single page when there is no spread", () => {
    expect(pinnedBounds(3, "none", 12, 6000)).toEqual({ top: 1000, bottom: 1500 });
  });

  // pdf.js's SpreadMode.EVEN puts page 1 on its own, as a cover.
  it("gives an even spread's first page a row of its own", () => {
    expect(spreadRow(1, "even")).toBe(0);
    expect(spreadRow(2, "even")).toBe(1);
    expect(spreadRow(3, "even")).toBe(1);
  });

  it("pairs from page one in an odd spread", () => {
    expect(spreadRow(1, "odd")).toBe(0);
    expect(spreadRow(2, "odd")).toBe(0);
    expect(spreadRow(3, "odd")).toBe(1);
  });

  it("counts the rows each spread mode produces", () => {
    expect(spreadRowCount(12, "none")).toBe(12);
    expect(spreadRowCount(12, "odd")).toBe(6);
    expect(spreadRowCount(12, "even")).toBe(7);
  });

  it("cannot point past the last row for a page beyond the score", () => {
    expect(pinnedBounds(99, "none", 4, 4000)).toEqual({ top: 3000, bottom: 4000 });
  });
});

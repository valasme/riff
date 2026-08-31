import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// `?raw` rather than `node:fs`: typed by `vite/client`, and no path
// arithmetic to get wrong.
import globalsCss from "@/styles/globals.css?raw";
import { useAutoScroll } from "./useAutoScroll";

/**
 * A container with the geometry jsdom has no layout engine to give it. The
 * hook only ever reads `scrollHeight`, `clientHeight` and `scrollTop`, so
 * these three are the whole surface it needs.
 */
function fakeContainer({ scrollHeight = 12_000, clientHeight = 800 } = {}) {
  const element = document.createElement("div");
  Object.defineProperty(element, "scrollHeight", { value: scrollHeight, writable: true });
  Object.defineProperty(element, "clientHeight", { value: clientHeight, writable: true });
  const ref = createRef<HTMLDivElement>();
  (ref as { current: HTMLDivElement | null }).current = element;
  return { element, ref };
}

/** Drives the loop frame by frame instead of waiting on a real clock. */
let frames: FrameRequestCallback[] = [];
let now = 0;

beforeEach(() => {
  frames = [];
  now = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("performance", { now: () => now });
});

afterEach(() => vi.unstubAllGlobals());

function tick(milliseconds: number) {
  const pending = frames;
  frames = [];
  now += milliseconds;
  act(() => {
    for (const frame of pending) frame(now);
  });
}

const BASE = {
  running: true,
  speed: 60, // one page a second, so a frame moves a visible amount
  pinned: false,
  page: 1,
  pageCount: 12,
  spread: "none" as const,
  scrollMode: "continuous" as const,
  onAdvancePage: () => {},
  onPause: () => {},
};

describe("auto-scroll", () => {
  it("scrolls the container while it is running", () => {
    const { element, ref } = fakeContainer();
    renderHook(() => useAutoScroll({ ...BASE, container: ref }));
    tick(1000);
    // 12000px over 12 pages is 1000px a page; one page a second.
    expect(element.scrollTop).toBeCloseTo(1000, 0);
  });

  it("does nothing at all while it is stopped", () => {
    const { element, ref } = fakeContainer();
    renderHook(() => useAutoScroll({ ...BASE, running: false, container: ref }));
    tick(1000);
    expect(element.scrollTop).toBe(0);
  });

  /**
   * The exemption spec §6.3 grants auto-scroll, guarded so it cannot be
   * "fixed" later: this is a function the musician started and can stop at
   * any moment, and there must be no JavaScript check on the motion
   * preference anywhere in the loop. Smooth scroll — which the user does not
   * start and cannot interrupt — is suppressed instead, in `globals.css`.
   */
  it("survives reduced motion, which it is deliberately exempt from", () => {
    document.documentElement.setAttribute("data-motion", "reduced");
    const { element, ref } = fakeContainer();
    renderHook(() => useAutoScroll({ ...BASE, container: ref }));
    tick(1000);
    document.documentElement.removeAttribute("data-motion");
    expect(element.scrollTop).toBeGreaterThan(0);
  });

  it("pauses when the user scrolls, rather than fighting them for the wheel", () => {
    const onPause = vi.fn();
    const { element, ref } = fakeContainer();
    renderHook(() => useAutoScroll({ ...BASE, onPause, container: ref }));
    tick(100);
    // Somewhere the loop did not put it.
    element.scrollTop = 5000;
    element.dispatchEvent(new Event("scroll"));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it("does not mistake its own scrolling for the user's", () => {
    const onPause = vi.fn();
    const { element, ref } = fakeContainer();
    renderHook(() => useAutoScroll({ ...BASE, onPause, container: ref }));
    tick(100);
    element.dispatchEvent(new Event("scroll"));
    expect(onPause).not.toHaveBeenCalled();
  });

  it("stops at the end of the score rather than wrapping to the start", () => {
    const onPause = vi.fn();
    const { element, ref } = fakeContainer();
    renderHook(() => useAutoScroll({ ...BASE, onPause, container: ref }));
    tick(20_000);
    expect(onPause).toHaveBeenCalled();
    expect(element.scrollTop).toBe(12_000 - 800);
  });

  it("advances a page at a time where there is nothing to scroll", () => {
    const onAdvancePage = vi.fn();
    const { element, ref } = fakeContainer();
    renderHook(() =>
      useAutoScroll({
        ...BASE,
        speed: 2, // a turn every 30 seconds
        scrollMode: "page",
        onAdvancePage,
        container: ref,
      }),
    );
    tick(29_000);
    expect(onAdvancePage).not.toHaveBeenCalled();
    tick(2_000);
    expect(onAdvancePage).toHaveBeenCalledTimes(1);
    // And it turns pages rather than scrolling them.
    expect(element.scrollTop).toBe(0);
  });

  it("does not advance past the last page in page mode", () => {
    const onAdvancePage = vi.fn();
    const onPause = vi.fn();
    const { ref } = fakeContainer();
    renderHook(() =>
      useAutoScroll({
        ...BASE,
        speed: 60,
        page: 12,
        scrollMode: "page",
        onAdvancePage,
        onPause,
        container: ref,
      }),
    );
    tick(2000);
    expect(onAdvancePage).not.toHaveBeenCalled();
    expect(onPause).toHaveBeenCalled();
  });

  it("holds a pinned page instead of advancing off it", () => {
    const onAdvancePage = vi.fn();
    const { ref } = fakeContainer();
    renderHook(() =>
      useAutoScroll({
        ...BASE,
        speed: 60,
        pinned: true,
        scrollMode: "page",
        onAdvancePage,
        container: ref,
      }),
    );
    tick(5000);
    expect(onAdvancePage).not.toHaveBeenCalled();
  });

  // A pin is for practising this passage over and over, so it loops the
  // pinned range rather than stopping at the bottom of it.
  it("loops within a pinned spread rather than leaving it", () => {
    const onPause = vi.fn();
    const { element, ref } = fakeContainer();
    renderHook(() =>
      useAutoScroll({ ...BASE, pinned: true, spread: "odd", onPause, container: ref }),
    );
    // A row of two pages is 2000px of the 12000px score; the visible 800px
    // means the loop turns over at 1200px.
    tick(3000);
    expect(onPause).not.toHaveBeenCalled();
    expect(element.scrollTop).toBeLessThan(2000);
  });
});

describe("reduced motion in globals.css", () => {
  // Zeroing animation and transition durations does not touch scrolling, so
  // smooth scroll survived reduced motion everywhere in Riff until this was
  // added. Asserted against the stylesheet because jsdom evaluates no
  // cascade — the real behaviour is measured in the engine (Task 14).
  it("stops smooth scroll in both rules, not only the media query", () => {
    const rules = globalsCss.split("scroll-behavior: auto !important;");
    expect(
      rules.length - 1,
      'both the prefers-reduced-motion rule and the [data-motion="reduced"] rule need it',
    ).toBe(2);
  });
});

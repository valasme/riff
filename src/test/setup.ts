import "@testing-library/jest-dom/vitest";
import "@/test/axe";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom implements no layout, so it has no ResizeObserver either. Radix's
// Slider primitive measures its own size with one on mount; without a stub
// every test that renders a Slider fails before its assertions run.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;

// jsdom never implemented `isContentEditable` (it stays `undefined`
// regardless of the attribute) — there is no open issue asking for it, just
// silence. Real browsers walk the element and its ancestors for the nearest
// explicit `contenteditable` value; this mirrors that closely enough for a
// keyboard-suppression test to mean something.
Object.defineProperty(HTMLElement.prototype, "isContentEditable", {
  configurable: true,
  get(this: HTMLElement) {
    let el: HTMLElement | null = this;
    while (el) {
      const value = el.getAttribute("contenteditable");
      if (value === "true" || value === "") return true;
      if (value === "false") return false;
      el = el.parentElement;
    }
    return false;
  },
});

afterEach(() => {
  cleanup();
});

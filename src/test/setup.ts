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

afterEach(() => {
  cleanup();
});

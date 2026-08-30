import { renderHook } from "@testing-library/react";
import { Search } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Keybinding } from "./keymap";

// `reportFailure` runs for real — it is the behaviour under test. It logs
// through `invoke`, which rejects under jsdom and is swallowed there; the
// toast is the part a user sees and the part asserted here.
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: toastError } }));

const { useKeybindings } = await import("./useKeybindings");

function binding(run: () => void): Keybinding {
  return {
    id: "palette.open",
    chord: "ctrl+k",
    descriptionKey: "palette.open",
    group: "application",
    icon: Search,
    run,
  };
}

function press(chord: { key: string; ctrlKey?: boolean }) {
  window.dispatchEvent(new KeyboardEvent("keydown", { ...chord, bubbles: true, cancelable: true }));
}

describe("useKeybindings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs the binding whose chord matches", () => {
    const run = vi.fn();
    renderHook(() => useKeybindings([binding(run)]));
    press({ key: "k", ctrlKey: true });
    expect(run).toHaveBeenCalledOnce();
  });

  it("reports a command that throws instead of losing it to the event loop", () => {
    // A keydown handler throws into the event loop, not into React's error
    // boundary, so a broken shortcut was a chord that did nothing at all with
    // nothing on screen and nothing in the log.
    renderHook(() =>
      useKeybindings([
        binding(() => {
          throw new Error("boom");
        }),
      ]),
    );

    expect(() => press({ key: "k", ctrlKey: true })).not.toThrow();
    expect(toastError).toHaveBeenCalledOnce();
  });

  it("keeps the rest of the keyboard working after one command has thrown", () => {
    const good = vi.fn();
    renderHook(() =>
      useKeybindings([
        binding(() => {
          throw new Error("boom");
        }),
        { ...binding(good), id: "nav.practice", chord: "alt+1" },
      ]),
    );

    press({ key: "k", ctrlKey: true });
    press({ key: "1", altKey: true } as { key: string });
    expect(good).toHaveBeenCalledOnce();
  });
});

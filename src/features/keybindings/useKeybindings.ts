import { useEffect } from "react";
import { chordFromEvent, isTypingTarget } from "./chord";
import type { Keybinding } from "./keymap";

/** One listener for every binding. Adding a shortcut never adds a listener. */
export function useKeybindings(bindings: Keybinding[]): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const chord = chordFromEvent(event);
      if (chord !== "escape" && isTypingTarget(event.target)) return;

      const binding = bindings.find((b) => b.chord !== "" && b.chord === chord);
      if (!binding) return;

      event.preventDefault();
      binding.run();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bindings]);
}

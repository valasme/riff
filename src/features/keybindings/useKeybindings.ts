import { useEffect } from "react";
import { reportFailure } from "@/lib/ipc";
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
      try {
        binding.run();
      } catch (error) {
        // A `keydown` listener throws into the event loop, not into React's
        // error boundary, so a command that threw was a chord that did
        // nothing at all — nothing on screen, nothing in the log, and the
        // rest of the keyboard still working, which is what made it look like
        // the binding simply was not there.
        reportFailure(error, `running ${binding.id}`);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bindings]);
}

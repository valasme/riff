import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

/**
 * Whether the window is maximised right now.
 *
 * The maximise button previously took this as a prop that nothing ever
 * passed, so it announced "Maximize" to a screen reader even when the window
 * already filled the screen, and its glyph never changed. Reading the real
 * state fixes both, and it has to be a subscription rather than a one-off
 * read: the window manager can maximise the window without going through the
 * button at all — a double-click on the drag region, a keyboard shortcut, a
 * tiling rule.
 *
 * `is_maximized` and event listening are both inside `core:default`, so this
 * costs no new capability (invariant 6).
 */
export function useWindowMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const win = getCurrentWindow();
        const read = async () => {
          const value = await win.isMaximized();
          if (!cancelled) setMaximized(value);
        };
        await read();
        // Maximising is a resize, and so is un-maximising. Nothing else in
        // the API reports the transition on Linux.
        const off = await win.onResized(() => void read());
        if (cancelled) off();
        else unlisten = off;
      } catch {
        // Not running inside a Tauri webview — unit tests, `vite preview`.
        // The button keeps its default label rather than taking the title
        // bar down with it.
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return maximized;
}

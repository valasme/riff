import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { fire, ipc, type Pane } from "@/lib/ipc";

export const PANES_CHANGED = "practice://panes-changed";

/**
 * Mirrors the set Rust owns. Read-only by construction: everything that
 * changes it goes through a command, because a compositor can destroy a
 * pop-out window without this webview ever hearing about it and only Rust is
 * told.
 */
export function usePoppedOut(): Pane[] {
  const [panes, setPanes] = useState<Pane[]>([]);
  // The seed is a round trip and the event is not, so an early
  // `practice://panes-changed` can land first. Letting the seed win then
  // would resurrect the set as it was before whatever caused that event.
  const heard = useRef(false);

  useEffect(() => {
    let alive = true;
    // Reported rather than swallowed: without the set, a pane that is in a
    // window of its own draws no chip, and the chip strip is the only way
    // back to a pop-out that has drifted behind another application.
    fire(
      ipc.practiceState().then((seed) => {
        if (alive && !heard.current) setPanes(seed);
      }),
      "reading which panes are popped out",
    );
    const unlisten = listen<Pane[]>(PANES_CHANGED, (event) => {
      heard.current = true;
      setPanes(event.payload);
    });
    return () => {
      alive = false;
      void unlisten.then((off) => off());
    };
  }, []);

  return panes;
}

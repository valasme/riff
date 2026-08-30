import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { fire, ipc, type OpenScore } from "@/lib/ipc";

export const SCORE_CHANGED = "score://changed";

/**
 * Mirrors the set Rust owns — the same shape as `usePoppedOut.ts`, for the
 * same reason: `score_view_patch` never broadcasts, so this only changes on
 * an actual open or close, not on every page turn. That is deliberate (spec
 * §2, §8): the *identity* of the open score is mirrored state, and the
 * *view* stays local to whichever component is actually driving pdf.js.
 *
 * `enabled` rather than a caller choosing not to call this at all: a hook
 * cannot be called conditionally, and `PracticePane` renders one instance
 * for Score, Video and Audio alike. Passing `false` for the two placeholders
 * skips the round trip and the listener rather than paying for state three
 * times to serve the one pane that reads it.
 */
export function useOpenScore(enabled = true): OpenScore | null {
  const [open, setOpen] = useState<OpenScore | null>(null);
  // The seed is a round trip and the event is not, so an early
  // `score://changed` can land first. Letting the seed win then would
  // resurrect a score that has since closed, or hide one that just opened.
  const heard = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fire(
      ipc.scoreState().then((seed) => {
        if (alive && !heard.current) setOpen(seed);
      }),
      "reading whether a score is open",
    );
    const unlisten = listen<OpenScore | null>(SCORE_CHANGED, (event) => {
      heard.current = true;
      setOpen(event.payload);
    });
    return () => {
      alive = false;
      void unlisten.then((off) => off());
    };
  }, [enabled]);

  return open;
}

import { type RefObject, useEffect, useRef } from "react";
import type { ScrollMode, SpreadMode } from "@/lib/ipc";
import { pageInterval, pinnedBounds, pixelsPerSecond } from "./geometry";

/**
 * The score advancing on its own at a pace the musician sets.
 *
 * **Deliberately exempt from reduced motion**, and this is the comment that
 * says why, because without it the exemption looks like an oversight and
 * gets "fixed". Auto-scroll is not decoration: it is the function the
 * musician came for, started on purpose and stoppable at any instant from
 * the toolbar, the palette or a chord. That stoppability is the whole basis
 * of the exemption — smooth scroll, which the user does not start and cannot
 * interrupt, is suppressed under reduced motion in `globals.css` instead.
 *
 * A `requestAnimationFrame` loop rather than `scroll-behavior: smooth` or a
 * CSS animation: both of those are exactly what reduced motion turns off,
 * and neither can be driven at a rate expressed in pages per minute.
 */
export function useAutoScroll({
  running,
  speed,
  pinned,
  page,
  pageCount,
  spread,
  scrollMode,
  container,
  onAdvancePage,
  onPause,
}: {
  running: boolean;
  speed: number;
  pinned: boolean;
  page: number;
  pageCount: number;
  spread: SpreadMode;
  scrollMode: ScrollMode;
  container: RefObject<HTMLDivElement | null>;
  onAdvancePage: () => void;
  onPause: () => void;
}) {
  // Read inside the frame callback so a speed or pin change takes effect on
  // the next frame rather than restarting the loop — restarting would reset
  // the accumulated sub-pixel position and stutter.
  const latest = useRef({
    speed,
    pinned,
    page,
    pageCount,
    spread,
    scrollMode,
    onAdvancePage,
    onPause,
  });
  latest.current = { speed, pinned, page, pageCount, spread, scrollMode, onAdvancePage, onPause };

  useEffect(() => {
    const element = container.current;
    if (!running || !element) return;

    let frame = 0;
    let previous = performance.now();
    // Kept as a float and re-assigned every frame. At one page per minute an
    // 800px page moves about 0.22px per frame, so an engine that rounds
    // `scrollTop` to whole pixels would round every single step to zero and
    // the score would never move at all.
    let position = element.scrollTop;
    // Time banked towards the next turn in page mode.
    let elapsed = 0;
    // What we last asked for, so the scroll listener can tell a frame of
    // auto-scroll apart from the user reaching for the wheel.
    let expected = element.scrollTop;

    function onScroll() {
      const surface = container.current;
      if (!surface) return;
      // A tolerance rather than equality: the engine may round what it was
      // given, and a spread or zoom change reflows underneath us.
      if (Math.abs(surface.scrollTop - expected) > 2) latest.current.onPause();
    }
    element.addEventListener("scroll", onScroll, { passive: true });

    function step(now: number) {
      const surface = container.current;
      if (!surface) return;
      const delta = (now - previous) / 1000;
      previous = now;
      const state = latest.current;

      if (state.scrollMode === "page") {
        // Nothing to scroll, so the same speed number means a page turn
        // every `60 / speed` seconds instead.
        elapsed += delta;
        if (elapsed >= pageInterval(state.speed)) {
          elapsed = 0;
          // A pin holds the page it is on; without one, the last page is
          // where auto-scroll stops rather than wrapping to the start.
          if (state.pinned) {
            // Held deliberately: nothing to do this tick.
          } else if (state.page >= state.pageCount) {
            state.onPause();
            return;
          } else {
            state.onAdvancePage();
          }
        }
        frame = requestAnimationFrame(step);
        return;
      }

      const limit = state.pinned
        ? pinnedBounds(state.page, state.spread, state.pageCount, surface.scrollHeight).bottom -
          surface.clientHeight
        : surface.scrollHeight - surface.clientHeight;

      position += pixelsPerSecond(surface.scrollHeight, state.pageCount, state.speed) * delta;

      if (position >= limit) {
        if (state.pinned) {
          // Loops the pinned page rather than stopping on it: a pin is for
          // practising this passage over and over.
          position = pinnedBounds(
            state.page,
            state.spread,
            state.pageCount,
            surface.scrollHeight,
          ).top;
        } else {
          // The end of the score is a stop, not a wrap.
          position = limit;
          expected = position;
          surface.scrollTop = position;
          state.onPause();
          return;
        }
      }

      expected = position;
      surface.scrollTop = position;
      frame = requestAnimationFrame(step);
    }

    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("scroll", onScroll);
    };
    // Only `running` restarts the loop. Everything else is read through the
    // ref above, so changing speed mid-scroll does not stutter.
  }, [running, container]);
}

/**
 * The channel a keyboard chord or a palette command reaches the viewer by.
 *
 * Deliberately *not* state in the settings store. The view — page, scale,
 * rotation, spread, scroll mode, speed — stays local to whichever component
 * is driving pdf.js (spec §2), because a value that changes on every page
 * turn has no business in a store whose subscribers are primitive selectors:
 * every one of them would re-render on every turn of the page.
 *
 * A module-level emitter rather than a DOM event so it cannot be observed or
 * forged from anywhere outside this bundle, and so the payload stays typed.
 * Publishing with no viewer mounted is a no-op, which is exactly right: only
 * the window hosting the Score pane has one, and a chord pressed in the
 * other window has nothing to act on.
 */
export type ScoreCommand =
  | { kind: "page"; delta: 1 | -1 }
  | { kind: "zoom"; direction: 1 | -1 }
  | { kind: "fit" }
  | { kind: "rotate" }
  | { kind: "spread" }
  | { kind: "scrollMode" }
  | { kind: "search" }
  | { kind: "autoScroll" }
  | { kind: "speed"; delta: 1 | -1 }
  | { kind: "pin" };

type Listener = (command: ScoreCommand) => void;

const listeners = new Set<Listener>();

export function onScoreCommand(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function runScoreCommand(command: ScoreCommand): void {
  for (const listener of listeners) listener(command);
}

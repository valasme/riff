/**
 * The escape hatch from a deterministic crash.
 *
 * `RouteError` offers Reload, which is the right first answer and the wrong
 * only answer: a crash caused by something persisted — a route that no longer
 * exists in `lastRoute`, a setting the interface cannot render — reproduces on
 * every reload, and the user is left pressing a button that cannot work.
 *
 * `sessionStorage`, not `localStorage`. A reload has to keep the count, which
 * is the whole point; closing the window has to forget it, or a crash last
 * Tuesday would put a healthy launch straight into the escape hatch.
 */
const CRASHES = "riff:crashes";
const SAFE_MODE = "riff:safe-mode";

/** Two crashes further apart than this are two problems, not a loop. */
export const CRASH_WINDOW_MS = 60_000;

interface Record {
  count: number;
  at: number;
}

/** Returns how many crashes this run of the loop has seen, including this one. */
export function recordCrash(now: number = Date.now()): number {
  const previous = read();
  const count = previous && now - previous.at <= CRASH_WINDOW_MS ? previous.count + 1 : 1;
  write({ count, at: now });
  return count;
}

export function isInCrashLoop(count: number): boolean {
  return count >= 2;
}

/**
 * Asks the next load to ignore everything persisted. The hash goes with it:
 * hash history means a route that throws on render is still in the URL, so a
 * reload would walk straight back into it.
 */
export function requestSafeMode(): void {
  set(SAFE_MODE, "1");
}

export function safeModeRequested(): boolean {
  return get(SAFE_MODE) === "1";
}

function read(): Record | null {
  const raw = get(CRASHES);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { count, at } = parsed as Partial<Record>;
    if (typeof count !== "number" || typeof at !== "number") return null;
    return { count, at };
  } catch {
    return null;
  }
}

function write(record: Record): void {
  set(CRASHES, JSON.stringify(record));
}

// Every access is guarded. This code runs inside the screen that exists
// because something already went wrong; throwing here would replace a readable
// crash report with a blank window.
function get(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function set(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Nothing to do and nowhere to say it: this is the crash screen.
  }
}

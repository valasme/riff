import type { Scale, ScrollMode, SpreadMode } from "@/lib/ipc";

/**
 * The chords a commodity page-turner pedal sends, per spec §6.1. Bluetooth
 * pedals — AirTurn, PageFlip and the rest — send ordinary key events in
 * keyboard mode, and which ones varies by model: Page Up/Page Down, Left/
 * Right, or Up/Down. Binding the first two covers every common pedal with no
 * pedal-specific code, and is why these chords are not available to anything
 * else. **Up and Down are deliberately absent**: they are left to scroll.
 *
 * The exact strings matter. `chordFromEvent` is `event.key.toLowerCase()`
 * with modifier prefixes, so a `KeyboardEvent` for Page Up produces
 * `"pageup"` and one for the left arrow produces `"arrowleft"`. A binding
 * written as `"left"` parses perfectly and never fires.
 */
export const PAGE_TURN_CHORDS = {
  previous: ["pageup", "arrowleft"],
  next: ["pagedown", "arrowright"],
} as const;

/**
 * Which toolbar controls survive a narrowing pane, from spec §5.1's table.
 * Only the assignment lives here — the widths at which each tier gives way
 * are container queries in `score.css`, because a threshold duplicated in
 * TypeScript is a threshold that drifts from the one actually deciding. The
 * real widths are measured in the real engine (plan 15, Task 14).
 */
export const TOOLBAR_TIERS = {
  /** Never collapses: without these the viewer cannot be navigated at all. */
  always: ["page", "previous", "next", "fit", "search"],
  next: ["zoomOut", "zoomIn", "scrollMode", "spread", "rotate"],
  last: ["autoScroll", "pin"],
} as const;

export type ToolbarControl =
  | (typeof TOOLBAR_TIERS)["always"][number]
  | (typeof TOOLBAR_TIERS)["next"][number]
  | (typeof TOOLBAR_TIERS)["last"][number];

/**
 * Clamped rather than rejected, so a typed page number outside the document
 * lands on the nearest real page instead of doing nothing. `NaN` — an empty
 * or half-typed field — holds the current page.
 */
export function clampPage(page: number, pageCount: number, current: number): number {
  if (!Number.isFinite(page)) return current;
  return Math.min(Math.max(Math.trunc(page), 1), Math.max(pageCount, 1));
}

/**
 * pdf.js's own zoom bounds and step, so Riff's `+`/`−` land on the same
 * scales its reference viewer would. Copied deliberately rather than
 * imported: they are module-private constants in `pdf_viewer.mjs`.
 */
const MIN_SCALE = 0.1;
const MAX_SCALE = 25.0;
const SCALE_DELTA = 1.1;

/**
 * One press of zoom in or out, from whatever scale is on screen now.
 *
 * Takes the *live* numeric scale rather than the stored `Scale`, because
 * stepping out of a fit mode has to start from what fit width actually
 * resolved to in this pane — the whole point of free zoom leaving the fit
 * mode rather than fighting it (spec §6). Rounded to two decimals so
 * repeated steps do not accumulate a long tail of floating-point noise into
 * `workspace.json`.
 */
export function steppedScale(currentScale: number, direction: 1 | -1): Scale {
  const stepped = direction === 1 ? currentScale * SCALE_DELTA : currentScale / SCALE_DELTA;
  const clamped = Math.min(Math.max(stepped, MIN_SCALE), MAX_SCALE);
  return { mode: "custom", value: Math.round(clamped * 100) / 100 };
}

/**
 * The fit toggle: width and page alternate, and free zoom returns to fit
 * width. Two states rather than three, because "custom" is somewhere you
 * arrive by zooming, not somewhere a toggle should be able to land you.
 */
export function nextFit(scale: Scale): Scale {
  return scale.mode === "fit-width" ? { mode: "fit-page" } : { mode: "fit-width" };
}

/** 90° steps, normalised — pdf.js throws on anything that is not one. */
export function nextRotation(rotation: number): number {
  return (((rotation + 90) % 360) + 360) % 360;
}

export function nextSpread(spread: SpreadMode): SpreadMode {
  const order: SpreadMode[] = ["none", "odd", "even"];
  return order[(order.indexOf(spread) + 1) % order.length] ?? "none";
}

export function nextScrollMode(mode: ScrollMode): ScrollMode {
  return mode === "continuous" ? "page" : "continuous";
}

/** Pages per minute, the unit a musician already thinks in (spec §6.3). */
export const MIN_SPEED = 0.1;
export const MAX_SPEED = 10;
export const SPEED_STEP = 0.1;

export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1;
  // Rounded to one decimal so `±` stepping cannot accumulate a
  // floating-point tail into `workspace.json`.
  return Math.round(Math.min(Math.max(speed, MIN_SPEED), MAX_SPEED) * 10) / 10;
}

/**
 * Pages per minute as pixels per second, measured against the container
 * rather than computed from a scale.
 *
 * `scrollHeight / pageCount` is one page's worth of vertical distance
 * whatever the zoom, rotation or spread currently is — which is what makes
 * the speed stable across zoom levels, as the unit promises. A pixels-per-
 * second figure cached at one scale would silently mean a different number
 * of pages per minute at every other one.
 *
 * In a spread the same division still holds: a row carries two pages, so
 * one page of music is half a row, and "pages per minute" keeps meaning
 * pages of music rather than rows of layout.
 */
export function pixelsPerSecond(
  scrollHeight: number,
  pageCount: number,
  pagesPerMinute: number,
): number {
  const pageHeight = scrollHeight / Math.max(pageCount, 1);
  return (pageHeight * pagesPerMinute) / 60;
}

/** Seconds between page turns in `ScrollMode.PAGE`, where there is nothing
 *  to scroll — the same speed number, the same unit (spec §6.3). */
export function pageInterval(pagesPerMinute: number): number {
  return 60 / Math.max(pagesPerMinute, MIN_SPEED);
}

/**
 * Which row of the layout a page sits in, and how many rows there are.
 * A spread holds two pages, so pinning has to hold the row rather than the
 * page: releasing auto-scroll onto one half of a spread you are reading
 * both halves of would be worse than not pinning at all (spec §6.3).
 *
 * `even` puts page 1 on its own — the cover — and pairs from page 2, which
 * is what pdf.js's `SpreadMode.EVEN` does.
 */
export function spreadRow(page: number, spread: SpreadMode): number {
  switch (spread) {
    case "none":
      return page - 1;
    case "odd":
      return Math.floor((page - 1) / 2);
    case "even":
      return Math.floor(page / 2);
  }
}

export function spreadRowCount(pageCount: number, spread: SpreadMode): number {
  switch (spread) {
    case "none":
      return Math.max(pageCount, 1);
    case "odd":
      return Math.max(Math.ceil(pageCount / 2), 1);
    case "even":
      return Math.max(Math.floor(pageCount / 2) + 1, 1);
  }
}

/**
 * The scroll range a pin holds auto-scroll inside: the current page, or in
 * a spread the whole row. Scrolling by hand still works — a pin that
 * snapped you back would be unusable — so this bounds the loop, not the
 * user.
 */
export function pinnedBounds(
  page: number,
  spread: SpreadMode,
  pageCount: number,
  scrollHeight: number,
): { top: number; bottom: number } {
  const rows = spreadRowCount(pageCount, spread);
  const rowHeight = scrollHeight / rows;
  const row = Math.min(Math.max(spreadRow(page, spread), 0), rows - 1);
  return { top: row * rowHeight, bottom: (row + 1) * rowHeight };
}

/** What the search row is currently reporting. */
export interface SearchStatus {
  query: string;
  state: "pending" | "found" | "not-found" | "wrapped";
  /** 1-based, as shown; 0 while there is nothing to point at. */
  current: number;
  total: number;
}

export const NO_SEARCH: SearchStatus = {
  query: "",
  state: "pending",
  current: 0,
  total: 0,
};

/**
 * pdf.js's `FindState` in Riff's words. A plain lookup rather than a
 * re-export, because the numbers are module-private in `pdf_viewer.mjs` and
 * the four states are worth naming: "wrapped" in particular has to reach the
 * interface, since a search that silently restarts at the top looks like a
 * search that found the same match twice.
 */
export function searchStateFrom(findState: number): SearchStatus["state"] {
  switch (findState) {
    case 0:
      return "found";
    case 1:
      return "not-found";
    case 2:
      return "wrapped";
    default:
      return "pending";
  }
}

/**
 * Riff's two scroll modes in pdf.js's four-value enum. Horizontal and
 * wrapped are deliberately not exposed — see `CONTEXT.md`'s "View" entry.
 */
export const PDFJS_SCROLL_MODE: Record<ScrollMode, number> = {
  continuous: 0, // ScrollMode.VERTICAL
  page: 3, // ScrollMode.PAGE
};

export const PDFJS_SPREAD_MODE: Record<SpreadMode, number> = {
  none: 0,
  odd: 1,
  even: 2,
};

/**
 * Riff's `Scale` in the vocabulary pdf.js's `currentScaleValue` speaks: the
 * fit modes are the strings it recognises, free zoom is a plain number.
 *
 * This has to be applied explicitly on load. `PDFViewer` starts at
 * `UNKNOWN_SCALE`, and its `currentScale` getter then answers `DEFAULT_SCALE`
 * — 1.0, page-actual — so a document set with no scale ever chosen renders
 * every page at its intrinsic width (816px for US Letter at 96dpi) whatever
 * the pane is. In a Score pane beside Video and Audio that is about 500px, so
 * the score arrives with a horizontal scrollbar and at the wrong zoom. The
 * reference viewer avoids this in its own `setInitialView`, which Riff does
 * not use because it drives `PDFViewer` directly.
 */
export function scaleValue(scale: Scale): string | number {
  switch (scale.mode) {
    case "fit-width":
      return "page-width";
    case "fit-page":
      return "page-fit";
    case "custom":
      return scale.value;
  }
}

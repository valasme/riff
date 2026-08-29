/**
 * The four title-bar glyphs, drawn rather than imported.
 *
 * Lucide is the icon set everywhere else (§7.5), but its icons are drawn on a
 * 24px grid with a 2px stroke: scaled down to the 12px a window control wants,
 * `square` becomes a heavy blob and `minus` a short fat bar. Real title bars
 * use hairlines. These are four shapes totalling a dozen lines, and they are
 * the difference between window controls that look native and ones that look
 * like a toolbar shrank.
 */
export function WindowGlyph({ shape }: { shape: "minimize" | "maximize" | "restore" | "close" }) {
  return (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.15}
      strokeLinecap="round"
      strokeLinejoin="round"
      shapeRendering="geometricPrecision"
      aria-hidden
      focusable="false"
    >
      {shape === "minimize" && <path d="M2.25 6h7.5" />}
      {shape === "maximize" && <rect x="2.25" y="2.25" width="7.5" height="7.5" rx="1.25" />}
      {shape === "restore" && (
        <>
          {/* The back panel is drawn as an open corner, not a full square:
              two overlapping rectangles at this size turn into a grey smudge
              where their strokes meet. */}
          <path d="M4.25 3.5V3a1.25 1.25 0 0 1 1.25-1.25H9A1.25 1.25 0 0 1 10.25 3v3.5A1.25 1.25 0 0 1 9 7.75h-.5" />
          <rect x="1.75" y="4.25" width="6" height="6" rx="1.25" />
        </>
      )}
      {shape === "close" && (
        <>
          <path d="m2.75 2.75 6.5 6.5" />
          <path d="m9.25 2.75-6.5 6.5" />
        </>
      )}
    </svg>
  );
}

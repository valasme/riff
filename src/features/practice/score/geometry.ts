import type { Scale } from "@/lib/ipc";

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

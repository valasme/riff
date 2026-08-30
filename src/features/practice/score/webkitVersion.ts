/**
 * Riff ships `libwebkit2gtk-4.1-0 (>= 2.36)` / `webkit2gtk4.1 >= 2.36` in
 * `tauri.conf.json`'s `depends`, established once by Task 2 measuring what
 * pdf.js's module worker actually needs — see the design spec §4 and ADR
 * 0003. `depends` is only ever honoured by whichever package manager
 * installed Riff; on a system it does not govern, or one where the floor
 * was skipped, {@link ensureWorker} in `pdfjs.ts` is what actually catches a
 * worker that cannot start, and this is the message that names why.
 *
 * No pdf.js import here on purpose: this is pure version arithmetic, tested
 * without paying for pdf.js's module graph in every test that touches it.
 */
export const MIN_WEBKITGTK = "2.36.0";

/** `"2.52.6"` → `[2, 52, 6]`. Anything short or non-numeric reads as `0`. */
function parts(version: string): [number, number, number] {
  const [major, minor, patch] = version.split(".").map((part) => Number.parseInt(part, 10) || 0);
  return [major ?? 0, minor ?? 0, patch ?? 0];
}

export function meetsMinimumWebkit(runtime: string, minimum: string = MIN_WEBKITGTK): boolean {
  const a = parts(runtime);
  const b = parts(minimum);
  for (let i = 0; i < 3; i += 1) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (ai !== bi) return ai > bi;
  }
  return true;
}

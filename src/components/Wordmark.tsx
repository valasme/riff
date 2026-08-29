import { cn } from "@/lib/cn";

/**
 * The one place Playfair appears in the shell.
 *
 * Three things keep the mark balanced, and all three are here rather than
 * inline at each call site so the title bar and the onboarding screen cannot
 * drift apart:
 *
 *  - Weight 500, not 700. Playfair's italic double-f carries both a tall
 *    ascender and a deep descender while `ri` sits entirely at x-height, so
 *    extra weight lands almost entirely on the f's.
 *  - Positive tracking. The default fit pulls `ri` into the f-ligature, which
 *    is what makes the pair read as one large glyph with something small in
 *    front of it.
 *  - Trailing padding. The italic leans right, so the last f overhangs its
 *    own advance width and crowds whatever follows it. `pe` gives the overhang
 *    somewhere to go — without it, no amount of `gap` on the parent looks
 *    even, because the gap is measured from the advance width, not the ink.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "select-none font-display font-medium italic leading-none tracking-[0.025em]",
        "pe-[0.09em]",
        className,
      )}
    >
      riff
    </span>
  );
}

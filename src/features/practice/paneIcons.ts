import type { LucideIcon } from "lucide-react";
import { AudioLines, FileMusic, Video } from "lucide-react";
import type { Pane } from "@/lib/ipc";

/**
 * Split out of `PracticePane.tsx` on purpose: `__root.tsx` is eager (every
 * route needs its title bar), and `PracticePane.tsx` now imports the score
 * feature, which imports `pdfjs-dist`. Importing `PANE_ICONS` from
 * `PracticePane.tsx` pulled that whole module graph — pdf.js included —
 * into the entry chunk, the exact failure the "pdfjs-dist is imported only
 * from the practice and pop-out routes" constraint exists to prevent. This
 * file has no route, so nothing eager can smuggle pdf.js in through it.
 */
export const PANE_ICONS: Record<Pane, LucideIcon> = {
  score: FileMusic,
  video: Video,
  audio: AudioLines,
};

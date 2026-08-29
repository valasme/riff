import type { Pane } from "@/lib/ipc";

/**
 * The order the grid draws in, the order the chip strip reads in, and the
 * order Rust holds the popped-out set in. One order, so a pane never appears
 * in a different place depending on which list you are looking at.
 */
export const PANES = ["score", "video", "audio"] as const satisfies readonly Pane[];

/**
 * How the panes still in the grid share it. One rule, not a lookup table:
 * whatever is left divides the space evenly, and only the full set keeps the
 * mockup's asymmetry — Score tall on the left with Video and Audio stacked
 * beside it.
 *
 * `feature` cannot mean anything but Score, because three docked panes are
 * necessarily all three of them.
 */
export function gridShape(docked: readonly Pane[]): "empty" | "full" | "columns" | "feature" {
  if (docked.length === 0) return "empty";
  if (docked.length === 1) return "full";
  if (docked.length === 2) return "columns";
  return "feature";
}

export function dockedPanes(poppedOut: readonly Pane[]): Pane[] {
  return PANES.filter((pane) => !poppedOut.includes(pane));
}

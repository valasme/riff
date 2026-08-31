import type { MouseEvent as ReactMouseEvent } from "react";
import { fire, ipc } from "@/lib/ipc";

const INTERACTIVE =
  'a, button, input, select, textarea, label, summary, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="option"]';

/** Starts the compositor-owned move gesture for an undecorated Riff window. */
export function handleWindowDrag(event: ReactMouseEvent<HTMLElement>) {
  if (event.button !== 0 || (event.detail !== 1 && event.detail !== 2)) return;
  if (!(event.target instanceof Element) || event.target.closest(INTERACTIVE)) return;
  event.preventDefault();
  if (event.detail === 2) {
    fire(ipc.windowToggleMaximize(), "maximising the window");
  } else {
    fire(ipc.windowStartDragging(), "moving the window");
  }
}

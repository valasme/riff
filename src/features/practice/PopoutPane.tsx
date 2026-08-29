import { ipc, type Pane } from "@/lib/ipc";
import { PracticePane } from "./PracticePane";

/**
 * What a pop-out window renders: the pane, full bleed, and nothing else. No
 * sidebar and no second copy of the application — a pop-out is a pane that
 * happens to have its own frame.
 */
export function PopoutPane({ pane }: { pane: Pane }) {
  return (
    <div className="h-full p-[var(--content-padding)]">
      <PracticePane pane={pane} popped onDockBack={(p) => void ipc.practiceDockBack(p)} />
    </div>
  );
}

import { fire, ipc, type Pane } from "@/lib/ipc";
import { PracticePane } from "./PracticePane";

/**
 * What a pop-out window renders: the pane, full bleed, and nothing else. No
 * sidebar and no second copy of the application — a pop-out is a pane that
 * happens to have its own frame.
 */
export function PopoutPane({ pane }: { pane: Pane }) {
  return (
    // `h-full` on the pane itself, not only on the wrapper. In the grid the
    // pane is a grid item and is stretched for free; here its parent is an
    // ordinary block, so without this it collapses to the height of the
    // placeholder sentence and leaves the rest of the window empty.
    //
    // The Score pane makes the same trap worse rather than different: the
    // viewer's scroll container is `absolute inset-0` inside a `flex-1`
    // parent, so a pane that collapses gives it nothing to fill and the
    // score renders into a strip the height of its own toolbar. Same bug as
    // the placeholder had, with a great deal more to look at.
    <div className="h-full p-[var(--content-padding)]">
      <PracticePane
        pane={pane}
        popped
        className="h-full"
        onDockBack={(p) => fire(ipc.practiceDockBack(p), "docking the pane back")}
      />
    </div>
  );
}

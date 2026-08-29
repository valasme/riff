import { createFileRoute, notFound } from "@tanstack/react-router";
import { PANES } from "@/features/practice/layout";
import { PopoutPane } from "@/features/practice/PopoutPane";
import type { Pane } from "@/lib/ipc";

/**
 * Rust builds these windows at `index.html#/popout/{pane}`, so the pane
 * arrives in the URL rather than through IPC. It is still validated here:
 * hash history is user-editable in a way a command argument is not.
 */
export const Route = createFileRoute("/popout/$pane")({
  component: PopoutRoute,
  loader: ({ params }) => {
    if (!PANES.includes(params.pane as Pane)) throw notFound();
    return { pane: params.pane as Pane };
  },
});

function PopoutRoute() {
  const { pane } = Route.useLoaderData();
  return <PopoutPane pane={pane} />;
}

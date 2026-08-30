import { createHashHistory, createRouter } from "@tanstack/react-router";
import { NotFound } from "@/components/NotFound";
import { routeTree } from "@/routeTree.gen";

/**
 * Hash history, not browser history. Tauri's asset protocol serves no SPA
 * fallback, so reloading on a deep path like /settings/general would 404.
 * The URL is never visible — the window has no address bar.
 */
export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: false,
  // TanStack's own fallback is a bare, untranslated `<p>Not Found</p>` on the
  // page's default background — and in a pop-out there is no navigation to
  // leave by, so it is also a dead end.
  defaultNotFoundComponent: NotFound,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
